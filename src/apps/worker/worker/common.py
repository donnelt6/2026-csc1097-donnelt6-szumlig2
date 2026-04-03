"""Shared worker helpers used across ingestion and reminder flows."""

from datetime import datetime
from typing import Iterable, List, Optional

from supabase import Client, create_client

from .app import settings


def _get_supabase_client() -> Client:
    # The worker only uses the service-role client because it performs
    # storage writes and background status updates outside a user request.
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase credentials missing in worker environment")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _normalize_text(text: str) -> str:
    return " ".join(text.replace("\r", "\n").split())


def _trim_text(text: str, max_chars: int) -> str:
    cleaned = _normalize_text(text)
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars].rstrip()}..."


def _batch(items: List, size: int) -> Iterable[List]:
    # Callers use this for OpenAI and database writes where smaller batches
    # are easier to retry and keep within payload limits.
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    cleaned = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        return None


__all__ = [
    "_batch",
    "_get_supabase_client",
    "_normalize_text",
    "_parse_iso",
    "_trim_text",
]
