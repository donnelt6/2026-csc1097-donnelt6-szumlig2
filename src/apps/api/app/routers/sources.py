from fastapi import APIRouter, HTTPException, status

from ..schemas import Source, SourceCreate, SourceEnqueueResponse, SourceStatusResponse
from ..core.config import get_settings
from ..services.queue import celery_app
from ..services.rate_limit import rate_limiter
from ..services.store import store

router = APIRouter(prefix="/sources", tags=["sources"])
settings = get_settings()


@router.get("/{hub_id}", response_model=list[Source])
def list_sources(hub_id: str) -> list[Source]:
    return store.list_sources(hub_id)


@router.post("", response_model=SourceEnqueueResponse, status_code=status.HTTP_201_CREATED)
def create_source(payload: SourceCreate) -> SourceEnqueueResponse:
    limit = settings.rate_limit_sources_per_minute
    rl = rate_limiter.check(f"sources:{store.dev_user_id}", limit)
    if not rl.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Try again in {rl.reset_in_seconds}s.",
        )
    try:
        source, upload_url = store.create_source(payload)
        return SourceEnqueueResponse(source=source, upload_url=upload_url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{source_id}/status", response_model=SourceStatusResponse)
def get_source_status(source_id: str) -> SourceStatusResponse:
    try:
        return store.get_source_status(source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc


@router.post("/{source_id}/enqueue")
def enqueue_source(source_id: str) -> dict[str, str]:
    limit = settings.rate_limit_sources_per_minute
    rl = rate_limiter.check(f"sources:{store.dev_user_id}", limit)
    if not rl.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Try again in {rl.reset_in_seconds}s.",
        )
    try:
        source = store.get_source(source_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found") from exc

    if not source.storage_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source storage path missing")

    celery_app.send_task("ingest_source", args=[source.id, source.hub_id, source.storage_path])
    return {"status": "queued"}
