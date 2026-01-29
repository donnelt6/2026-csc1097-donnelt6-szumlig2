from fastapi import APIRouter, Depends, HTTPException, status
from uuid import UUID
from postgrest.exceptions import APIError
from supabase import Client

from ..schemas import (
    Source,
    SourceCreate,
    SourceEnqueueResponse,
    SourceFailureRequest,
    SourceStatus,
    SourceStatusResponse,
    SourceUploadUrlResponse,
    WebSourceCreate,
)
from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..services.queue import celery_app
from ..services.store import store
from .errors import raise_postgrest_error

router = APIRouter(prefix="/sources", tags=["sources"])


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
        return SourceEnqueueResponse(source=source, upload_url=upload_url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


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
    _ = current_user
    try:
        source = store.create_web_source(client, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if not source.storage_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source storage path missing")
    celery_app.send_task("ingest_web_source", args=[source.id, source.hub_id, payload.url, source.storage_path])
    return source


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
        source, url = store.refresh_web_source(client, source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if not source.storage_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source storage path missing")

    celery_app.send_task("ingest_web_source", args=[source.id, source.hub_id, url, source.storage_path])
    return {"status": "queued"}


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
    _ = current_user
    try:
        store.delete_source(client, source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)


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
