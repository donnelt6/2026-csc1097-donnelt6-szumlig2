"""access.py: Shared router access checks for hub membership and accepted invites."""

from fastapi import HTTPException, status
from supabase import Client

from ..schemas import HubMember, MembershipRole
from ..services.store import store


# Membership access helpers.

# Ensure the user belongs to the hub before a route continues.
def require_hub_member(client: Client, hub_id: str, user_id: str) -> HubMember:
    try:
        return store.get_member_role(client, hub_id, user_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Hub access required.") from exc


# Ensure the user has accepted their invite before using hub features.
def require_accepted(member: HubMember) -> None:
    if not member.accepted_at:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")


def _role_value(member_or_role: HubMember | MembershipRole | str) -> MembershipRole | str:
    return getattr(member_or_role, "role", member_or_role)


# Restrict content-management actions to roles that can edit hub material.
def require_editor(member_or_role: HubMember | MembershipRole | str) -> None:
    if _role_value(member_or_role) not in (MembershipRole.owner, MembershipRole.admin, MembershipRole.editor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner, admin, or editor role required.")


# Restrict management actions to owners and admins while allowing route-specific copy.
def require_owner_or_admin(
    member_or_role: HubMember | MembershipRole | str,
    detail: str = "Owner or admin role required.",
) -> None:
    if _role_value(member_or_role) not in (MembershipRole.owner, MembershipRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


# Restrict sensitive hub and membership actions to the owner only.
def require_owner(member_or_role: HubMember | MembershipRole | str) -> None:
    if _role_value(member_or_role) != MembershipRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner role required.")
