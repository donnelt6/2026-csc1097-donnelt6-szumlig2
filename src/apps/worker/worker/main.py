"""main.py: Exposes the worker Celery app as the module entry point."""

# Re-exports the shared Celery app for Celery worker startup commands.
from .tasks import celery_app

__all__ = ["celery_app"]
