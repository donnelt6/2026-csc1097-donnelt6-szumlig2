"""__init__.py: Re-exports the worker Celery app for package-level imports."""

# Exposes the shared Celery app so other modules can import `worker.celery_app`.
from .app import celery_app

__all__ = ["celery_app"]
