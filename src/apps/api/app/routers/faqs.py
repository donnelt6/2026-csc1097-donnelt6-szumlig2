"""faqs.py: Lists, creates, generates, updates, and archives FAQ entries for hubs."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import FaqCreateRequest, FaqEntry, FaqGenerateRequest, FaqGenerateResponse, FaqUpdateRequest
from ..services.store import store
from .access import require_accepted, require_editor, require_hub_member
from .errors import raise_postgrest_error

router = APIRouter(prefix="/faqs", tags=["faqs"])


# FAQ routes.

# Return all FAQ entries for a hub.
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
    member = require_hub_member(client, str(hub_id), current_user.id)
    require_accepted(member)
    try:
        return store.list_faqs(client, str(hub_id))
    except APIError as exc:
        raise_postgrest_error(exc)


# Create a single FAQ entry manually.
@router.post(
    "",
    response_model=FaqEntry,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_user_ip("faqs:write", "rate_limit_write_per_minute"))],
)
def create_faq(
    payload: FaqCreateRequest,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> FaqEntry:
    try:
        # Re-check membership directly from the payload's hub before creating content.
        member = store.get_member_role(client, payload.hub_id, current_user.id)
        require_accepted(member)
        require_editor(member)
        entry = store.create_faq(client, str(payload.hub_id), current_user.id, payload.question, payload.answer)
        store.log_activity(client, str(payload.hub_id), current_user.id, "created", "faq")
        return entry
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Generate FAQ entries from selected source documents.
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
        require_accepted(member)
        require_editor(member)
        entries = store.generate_faqs(client, current_user.id, payload)
        store.log_activity(client, str(payload.hub_id), current_user.id, "generated", "faq", metadata={"count": len(entries)})
        return FaqGenerateResponse(entries=entries)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Update an FAQ's content or archive/pin state.
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
    # Only include fields the caller actually wants to change.
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
        require_accepted(member)
        require_editor(member)
        result = store.update_faq(client, str(faq_id), updates)
        if payload.archived is not None:
            action = "archived" if payload.archived else "unarchived"
        elif payload.is_pinned is not None:
            action = "pinned" if payload.is_pinned else "unpinned"
        else:
            action = "updated"
        store.log_activity(client, entry.hub_id, current_user.id, action, "faq")
        return result
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Archive an FAQ entry.
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
        require_accepted(member)
        require_editor(member)
        store.archive_faq(client, str(faq_id), current_user.id)
        store.log_activity(client, entry.hub_id, current_user.id, "deleted", "faq")
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)
