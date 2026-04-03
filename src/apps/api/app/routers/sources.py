"""sources.py: Creates, queues, refreshes, reviews, and deletes source ingestion records."""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from uuid import UUID
from postgrest.exceptions import APIError
from supabase import Client

from ..schemas import (
    MembershipRole,
    Source,
    SourceChunk,
    SourceCreate,
    SourceEnqueueResponse,
    SourceFailureRequest,
    SourceSuggestion,
    SourceSuggestionDecision,
    SourceSuggestionDecisionResponse,
    SourceSuggestionStatus,
    SourceSuggestionType,
    SourceStatus,
    SourceStatusResponse,
    SourceUploadUrlResponse,
    WebSourceCreate,
    YouTubeSourceCreate,
)
from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..services.queue import celery_app
from ..services.store import ConflictError, store
from .errors import raise_postgrest_error

router = APIRouter(prefix="/sources", tags=["sources"])


# Source creation and ingestion routes.

# Create a file-based source record and return an upload URL when needed.
@router.post(
    "",
    response_model=SourceEnqueueResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_user_ip("sources:write", "rate_limit_sources_per_minute"))],
)
def create_source(
    payload: SourceCreate,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> SourceEnqueueResponse:
    try:
        source, upload_url = store.create_source(client, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)
    store.log_activity(client, source.hub_id, current_user.id, "created", "source", source.id, {"name": source.original_name, "type": source.type})
    return SourceEnqueueResponse(source=source, upload_url=upload_url)


# Create a web source and queue background ingestion.
@router.post(
    "/web",
    response_model=Source,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_user_ip("sources:write", "rate_limit_sources_per_minute"))],
)
def create_web_source(
    payload: WebSourceCreate,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> Source:
    try:
        source = store.create_web_source(client, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if not source.storage_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source storage path missing")
    celery_app.send_task("ingest_web_source", args=[source.id, source.hub_id, payload.url, source.storage_path])
    store.log_activity(client, source.hub_id, current_user.id, "created", "source", source.id, {"name": source.original_name, "type": "web"})
    return source


# Create a YouTube source and queue background ingestion.
@router.post(
    "/youtube",
    response_model=Source,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_user_ip("sources:write", "rate_limit_sources_per_minute"))],
)
def create_youtube_source(
    payload: YouTubeSourceCreate,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> Source:
    try:
        source = store.create_youtube_source(client, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if not source.storage_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source storage path missing")
    video_id = None
    # Video metadata may already contain a parsed YouTube video ID for the worker.
    if isinstance(source.ingestion_metadata, dict):
        video_id = source.ingestion_metadata.get("video_id")
    celery_app.send_task(
        "ingest_youtube_source",
        args=[
            source.id,
            source.hub_id,
            payload.url,
            source.storage_path,
            payload.language,
            payload.allow_auto_captions,
            video_id,
        ],
    )
    store.log_activity(client, source.hub_id, current_user.id, "created", "source", source.id, {"name": source.original_name, "type": "youtube"})
    return source


# Suggestion review routes.

# Return pending or reviewed source suggestions for a hub.
@router.get(
    "/suggestions",
    response_model=list[SourceSuggestion],
    dependencies=[Depends(rate_limit_user_ip("sources:read", "rate_limit_read_per_minute"))],
)
def list_source_suggestions(
    hub_id: UUID,
    status_filter: SourceSuggestionStatus = Query(default=SourceSuggestionStatus.pending, alias="status"),
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[SourceSuggestion]:
    _ = current_user
    try:
        return store.list_source_suggestions(client, hub_id=str(hub_id), status=status_filter.value if status_filter else None)
    except APIError as exc:
        raise_postgrest_error(exc)


# Accept or decline a source suggestion and ingest it when accepted.
@router.patch(
    "/suggestions/{suggestion_id}",
    response_model=SourceSuggestionDecisionResponse,
    dependencies=[Depends(rate_limit_user_ip("sources:write", "rate_limit_sources_per_minute"))],
)
def decide_source_suggestion(
    suggestion_id: UUID,
    decision: SourceSuggestionDecision,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> SourceSuggestionDecisionResponse:
    try:
        suggestion = store.get_source_suggestion(client, str(suggestion_id))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Suggestion not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if decision.action not in (SourceSuggestionStatus.accepted, SourceSuggestionStatus.declined):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid suggestion action.")
    if suggestion.status != SourceSuggestionStatus.pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Suggestion already reviewed.")

    try:
        membership = store.get_member_role(client, suggestion.hub_id, current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to review suggestions.") from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if membership.accepted_at is None or membership.role not in {
        MembershipRole.owner,
        MembershipRole.admin,
        MembershipRole.editor,
    }:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to review suggestions.")

    now = datetime.now(timezone.utc).isoformat()
    review_payload = {
        "status": decision.action.value,
        "reviewed_at": now,
        "reviewed_by": current_user.id,
        "accepted_source_id": None,
    }

    try:
        suggestion = store.update_source_suggestion(
            client,
            str(suggestion_id),
            review_payload,
            expected_status=SourceSuggestionStatus.pending,
        )
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Suggestion already reviewed.") from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if decision.action == SourceSuggestionStatus.declined:
        return SourceSuggestionDecisionResponse(suggestion=suggestion, source=None)

    accepted_source: Source | None = None
    task_name: str | None = None
    task_args: list[object] | None = None
    try:
        # Reuse an existing source first so accepted suggestions do not create duplicates.
        accepted_source = store.find_existing_source_for_suggestion(client, suggestion)
        if accepted_source is None:
            if suggestion.type == SourceSuggestionType.web:
                accepted_source = store.create_web_source(
                    client,
                    WebSourceCreate(hub_id=UUID(suggestion.hub_id), url=suggestion.url),
                )
                if not accepted_source.storage_path:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source storage path missing")
                task_name = "ingest_web_source"
                task_args = [accepted_source.id, accepted_source.hub_id, suggestion.url, accepted_source.storage_path]
            elif suggestion.type == SourceSuggestionType.youtube:
                accepted_source = store.create_youtube_source(
                    client,
                    YouTubeSourceCreate(hub_id=UUID(suggestion.hub_id), url=suggestion.url),
                )
                if not accepted_source.storage_path:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source storage path missing")
                video_id = None
                if isinstance(accepted_source.ingestion_metadata, dict):
                    video_id = accepted_source.ingestion_metadata.get("video_id")
                task_name = "ingest_youtube_source"
                task_args = [
                    accepted_source.id,
                    accepted_source.hub_id,
                    suggestion.url,
                    accepted_source.storage_path,
                    None,
                    False,
                    video_id,
                ]
            else:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported suggestion type")
        suggestion = store.update_source_suggestion(
            client,
            str(suggestion_id),
            {"accepted_source_id": accepted_source.id},
        )
        if task_name is not None and task_args is not None:
            celery_app.send_task(task_name, args=task_args)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if accepted_source is not None:
        store.log_activity(client, accepted_source.hub_id, current_user.id, "created", "source", accepted_source.id, {"name": accepted_source.original_name, "type": suggestion.type.value})
    return SourceSuggestionDecisionResponse(suggestion=suggestion, source=accepted_source)


# Source read and status routes.

# Return all sources for a hub.
@router.get(
    "/{hub_id}",
    response_model=list[Source],
    dependencies=[Depends(rate_limit_user_ip("sources:read", "rate_limit_read_per_minute"))],
)
def list_sources(
    hub_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[Source]:
    _ = current_user
    try:
        return store.list_sources(client, hub_id)
    except APIError as exc:
        raise_postgrest_error(exc)


# Return a signed upload URL for an existing source record.
@router.post(
    "/{source_id}/upload-url",
    response_model=SourceUploadUrlResponse,
    dependencies=[Depends(rate_limit_user_ip("sources:write", "rate_limit_sources_per_minute"))],
)
def create_upload_url(
    source_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> SourceUploadUrlResponse:
    _ = current_user
    try:
        source = store.get_source(client, source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if not source.storage_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source storage path missing")

    try:
        upload_url = store.create_upload_url(source.storage_path)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return SourceUploadUrlResponse(upload_url=upload_url)


# Return the current ingestion status for a source.
@router.get(
    "/{source_id}/status",
    response_model=SourceStatusResponse,
    dependencies=[Depends(rate_limit_user_ip("sources:read", "rate_limit_read_per_minute"))],
)
def get_source_status(
    source_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> SourceStatusResponse:
    _ = current_user
    try:
        return store.get_source_status(client, source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Return stored text chunks for a source after verifying the source exists.
@router.get(
    "/{source_id}/chunks",
    response_model=list[SourceChunk],
    dependencies=[Depends(rate_limit_user_ip("sources:read", "rate_limit_read_per_minute"))],
)
def list_source_chunks(
    source_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[SourceChunk]:
    _ = current_user
    try:
        store.get_source(client, source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)
    try:
        rows = store.list_source_chunks(client, str(source_id))
    except APIError as exc:
        raise_postgrest_error(exc)
    return [SourceChunk(**row) for row in rows]


# Queue a file-based source for ingestion.
@router.post(
    "/{source_id}/enqueue",
    dependencies=[Depends(rate_limit_user_ip("sources:write", "rate_limit_sources_per_minute"))],
)
def enqueue_source(
    source_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    try:
        source = store.get_source(client, source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if not source.storage_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source storage path missing")

    try:
        store.set_source_status(client, source.id, SourceStatus.queued, failure_reason=None)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    celery_app.send_task("ingest_source", args=[source.id, source.hub_id, source.storage_path])
    return {"status": "queued"}


# Requeue a refresh for an existing web or YouTube source.
@router.post(
    "/{source_id}/refresh",
    dependencies=[Depends(rate_limit_user_ip("sources:write", "rate_limit_sources_per_minute"))],
)
def refresh_web_source(
    source_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    _ = current_user
    try:
        source, refresh_info = store.refresh_source(client, source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if not source.storage_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source storage path missing")

    refresh_type = refresh_info.get("type")
    if refresh_type == "web":
        celery_app.send_task(
            "ingest_web_source",
            args=[source.id, source.hub_id, refresh_info.get("url"), source.storage_path],
        )
    elif refresh_type == "youtube":
        celery_app.send_task(
            "ingest_youtube_source",
            args=[
                source.id,
                source.hub_id,
                refresh_info.get("url"),
                source.storage_path,
                refresh_info.get("language"),
                refresh_info.get("allow_auto_captions"),
                refresh_info.get("video_id"),
            ],
        )
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refresh not supported for source type")
    return {"status": "queued"}


# Delete a source and log the removal.
@router.delete(
    "/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit_user_ip("sources:write", "rate_limit_sources_per_minute"))],
)
def delete_source(
    source_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    try:
        source = store.get_source(client, source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)
    try:
        store.delete_source(client, source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)
    store.log_activity(client, source.hub_id, current_user.id, "deleted", "source", source.id, {"name": source.original_name})


# Mark a source as failed with a recorded reason.
@router.post(
    "/{source_id}/fail",
    response_model=SourceStatusResponse,
    dependencies=[Depends(rate_limit_user_ip("sources:write", "rate_limit_sources_per_minute"))],
)
def fail_source(
    source_id: UUID,
    payload: SourceFailureRequest,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> SourceStatusResponse:
    _ = current_user
    try:
        source = store.set_source_status(client, source_id, SourceStatus.failed, failure_reason=payload.failure_reason)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)
    return SourceStatusResponse(id=source.id, status=source.status, failure_reason=source.failure_reason)
