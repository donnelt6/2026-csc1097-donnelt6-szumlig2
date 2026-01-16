from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError
from supabase import Client

from ..schemas import Source, SourceCreate, SourceEnqueueResponse, SourceStatusResponse
from ..core.config import get_settings
from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client
from ..services.queue import celery_app
from ..services.rate_limit import rate_limiter
from ..services.store import store
from .errors import raise_postgrest_error

router = APIRouter(prefix="/sources", tags=["sources"])
settings = get_settings()


@router.get("/{hub_id}", response_model=list[Source])
def list_sources(
    hub_id: str,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[Source]:
    _ = current_user
    try:
        return store.list_sources(client, hub_id)
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post("", response_model=SourceEnqueueResponse, status_code=status.HTTP_201_CREATED)
def create_source(
    payload: SourceCreate,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> SourceEnqueueResponse:
    limit = settings.rate_limit_sources_per_minute
    rl = rate_limiter.check(f"sources:{current_user.id}", limit)
    if not rl.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Try again in {rl.reset_in_seconds}s.",
        )
    try:
        source, upload_url = store.create_source(client, payload)
        return SourceEnqueueResponse(source=source, upload_url=upload_url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.get("/{source_id}/status", response_model=SourceStatusResponse)
def get_source_status(
    source_id: str,
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


@router.post("/{source_id}/enqueue")
def enqueue_source(
    source_id: str,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    limit = settings.rate_limit_sources_per_minute
    rl = rate_limiter.check(f"sources:{current_user.id}", limit)
    if not rl.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Try again in {rl.reset_in_seconds}s.",
        )
    try:
        source = store.get_source(client, source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    if not source.storage_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source storage path missing")

    celery_app.send_task("ingest_source", args=[source.id, source.hub_id, source.storage_path])
    return {"status": "queued"}
