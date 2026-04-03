"""HubStoreMixin: manages hub CRUD, appearance settings, and source selection helpers."""

from datetime import datetime, timezone
from typing import List, Optional

from postgrest.exceptions import APIError
from supabase import Client

from ...schemas import (
    DEFAULT_HUB_COLOR_KEY,
    DEFAULT_HUB_ICON_KEY,
    HUB_COLOR_KEYS,
    HUB_ICON_KEYS,
    Hub,
    HubCreate,
    HubUpdate,
    UserProfileSummary,
)
from .common_helpers import _is_missing_hub_optional_column_error


class HubStoreMixin:
    # Return the hubs the current user belongs to, along with membership and lightweight member profile data.
    def list_hubs(self, client: Client, user_id: str) -> List[Hub]:
        # Try progressively simpler select clauses so older schemas without optional columns still work.
        select_with_appearance = (
            "role, last_accessed_at, is_favourite, "
            "hubs (id, owner_id, name, description, icon_key, color_key, created_at, archived_at, members_count, sources_count)"
        )
        select_without_appearance = (
            "role, last_accessed_at, is_favourite, "
            "hubs (id, owner_id, name, description, created_at, archived_at, members_count, sources_count)"
        )
        select_without_archival = (
            "role, last_accessed_at, is_favourite, "
            "hubs (id, owner_id, name, description, icon_key, color_key, created_at, members_count, sources_count)"
        )
        select_without_appearance_or_archival = (
            "role, last_accessed_at, is_favourite, "
            "hubs (id, owner_id, name, description, created_at, members_count, sources_count)"
        )
        response = None
        for select_fields in [
            select_with_appearance,
            select_without_appearance,
            select_without_archival,
            select_without_appearance_or_archival,
        ]:
            try:
                response = (
                    client.table("hub_members")
                    .select(select_fields)
                    .eq("user_id", user_id)
                    .not_.is_("accepted_at", "null")
                    .order("last_accessed_at", desc=True)
                    .execute()
                )
                break
            except APIError as exc:
                if not _is_missing_hub_optional_column_error(exc):
                    raise
        if response is None:
            raise RuntimeError("Failed to list hubs.")

        hubs: List[Hub] = []
        hub_ids: List[str] = []
        for row in response.data:
            hub_row = row.get("hubs") or {}
            hub_row.setdefault("icon_key", DEFAULT_HUB_ICON_KEY)
            hub_row.setdefault("color_key", DEFAULT_HUB_COLOR_KEY)
            hub_row["role"] = row.get("role")
            hub_row["last_accessed_at"] = row.get("last_accessed_at")
            hub_row["is_favourite"] = row.get("is_favourite")
            hubs.append(Hub(**hub_row))
            hub_ids.append(hub_row["id"])

        if hub_ids:
            try:
                # Resolve member profiles in one batch so hub cards can show avatars and labels without N+1 lookups.
                members_response = (
                    client.table("hub_members")
                    .select("hub_id, user_id")
                    .in_("hub_id", hub_ids)
                    .not_.is_("accepted_at", "null")
                    .execute()
                )
                user_ids = {
                    str(member.get("user_id") or "")
                    for member in (members_response.data or [])
                    if member.get("user_id")
                }
                profile_lookup = self.resolve_user_profiles_by_ids(user_ids)
                emails_by_hub: dict[str, List[str]] = {}
                profiles_by_hub: dict[str, List[UserProfileSummary]] = {}
                for member in members_response.data:
                    hub_id = member.get("hub_id")
                    member_user_id = str(member.get("user_id") or "")
                    profile = profile_lookup.get(member_user_id)
                    if not hub_id or not profile:
                        continue
                    if profile.email:
                        emails_by_hub.setdefault(hub_id, []).append(profile.email)
                    profiles_by_hub.setdefault(hub_id, []).append(profile)
                for hub in hubs:
                    hub.member_emails = emails_by_hub.get(hub.id, [])
                    hub.member_profiles = profiles_by_hub.get(hub.id, [])
            except Exception:
                for hub in hubs:
                    hub.member_emails = []
                    hub.member_profiles = []

        return hubs

    # Create a hub and its owner membership via the service-role RPC helper.
    def create_hub(self, client: Client, user_id: str, payload: HubCreate) -> Hub:
        _ = client
        self._validate_hub_appearance(payload.icon_key, payload.color_key)
        response = self.service_client.rpc(
            "create_hub_with_owner_membership",
            {
                "p_owner_id": str(user_id),
                "p_name": payload.name,
                "p_description": payload.description,
                "p_icon_key": payload.icon_key,
                "p_color_key": payload.color_key,
            },
        ).execute()
        data = response.data or []
        if isinstance(data, dict):
            return Hub(**data)
        if not data:
            raise RuntimeError("Failed to create hub.")
        return Hub(**data[0])

    # Update mutable hub fields and return the refreshed row.
    def update_hub(self, client: Client, hub_id: str, payload: HubUpdate) -> Hub:
        update_payload = payload.model_dump(exclude_none=True)
        if not update_payload:
            raise ValueError("No hub changes provided.")
        self._validate_hub_appearance(payload.icon_key, payload.color_key)
        update_response = client.table("hubs").update(update_payload).eq("id", str(hub_id)).execute()
        if not update_response.data:
            raise KeyError("Hub not found")
        response = (
            client.table("hubs")
            .select("id, owner_id, name, description, icon_key, color_key, created_at, archived_at, members_count, sources_count")
            .eq("id", str(hub_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Hub not found")
        return Hub(**response.data[0])

    # Soft-archive a hub by setting its archival timestamp.
    def archive_hub(self, client: Client, hub_id: str) -> Hub:
        existing = client.table("hubs").select("id").eq("id", str(hub_id)).execute()
        if not existing.data:
            raise KeyError("Hub not found")
        now = datetime.now(timezone.utc).isoformat()
        client.table("hubs").update({"archived_at": now}).eq("id", str(hub_id)).execute()
        response = (
            client.table("hubs")
            .select("id, owner_id, name, description, icon_key, color_key, created_at, archived_at, members_count, sources_count")
            .eq("id", str(hub_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Hub not found")
        return Hub(**response.data[0])

    # Restore a previously archived hub.
    def unarchive_hub(self, client: Client, hub_id: str) -> Hub:
        existing = client.table("hubs").select("id").eq("id", str(hub_id)).execute()
        if not existing.data:
            raise KeyError("Hub not found")
        client.table("hubs").update({"archived_at": None}).eq("id", str(hub_id)).execute()
        response = (
            client.table("hubs")
            .select("id, owner_id, name, description, icon_key, color_key, created_at, archived_at, members_count, sources_count")
            .eq("id", str(hub_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Hub not found")
        return Hub(**response.data[0])

    # Validate icon and color selections against the allowed hub appearance keys.
    def _validate_hub_appearance(self, icon_key: Optional[str], color_key: Optional[str]) -> None:
        if icon_key is not None and icon_key not in HUB_ICON_KEYS:
            raise ValueError("Invalid hub icon.")
        if color_key is not None and color_key not in HUB_COLOR_KEYS:
            raise ValueError("Invalid hub color.")

    # Update the membership record used for recent-hub ordering.
    def update_hub_access(self, client: Client, hub_id: str, user_id: str) -> None:
        response = (
            self.service_client.table("hub_members")
            .update({"last_accessed_at": datetime.now(timezone.utc).isoformat()})
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Hub membership not found")

    # Toggle the current user's favourite marker for a hub.
    def toggle_hub_favourite(self, client: Client, hub_id: str, user_id: str, is_favourite: bool) -> None:
        response = (
            client.table("hub_members")
            .update({"is_favourite": is_favourite})
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Hub membership not found")

    # Return all fully processed source ids for a hub in creation order.
    def _complete_source_ids_for_hub(self, client: Client, hub_id: str) -> List[str]:
        response = (
            client.table("sources")
            .select("id")
            .eq("hub_id", str(hub_id))
            .eq("status", "complete")
            .order("created_at", desc=False)
            .execute()
        )
        return [str(row["id"]) for row in (response.data or []) if row.get("id")]

    # Filter requested source ids to valid complete sources while preserving the hub-wide ordering.
    def _normalize_source_ids_to_complete_order(
        self,
        source_ids: Optional[List[str]],
        complete_source_ids: List[str],
    ) -> List[str]:
        if source_ids is None:
            return list(complete_source_ids)
        allowed = set(complete_source_ids)
        requested = [str(source_id) for source_id in source_ids if str(source_id) in allowed]
        requested_set = set(requested)
        return [source_id for source_id in complete_source_ids if source_id in requested_set]
