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


# Restrict content-management actions to roles that can edit hub material.
def require_editor(member: HubMember) -> None:
    if member.role not in (MembershipRole.owner, MembershipRole.admin, MembershipRole.editor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner, admin, or editor role required.")


# Restrict management actions to owners and admins while allowing route-specific copy.
def require_owner_or_admin(
    member: HubMember,
    detail: str = "Owner or admin role required.",
) -> None:
    if member.role not in (MembershipRole.owner, MembershipRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


# Restrict sensitive hub and membership actions to the owner only.
def require_owner(member: HubMember) -> None:
    if member.role != MembershipRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner role required.")
