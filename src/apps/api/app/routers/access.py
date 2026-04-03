"""access.py: Shared router access checks for hub membership and accepted invites."""

from fastapi import HTTPException, status
from supabase import Client

from ..schemas import HubMember
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
