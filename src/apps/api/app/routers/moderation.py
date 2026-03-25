from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import (
    ApplyRevisionRequest,
    CreateRevisionRequest,
    FlagCase,
    FlagCaseStatus,
    FlagMessageRequest,
    FlagMessageResponse,
    FlaggedChatDetail,
    FlaggedChatQueueItem,
    MessageRevision,
)
from ..services.store import store
from .errors import raise_postgrest_error

router = APIRouter(prefix="", tags=["moderation"])


@router.post(
    "/messages/{message_id}/flag",
    response_model=FlagMessageResponse,
    dependencies=[Depends(rate_limit_user_ip("moderation:write", "rate_limit_write_per_minute"))],
)
def flag_message(
    message_id: UUID,
    payload: FlagMessageRequest,
    response: Response,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> FlagMessageResponse:
    try:
        result = store.flag_message(client, current_user.id, str(message_id), payload)
        response.status_code = status.HTTP_201_CREATED if result.created else status.HTTP_200_OK
        return result
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.get(
    "/hubs/{hub_id}/flagged-chats",
    response_model=list[FlaggedChatQueueItem],
    dependencies=[Depends(rate_limit_user_ip("moderation:read", "rate_limit_read_per_minute"))],
)
def list_flagged_chats(
    hub_id: UUID,
    status_filter: FlagCaseStatus | None = Query(default=None, alias="status"),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[FlaggedChatQueueItem]:
    try:
        return store.list_flagged_chat_queue(
            current_user.id,
            str(hub_id),
            status_filter=status_filter,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.get(
    "/hubs/{hub_id}/flagged-chats/{flag_id}",
    response_model=FlaggedChatDetail,
    dependencies=[Depends(rate_limit_user_ip("moderation:read", "rate_limit_read_per_minute"))],
)
def get_flagged_chat(
    hub_id: UUID,
    flag_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
) -> FlaggedChatDetail:
    try:
        return store.get_flagged_chat_detail(current_user.id, str(hub_id), str(flag_id))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/hubs/{hub_id}/flagged-chats/{flag_id}/regenerate",
    response_model=MessageRevision,
    dependencies=[Depends(rate_limit_user_ip("moderation:write", "rate_limit_write_per_minute"))],
)
def regenerate_flagged_chat(
    hub_id: UUID,
    flag_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
) -> MessageRevision:
    try:
        return store.regenerate_flagged_chat_revision(current_user.id, str(hub_id), str(flag_id))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/hubs/{hub_id}/flagged-chats/{flag_id}/revisions",
    response_model=MessageRevision,
    dependencies=[Depends(rate_limit_user_ip("moderation:write", "rate_limit_write_per_minute"))],
)
def create_flagged_chat_revision(
    hub_id: UUID,
    flag_id: UUID,
    payload: CreateRevisionRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> MessageRevision:
    try:
        return store.create_flagged_chat_revision(current_user.id, str(hub_id), str(flag_id), payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/hubs/{hub_id}/flagged-chats/{flag_id}/apply",
    response_model=FlagCase,
    dependencies=[Depends(rate_limit_user_ip("moderation:write", "rate_limit_write_per_minute"))],
)
def apply_flagged_chat_revision(
    hub_id: UUID,
    flag_id: UUID,
    payload: ApplyRevisionRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> FlagCase:
    try:
        return store.apply_flagged_chat_revision(current_user.id, str(hub_id), str(flag_id), str(payload.revision_id))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/hubs/{hub_id}/flagged-chats/{flag_id}/dismiss",
    response_model=FlagCase,
    dependencies=[Depends(rate_limit_user_ip("moderation:write", "rate_limit_write_per_minute"))],
)
def dismiss_flagged_chat(
    hub_id: UUID,
    flag_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
) -> FlagCase:
    try:
        return store.dismiss_flagged_chat(current_user.id, str(hub_id), str(flag_id))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)
