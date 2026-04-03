"""moderation.py: Lets users flag chat messages and lets moderators review flagged chat cases."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import (
    ApplyRevisionRequest,
    ContentFlag,
    ContentFlagRequest,
    ContentFlagResponse,
    ContentFlagStatus,
    ContentFlagType,
    CreateRevisionRequest,
    FlagCase,
    FlagCaseStatus,
    FlagMessageRequest,
    FlagMessageResponse,
    FlaggedChatDetail,
    FlaggedChatQueueItem,
    FlaggedContentQueueItem,
    MessageRevision,
)
from ..services.store import store
from .errors import raise_postgrest_error

router = APIRouter(prefix="", tags=["moderation"])


# Moderation routes.

# Flag a message for moderation review.
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
        # Reused flags return 200; new flags return 201.
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


# Return the flagged chat queue for a hub.
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


# Return the full detail for one flagged chat case.
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


# Regenerate an alternative response revision for a flagged chat.
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


# Create a manual revision for a flagged chat response.
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


# Apply a selected revision to resolve a flagged chat case.
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


# Dismiss a flagged chat case without applying a revision.
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


@router.post(
    "/faqs/{faq_id}/flag",
    response_model=ContentFlagResponse,
    dependencies=[Depends(rate_limit_user_ip("moderation:write", "rate_limit_write_per_minute"))],
)
def flag_faq(
    faq_id: UUID,
    payload: ContentFlagRequest,
    response: Response,
    current_user: CurrentUser = Depends(get_current_user),
) -> ContentFlagResponse:
    try:
        result = store.flag_content(current_user.id, ContentFlagType.faq, str(faq_id), payload)
        response.status_code = status.HTTP_201_CREATED if result.created else status.HTTP_200_OK
        return result
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/guides/{guide_id}/flag",
    response_model=ContentFlagResponse,
    dependencies=[Depends(rate_limit_user_ip("moderation:write", "rate_limit_write_per_minute"))],
)
def flag_guide(
    guide_id: UUID,
    payload: ContentFlagRequest,
    response: Response,
    current_user: CurrentUser = Depends(get_current_user),
) -> ContentFlagResponse:
    try:
        result = store.flag_content(current_user.id, ContentFlagType.guide, str(guide_id), payload)
        response.status_code = status.HTTP_201_CREATED if result.created else status.HTTP_200_OK
        return result
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.get(
    "/hubs/{hub_id}/flagged-content",
    response_model=list[FlaggedContentQueueItem],
    dependencies=[Depends(rate_limit_user_ip("moderation:read", "rate_limit_read_per_minute"))],
)
def list_flagged_content(
    hub_id: UUID,
    status_filter: ContentFlagStatus | None = Query(default=None, alias="status"),
    content_type_filter: ContentFlagType | None = Query(default=None, alias="content_type"),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[FlaggedContentQueueItem]:
    try:
        return store.list_flagged_content(
            current_user.id,
            str(hub_id),
            status_filter=status_filter,
            content_type_filter=content_type_filter,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/hubs/{hub_id}/flagged-content/{flag_id}/resolve",
    response_model=ContentFlag,
    dependencies=[Depends(rate_limit_user_ip("moderation:write", "rate_limit_write_per_minute"))],
)
def resolve_content_flag(
    hub_id: UUID,
    flag_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
) -> ContentFlag:
    try:
        return store.resolve_content_flag(current_user.id, str(hub_id), str(flag_id))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/hubs/{hub_id}/flagged-content/{flag_id}/dismiss",
    response_model=ContentFlag,
    dependencies=[Depends(rate_limit_user_ip("moderation:write", "rate_limit_write_per_minute"))],
)
def dismiss_content_flag(
    hub_id: UUID,
    flag_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
) -> ContentFlag:
    try:
        return store.dismiss_content_flag(current_user.id, str(hub_id), str(flag_id))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)
