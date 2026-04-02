from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import (
    GuideEntry,
    GuideGenerateRequest,
    GuideGenerateResponse,
    GuideStep,
    GuideStepCreateRequest,
    GuideStepProgressUpdate,
    GuideStepReorderRequest,
    GuideStepUpdateRequest,
    GuideUpdateRequest,
    MembershipRole,
)
from ..services.store import store
from .errors import raise_postgrest_error

router = APIRouter(prefix="/guides", tags=["guides"])


def _require_editor(role: MembershipRole) -> None:
    if role not in (MembershipRole.owner, MembershipRole.admin, MembershipRole.editor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner, admin, or editor role required.")


@router.get(
    "",
    response_model=list[GuideEntry],
    dependencies=[Depends(rate_limit_user_ip("guides:read", "rate_limit_read_per_minute"))],
)
def list_guides(
    hub_id: UUID = Query(...),
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[GuideEntry]:
    try:
        return store.list_guides(client, current_user.id, str(hub_id))
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/generate",
    response_model=GuideGenerateResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(rate_limit_user_ip("guides:write", "rate_limit_write_per_minute"))],
)
def generate_guide(
    payload: GuideGenerateRequest,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> GuideGenerateResponse:
    if not payload.source_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select at least one source.")
    try:
        member = store.get_member_role(client, payload.hub_id, current_user.id)
        if not member.accepted_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")
        _require_editor(member.role)
        entry = store.generate_guide(client, current_user.id, payload)
        store.log_activity(client, str(payload.hub_id), current_user.id, "generated", "guide", entry.id, {"title": entry.title})
        return GuideGenerateResponse(entry=entry)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.patch(
    "/{guide_id}",
    response_model=GuideEntry,
    dependencies=[Depends(rate_limit_user_ip("guides:write", "rate_limit_write_per_minute"))],
)
def update_guide(
    guide_id: UUID,
    payload: GuideUpdateRequest,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> GuideEntry:
    updates: dict = {}
    if payload.title is not None:
        updates["title"] = payload.title
    if payload.topic is not None:
        updates["topic"] = payload.topic
    if payload.summary is not None:
        updates["summary"] = payload.summary
    if payload.is_favourited is not None:
        updates["is_favourited"] = payload.is_favourited
    if payload.archived is not None:
        updates["archived_at"] = datetime.now(timezone.utc).isoformat() if payload.archived else None

    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No updates provided.")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_by"] = current_user.id

    try:
        entry = store.get_guide(client, str(guide_id))
        member = store.get_member_role(client, entry.hub_id, current_user.id)
        if not member.accepted_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")
        _require_editor(member.role)
        return store.update_guide(client, str(guide_id), updates)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.patch(
    "/steps/{step_id}",
    response_model=GuideStep,
    dependencies=[Depends(rate_limit_user_ip("guides:write", "rate_limit_write_per_minute"))],
)
def update_guide_step(
    step_id: UUID,
    payload: GuideStepUpdateRequest,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> GuideStep:
    updates: dict = {}
    if payload.title is not None:
        updates["title"] = payload.title
    if payload.instruction is not None:
        updates["instruction"] = payload.instruction

    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No updates provided.")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        step = store.get_guide_step(client, str(step_id))
        entry = store.get_guide(client, step.guide_id)
        member = store.get_member_role(client, entry.hub_id, current_user.id)
        if not member.accepted_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")
        _require_editor(member.role)
        return store.update_guide_step(client, str(step_id), updates)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/{guide_id}/steps",
    response_model=GuideStep,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_user_ip("guides:write", "rate_limit_write_per_minute"))],
)
def create_guide_step(
    guide_id: UUID,
    payload: GuideStepCreateRequest,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> GuideStep:
    try:
        entry = store.get_guide(client, str(guide_id))
        member = store.get_member_role(client, entry.hub_id, current_user.id)
        if not member.accepted_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")
        _require_editor(member.role)
        return store.create_guide_step(client, str(guide_id), payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/{guide_id}/steps/reorder",
    response_model=list[GuideStep],
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(rate_limit_user_ip("guides:write", "rate_limit_write_per_minute"))],
)
def reorder_guide_steps(
    guide_id: UUID,
    payload: GuideStepReorderRequest,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[GuideStep]:
    try:
        entry = store.get_guide(client, str(guide_id))
        member = store.get_member_role(client, entry.hub_id, current_user.id)
        if not member.accepted_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")
        _require_editor(member.role)
        ordered_ids = [str(step_id) for step_id in payload.ordered_step_ids]
        return store.reorder_guide_steps(client, str(guide_id), ordered_ids)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.patch(
    "/steps/{step_id}/progress",
    response_model=GuideStep,
    dependencies=[Depends(rate_limit_user_ip("guides:write", "rate_limit_write_per_minute"))],
)
def update_guide_progress(
    step_id: UUID,
    payload: GuideStepProgressUpdate,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> GuideStep:
    try:
        step = store.get_guide_step(client, str(step_id))
        entry = store.get_guide(client, step.guide_id)
        member = store.get_member_role(client, entry.hub_id, current_user.id)
        if not member.accepted_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")
        store.upsert_guide_step_progress(client, current_user.id, step.guide_id, str(step_id), payload)
        return step
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.delete(
    "/{guide_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit_user_ip("guides:write", "rate_limit_write_per_minute"))],
)
def archive_guide(
    guide_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    try:
        entry = store.get_guide(client, str(guide_id))
        member = store.get_member_role(client, entry.hub_id, current_user.id)
        if not member.accepted_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")
        _require_editor(member.role)
        store.archive_guide(client, str(guide_id), current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)
