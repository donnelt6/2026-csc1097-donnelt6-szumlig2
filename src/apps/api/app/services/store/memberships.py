"""MembershipStoreMixin: manages hub membership lookup, invites, roles, and ownership transfer."""

from datetime import datetime, timezone
from typing import Any, List

from supabase import Client

from ...schemas import AssignableMembershipRole, Hub, HubInviteRequest, HubMember, MembershipRole


class MembershipStoreMixin:
    # Return the membership row for one user in one hub.
    def get_member_role(self, client: Client, hub_id: str, user_id: str) -> HubMember:
        response = (
            client.table("hub_members")
            .select("hub_id,user_id,role,invited_at,accepted_at")
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
        if not response.data:
            raise KeyError("Membership not found")
        return HubMember(**response.data[0])

    # List accepted members, or include pending invites when requested.
    def list_members(self, client: Client, hub_id: str, include_pending: bool) -> List[HubMember]:
        query = client.table("hub_members").select("hub_id,user_id,role,invited_at,accepted_at").eq("hub_id", str(hub_id))
        if not include_pending:
            query = query.not_.is_("accepted_at", "null")
        response = query.order("invited_at", desc=True).execute()
        return [HubMember(**row) for row in response.data]

    # Return pending invitations for a user, including basic hub information for display.
    def list_pending_invites(self, client: Client, user_id: str) -> List[dict[str, Any]]:
        response = (
            client.table("hub_members")
            .select("hub_id,role,invited_at, hubs (id, owner_id, name, description, created_at)")
            .eq("user_id", str(user_id))
            .is_("accepted_at", "null")
            .order("invited_at", desc=True)
            .execute()
        )
        return [
            {"hub": Hub(**(row.get("hubs") or {})), "role": row.get("role"), "invited_at": row.get("invited_at")}
            for row in response.data
        ]

    # Return undismissed invite notifications for a user.
    def list_invite_notifications(self, client: Client, user_id: str) -> List[dict[str, Any]]:
        response = (
            client.table("hub_members")
            .select("hub_id,role,invited_at, hubs (id, owner_id, name, description, created_at)")
            .eq("user_id", str(user_id))
            .is_("accepted_at", "null")
            .is_("invite_notification_dismissed_at", "null")
            .order("invited_at", desc=True)
            .execute()
        )
        return [
            {"hub": Hub(**(row.get("hubs") or {})), "role": row.get("role"), "invited_at": row.get("invited_at")}
            for row in response.data
        ]

    # Mark a pending invite notification as dismissed.
    def dismiss_invite_notification(self, client: Client, hub_id: str, user_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        response = (
            client.table("hub_members")
            .update({"invite_notification_dismissed_at": now})
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .is_("accepted_at", "null")
            .is_("invite_notification_dismissed_at", "null")
            .execute()
        )
        if not response.data:
            raise KeyError("Invite notification not found")

    # Invite an existing auth user into a hub with the requested role.
    def invite_member(self, client: Client, hub_id: str, payload: HubInviteRequest) -> HubMember:
        users = self.service_client.auth.admin.list_users()
        target = next((user for user in users if (user.email or "").lower() == payload.email.lower()), None)
        if not target or not target.id:
            raise ValueError("User not found. They must already have an account.")
        response = (
            client.table("hub_members")
            .insert(
                {
                    "hub_id": str(hub_id),
                    "user_id": target.id,
                    "role": payload.role.value,
                    "invite_notification_dismissed_at": None,
                }
            )
            .execute()
        )
        row = response.data[0]
        row["email"] = target.email
        return HubMember(**row)

    # Accept a pending invite and stamp the acceptance/access timestamps together.
    def accept_invite(self, client: Client, hub_id: str, user_id: str) -> HubMember:
        now = datetime.now(timezone.utc).isoformat()
        response = (
            client.table("hub_members")
            .update({"accepted_at": now, "last_accessed_at": now})
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .is_("accepted_at", "null")
            .execute()
        )
        if not response.data:
            raise KeyError("Invite not found")
        return HubMember(**response.data[0])

    # Change a member's role while protecting the owner from direct demotion.
    def update_member_role(
        self,
        client: Client,
        hub_id: str,
        user_id: str,
        role: AssignableMembershipRole,
    ) -> HubMember:
        target_member = self.get_member_role(client, hub_id, user_id)
        if target_member.role == MembershipRole.owner:
            raise ValueError("Transfer ownership before removing or changing the owner.")
        response = (
            client.table("hub_members")
            .update({"role": role.value})
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Member not found")
        return HubMember(**response.data[0])

    # Transfer hub ownership through the dedicated RPC to keep owner/admin state consistent.
    def transfer_hub_ownership(self, hub_id: str, current_owner_id: str, target_user_id: str) -> HubMember:
        response = self.service_client.rpc(
            "transfer_hub_ownership",
            {
                "p_hub_id": str(hub_id),
                "p_current_owner_id": str(current_owner_id),
                "p_target_user_id": str(target_user_id),
            },
        ).execute()
        data = response.data or []
        if not data:
            raise RuntimeError("Ownership transfer failed.")
        member_response = (
            self.service_client.table("hub_members")
            .select("hub_id,user_id,role,invited_at,accepted_at")
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(target_user_id))
            .limit(1)
            .execute()
        )
        if not member_response.data:
            raise KeyError("Transferred owner not found")
        return HubMember(**member_response.data[0])

    # Remove a non-owner member from the hub.
    def remove_member(self, client: Client, hub_id: str, user_id: str) -> None:
        target_member = self.get_member_role(client, hub_id, user_id)
        if target_member.role == MembershipRole.owner:
            raise ValueError("Transfer ownership before removing or changing the owner.")
        response = client.table("hub_members").delete().eq("hub_id", str(hub_id)).eq("user_id", str(user_id)).execute()
        if not response.data:
            raise KeyError("Member not found")
