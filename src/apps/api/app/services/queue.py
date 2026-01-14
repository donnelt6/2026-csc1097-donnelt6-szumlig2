from celery import Celery

from ..core.config import get_settings

settings = get_settings()

celery_app = Celery("caddie-api", broker=settings.redis_url, backend=settings.redis_url)
