"""ActivityStoreMixin: records and reads hub activity feed events."""

from typing import Any, Dict, List, Optional

from supabase import Client

from ...schemas import ActivityEvent
from .base import logger


class ActivityStoreMixin:
    # Write one activity event without failing the calling workflow if logging breaks.
    def log_activity(
        self,
        client: Client,
        hub_id: str,
        user_id: str,
        action: str,
        resource_type: str,
        resource_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        # Build the insert payload incrementally so optional fields are only stored when present.
        row: Dict[str, Any] = {
            "hub_id": hub_id,
            "user_id": user_id,
            "action": action,
            "resource_type": resource_type,
        }
        if resource_id is not None:
            row["resource_id"] = resource_id
        if metadata:
            row["metadata"] = metadata
        try:
            client.table("activity_events").insert(row).execute()
        except Exception:
            logger.warning("Failed to log activity event: %s/%s", action, resource_type, exc_info=True)

    # Return recent activity events and label the actor relative to the current user.
    def list_activity(
        self,
        client: Client,
        user_id: str,
        hub_id: Optional[str] = None,
        hub_ids: Optional[List[str]] = None,
        limit: int = 50,
    ) -> List[ActivityEvent]:
        query = client.table("activity_events").select("*")
        if hub_id:
            query = query.eq("hub_id", hub_id)
        elif hub_ids is not None:
            if not hub_ids:
                return []
            query = query.in_("hub_id", hub_ids)
        response = query.order("created_at", desc=True).limit(limit).execute()
        rows = [dict(row) for row in (response.data or [])]

        # Resolve user labels in one batch so the activity feed can show "You" or a friendly actor name.
        actor_ids = {
            str(row.get("user_id") or "")
            for row in rows
            if row.get("user_id") and str(row.get("user_id")) != str(user_id)
        }
        actor_lookup = self._resolve_user_labels_by_ids(actor_ids)
        events: List[ActivityEvent] = []
        for row in rows:
            metadata = dict(row.get("metadata") or {})
            actor_id = str(row.get("user_id") or "")
            metadata["actor_label"] = "You" if actor_id == str(user_id) else actor_lookup.get(actor_id, "Someone")
            row["metadata"] = metadata
            events.append(ActivityEvent(**row))
        return events
