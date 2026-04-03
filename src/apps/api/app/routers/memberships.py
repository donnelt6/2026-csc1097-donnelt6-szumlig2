"""memberships.py: Manages hub members, invites, profile enrichment, and ownership changes."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import HubInviteRequest, HubInviteResponse, HubMember, HubMemberUpdate, MembershipRole, PendingInvite
from ..services.store import store
from .errors import raise_postgrest_error

router = APIRouter(prefix="", tags=["memberships"])


# Membership permission helpers.

# Ensure the member has accepted the invite before continuing.
def _require_accepted(member: HubMember) -> None:
    if not member.accepted_at:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")


# Restrict owner-only membership actions.
def _require_owner(member: HubMember) -> None:
    if member.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner role required.")


# Attach profile data so membership responses include user-facing details.
def _attach_profiles(members: list[HubMember]) -> list[HubMember]:
    profile_by_id = store.resolve_user_profiles_by_ids({member.user_id for member in members})
    for member in members:
        profile = profile_by_id.get(member.user_id)
        if not profile:
            continue
        member.email = profile.email
        member.display_name = profile.display_name
        member.avatar_mode = profile.avatar_mode
        member.avatar_key = profile.avatar_key
        member.avatar_color = profile.avatar_color
    return members


# Membership routes.

# Return the member list for a hub, including pending invites for owners.
@router.get(
    "/hubs/{hub_id}/members",
    response_model=list[HubMember],
    dependencies=[Depends(rate_limit_user_ip("memberships:read", "rate_limit_read_per_minute"))],
)
def list_members(
    hub_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> list[HubMember]:
    try:
        member = store.get_member_role(client, hub_id, current_user.id)
        _require_accepted(member)
        # Owners can see pending invites; other roles only see accepted members.
        include_pending = member.role == "owner"
        members = store.list_members(client, hub_id, include_pending=include_pending)
        return _attach_profiles(members)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Return all pending invites addressed to the current user.
@router.get(
    "/invites",
    response_model=list[PendingInvite],
    dependencies=[Depends(rate_limit_user_ip("memberships:read", "rate_limit_read_per_minute"))],
)
def list_pending_invites(
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> list[PendingInvite]:
    try:
        return store.list_pending_invites(client, current_user.id)
    except APIError as exc:
        raise_postgrest_error(exc)


# Return invite notifications that should appear in the UI.
@router.get(
    "/invites/notifications",
    response_model=list[PendingInvite],
    dependencies=[Depends(rate_limit_user_ip("memberships:read", "rate_limit_read_per_minute"))],
)
def list_invite_notifications(
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> list[PendingInvite]:
    try:
        return store.list_invite_notifications(client, current_user.id)
    except APIError as exc:
        raise_postgrest_error(exc)


# Invite a new member into a hub.
@router.post(
    "/hubs/{hub_id}/members/invite",
    response_model=HubInviteResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_user_ip("memberships:write", "rate_limit_write_per_minute"))],
)
def invite_member(
    hub_id: UUID,
    payload: HubInviteRequest,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> HubInviteResponse:
    try:
        # Reject self-invites early for a clearer client error.
        if current_user.email and payload.email.lower() == current_user.email.lower():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You already have access.")
        member = store.get_member_role(client, hub_id, current_user.id)
        _require_accepted(member)
        _require_owner(member)
        invited = store.invite_member(client, hub_id, payload)
        store.log_activity(client, str(hub_id), current_user.id, "invited", "member", invited.user_id, {"email": payload.email, "role": payload.role.value})
        return HubInviteResponse(member=invited)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Accept a pending invite for the current user.
@router.post(
    "/hubs/{hub_id}/members/accept",
    response_model=HubMember,
    dependencies=[Depends(rate_limit_user_ip("memberships:write", "rate_limit_write_per_minute"))],
)
def accept_invite(
    hub_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> HubMember:
    try:
        accepted = store.accept_invite(client, hub_id, current_user.id)
        store.log_activity(client, str(hub_id), current_user.id, "joined", "member", current_user.id)
        return accepted
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Dismiss an invite notification without accepting it.
@router.post(
    "/hubs/{hub_id}/members/dismiss-notification",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit_user_ip("memberships:write", "rate_limit_write_per_minute"))],
)
def dismiss_invite_notification(
    hub_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> None:
    try:
        store.dismiss_invite_notification(client, str(hub_id), current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Change another member's role within a hub.
@router.patch(
    "/hubs/{hub_id}/members/{user_id}",
    response_model=HubMember,
    dependencies=[Depends(rate_limit_user_ip("memberships:write", "rate_limit_write_per_minute"))],
)
def update_member_role(
    hub_id: UUID,
    user_id: UUID,
    payload: HubMemberUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> HubMember:
    try:
        member = store.get_member_role(client, hub_id, current_user.id)
        _require_accepted(member)
        _require_owner(member)
        result = store.update_member_role(client, hub_id, user_id, payload.role)
        store.log_activity(client, str(hub_id), current_user.id, "updated_role", "member", str(user_id), {"role": payload.role.value})
        return result
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Remove a member from the hub.
@router.delete(
    "/hubs/{hub_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit_user_ip("memberships:write", "rate_limit_write_per_minute"))],
)
def remove_member(
    hub_id: UUID,
    user_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> None:
    try:
        member = store.get_member_role(client, hub_id, current_user.id)
        _require_accepted(member)
        _require_owner(member)
        store.remove_member(client, hub_id, user_id)
        store.log_activity(client, str(hub_id), current_user.id, "removed", "member", str(user_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Transfer hub ownership from the current owner to an accepted admin.
@router.post(
    "/hubs/{hub_id}/members/{user_id}/transfer-ownership",
    response_model=HubMember,
    dependencies=[Depends(rate_limit_user_ip("memberships:write", "rate_limit_write_per_minute"))],
)
def transfer_ownership(
    hub_id: UUID,
    user_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> HubMember:
    try:
        member = store.get_member_role(client, hub_id, current_user.id)
        _require_accepted(member)
        _require_owner(member)
        target_member = store.get_member_role(client, hub_id, str(user_id))
        _require_accepted(target_member)
        # Ownership transfers are intentionally limited to admins to keep the flow predictable.
        if target_member.role != MembershipRole.admin:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ownership can only transfer to an accepted admin.",
            )
        result = store.transfer_hub_ownership(str(hub_id), current_user.id, str(user_id))
        store.log_activity(client, str(hub_id), current_user.id, "transferred_ownership", "member", str(user_id))
        return result
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)
