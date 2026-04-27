"""tasks.py: Celery task entrypoints that delegate to focused worker modules."""

from typing import Optional

from . import ingestion as _ingestion
from . import notifications as _notifications
from . import source_suggestions as _source_suggestions
from .app import celery_app, settings


# Keep Celery task names stable while the real logic lives in dedicated modules.
@celery_app.task(bind=True, name="ingest_source", max_retries=3, default_retry_delay=15)
def ingest_source(self, source_id: str, hub_id: str, storage_path: str) -> dict:
    return _ingestion.ingest_source(self, source_id, hub_id, storage_path)


@celery_app.task(bind=True, name="ingest_web_source", max_retries=3, default_retry_delay=15)
def ingest_web_source(self, source_id: str, hub_id: str, url: str, storage_path: str) -> dict:
    return _ingestion.ingest_web_source(self, source_id, hub_id, url, storage_path)


@celery_app.task(
    bind=True,
    name="ingest_youtube_source",
    max_retries=3,
    default_retry_delay=15,
    soft_time_limit=settings.youtube_task_soft_time_limit_seconds,
    time_limit=settings.youtube_task_time_limit_seconds,
)
def ingest_youtube_source(
    self,
    source_id: str,
    hub_id: str,
    url: str,
    storage_path: str,
    language: Optional[str] = None,
    allow_auto_captions: Optional[bool] = None,
    video_id: Optional[str] = None,
) -> dict:
    return _ingestion.ingest_youtube_source(
        self,
        source_id,
        hub_id,
        url,
        storage_path,
        language=language,
        allow_auto_captions=allow_auto_captions,
        video_id=video_id,
    )


@celery_app.task(name="scan_source_suggestions")
def scan_source_suggestions() -> dict:
    return _source_suggestions.scan_source_suggestions()


@celery_app.task(name="dispatch_reminders")
def dispatch_reminders() -> dict:
    return _notifications.dispatch_reminders()

