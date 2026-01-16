from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client
from ..schemas import HubInviteRequest, HubInviteResponse, HubMember, HubMemberUpdate, PendingInvite
from ..services.store import store
from .errors import raise_postgrest_error

router = APIRouter(prefix="", tags=["memberships"])


def _require_accepted(member: HubMember) -> None:
    if not member.accepted_at:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")


def _require_owner(member: HubMember) -> None:
    if member.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner role required.")


def _ensure_not_last_owner(client: Client, hub_id: str, target_user_id: str) -> None:
    owners = (
        client.table("hub_members")
        .select("user_id")
        .eq("hub_id", hub_id)
        .eq("role", "owner")
        .not_.is_("accepted_at", "null")
        .execute()
    )
    owner_ids = {row["user_id"] for row in owners.data}
    if target_user_id in owner_ids and len(owner_ids) <= 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hub must have at least one owner.")


def _attach_emails(members: List[HubMember]) -> List[HubMember]:
    users = store.service_client.auth.admin.list_users()
    email_by_id = {user.id: user.email for user in users if user.id}
    for member in members:
        member.email = email_by_id.get(member.user_id)
    return members


@router.get("/hubs/{hub_id}/members", response_model=list[HubMember])
def list_members(
    hub_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> list[HubMember]:
    try:
        member = store.get_member_role(client, hub_id, current_user.id)
        _require_accepted(member)
        include_pending = member.role == "owner"
        members = store.list_members(client, hub_id, include_pending=include_pending)
        return _attach_emails(members)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.get("/invites", response_model=list[PendingInvite])
def list_pending_invites(
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> list[PendingInvite]:
    try:
        return store.list_pending_invites(client, current_user.id)
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post("/hubs/{hub_id}/members/invite", response_model=HubInviteResponse, status_code=status.HTTP_201_CREATED)
def invite_member(
    hub_id: str,
    payload: HubInviteRequest,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> HubInviteResponse:
    try:
        if current_user.email and payload.email.lower() == current_user.email.lower():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You already have access.")
        member = store.get_member_role(client, hub_id, current_user.id)
        _require_accepted(member)
        _require_owner(member)
        invited = store.invite_member(client, hub_id, payload)
        return HubInviteResponse(member=invited)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post("/hubs/{hub_id}/members/accept", response_model=HubMember)
def accept_invite(
    hub_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> HubMember:
    try:
        return store.accept_invite(client, hub_id, current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.patch("/hubs/{hub_id}/members/{user_id}", response_model=HubMember)
def update_member_role(
    hub_id: str,
    user_id: str,
    payload: HubMemberUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> HubMember:
    try:
        member = store.get_member_role(client, hub_id, current_user.id)
        _require_accepted(member)
        _require_owner(member)
        _ensure_not_last_owner(client, hub_id, user_id)
        return store.update_member_role(client, hub_id, user_id, payload.role)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.delete("/hubs/{hub_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    hub_id: str,
    user_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> None:
    try:
        member = store.get_member_role(client, hub_id, current_user.id)
        _require_accepted(member)
        _require_owner(member)
        _ensure_not_last_owner(client, hub_id, user_id)
        store.remove_member(client, hub_id, user_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)
