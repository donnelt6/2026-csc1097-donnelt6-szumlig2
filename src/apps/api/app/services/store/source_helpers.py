"""Source-specific helper functions for storage paths and URL normalization."""

import re
from datetime import datetime, timezone
from pathlib import PurePath
from urllib.parse import urlparse

from shared_schemas.url_utils import canonicalize_web_url, extract_youtube_video_id, normalize_youtube_id

_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._ -]")


# Centralize storage-safe filename cleanup so file, web, and YouTube source
# creation all use the same path rules.
def _sanitize_filename(name: str) -> str:
    base = PurePath(name).name.strip()
    base = _FILENAME_SAFE_RE.sub("_", base)
    base = base.strip(" ._-")
    if not base:
        raise ValueError("Invalid file name.")
    if len(base) > 255:
        base = base[:255]
    return base


def _web_storage_path(hub_id: str, source_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{hub_id}/{source_id}/web-{stamp}.md"


def _youtube_storage_path(hub_id: str, source_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{hub_id}/{source_id}/youtube-{stamp}.md"


def _build_web_source_name(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc or parsed.path or url
    display = host.strip()
    if parsed.path and parsed.path not in {"/", ""}:
        display = f"{display}{parsed.path}"
    if parsed.query:
        display = f"{display}?{parsed.query}"
    return display[:255]


def _build_youtube_source_name(url: str, video_id: str) -> str:
    parsed = urlparse(url)
    host = (parsed.netloc or "youtube.com").lower()
    if host.startswith("www."):
        host = host[4:]
    display = f"{host}/{video_id}"
    return display[:255]


def _trim_text(text: str, max_chars: int) -> str:
    cleaned = " ".join((text or "").split()).strip()
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars].rstrip()}..."


__all__ = [
    "_build_web_source_name",
    "_build_youtube_source_name",
    "_sanitize_filename",
    "_trim_text",
    "_web_storage_path",
    "_youtube_storage_path",
    "canonicalize_web_url",
    "extract_youtube_video_id",
    "normalize_youtube_id",
]
