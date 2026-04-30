"""queue.py: Configures the Celery app used for background ingestion and async jobs."""

from celery import Celery

from ..core.config import get_settings

# Load shared settings before creating the queue client.
settings = get_settings()

# Create the Celery application with Redis as both broker and result backend.
celery_app = Celery("caddie-api", broker=settings.redis_url, backend=settings.redis_url)
# Match the worker app's UTC clock so API-enqueued tasks are interpreted
# consistently across local and hosted Celery nodes.
celery_app.conf.enable_utc = True
celery_app.conf.timezone = "UTC"
