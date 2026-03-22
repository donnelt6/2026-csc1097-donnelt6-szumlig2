from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import FaqEntry, FaqGenerateRequest, FaqGenerateResponse, FaqUpdateRequest, MembershipRole
from ..services.store import store
from .errors import raise_postgrest_error

router = APIRouter(prefix="/faqs", tags=["faqs"])


def _require_editor(role: MembershipRole) -> None:
    if role not in (MembershipRole.owner, MembershipRole.admin, MembershipRole.editor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner, admin, or editor role required.")


@router.get(
    "",
    response_model=list[FaqEntry],
    dependencies=[Depends(rate_limit_user_ip("faqs:read", "rate_limit_read_per_minute"))],
)
def list_faqs(
    hub_id: UUID = Query(...),
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[FaqEntry]:
    _ = current_user
    try:
        return store.list_faqs(client, str(hub_id))
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/generate",
    response_model=FaqGenerateResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(rate_limit_user_ip("faqs:write", "rate_limit_write_per_minute"))],
)
def generate_faqs(
    payload: FaqGenerateRequest,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> FaqGenerateResponse:
    if not payload.source_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select at least one source.")
    try:
        member = store.get_member_role(client, payload.hub_id, current_user.id)
        if not member.accepted_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")
        _require_editor(member.role)
        entries = store.generate_faqs(client, current_user.id, payload)
        store.log_activity(client, str(payload.hub_id), current_user.id, "generated", "faq", metadata={"count": len(entries)})
        return FaqGenerateResponse(entries=entries)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.patch(
    "/{faq_id}",
    response_model=FaqEntry,
    dependencies=[Depends(rate_limit_user_ip("faqs:write", "rate_limit_write_per_minute"))],
)
def update_faq(
    faq_id: UUID,
    payload: FaqUpdateRequest,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> FaqEntry:
    updates: dict = {}
    if payload.question is not None:
        updates["question"] = payload.question
    if payload.answer is not None:
        updates["answer"] = payload.answer
    if payload.is_pinned is not None:
        updates["is_pinned"] = payload.is_pinned
    if payload.archived is not None:
        updates["archived_at"] = datetime.now(timezone.utc).isoformat() if payload.archived else None

    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No updates provided.")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_by"] = current_user.id

    try:
        entry = store.get_faq(client, str(faq_id))
        member = store.get_member_role(client, entry.hub_id, current_user.id)
        if not member.accepted_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")
        _require_editor(member.role)
        return store.update_faq(client, str(faq_id), updates)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.delete(
    "/{faq_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit_user_ip("faqs:write", "rate_limit_write_per_minute"))],
)
def archive_faq(
    faq_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    try:
        entry = store.get_faq(client, str(faq_id))
        member = store.get_member_role(client, entry.hub_id, current_user.id)
        if not member.accepted_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not accepted yet.")
        _require_editor(member.role)
        store.archive_faq(client, str(faq_id), current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)
