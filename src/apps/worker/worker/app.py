"""Shared worker app configuration and package-level state."""

import logging

from celery import Celery
from celery.schedules import crontab

from .config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Keep one shared Celery app instance so `worker.tasks` and `worker.main`
# both point at the same broker, backend, and beat schedule.
celery_app = Celery("caddie-worker", broker=settings.redis_url, backend=settings.redis_url)
# Force Celery internals onto UTC so mixed local/hosted workers do not drift by
# local timezone or DST differences when scheduling and exchanging heartbeats.
celery_app.conf.enable_utc = True
celery_app.conf.timezone = "UTC"
celery_app.conf.beat_schedule = {
    "dispatch-reminders": {
        "task": "dispatch_reminders",
        "schedule": crontab(minute=f"*/{max(1, settings.reminder_dispatch_window_minutes)}"),
    },
    "scan-source-suggestions": {
        "task": "scan_source_suggestions",
        "schedule": crontab(minute=f"*/{max(1, settings.suggested_sources_scan_interval_minutes)}"),
    },
}

__all__ = ["celery_app", "logger", "settings"]
