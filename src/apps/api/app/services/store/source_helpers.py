"""Source-specific helper functions for storage paths and URL normalization."""

import re
from datetime import datetime, timezone
from pathlib import PurePath
from typing import Optional
from urllib.parse import parse_qs, urlparse, urlunparse

_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._ -]")
_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


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


def _extract_youtube_video_id(url: str) -> Optional[str]:
    # Accept the common watch, short, embed, and live URL shapes so callers can
    # normalize YouTube targets before de-duplication or storage.
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host == "youtu.be":
        video_id = parsed.path.strip("/").split("/", 1)[0]
        return _normalize_youtube_id(video_id)
    if host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
        query = parse_qs(parsed.query)
        if "v" in query and query["v"]:
            return _normalize_youtube_id(query["v"][0])
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) >= 2 and parts[0] in {"shorts", "embed", "live", "v"}:
            return _normalize_youtube_id(parts[1])
    return None


def _normalize_youtube_id(value: str) -> Optional[str]:
    if not value:
        return None
    candidate = value.strip()
    if not _YOUTUBE_ID_RE.fullmatch(candidate):
        return None
    return candidate


def _canonicalize_web_url(url: str) -> Optional[str]:
    # Canonicalization intentionally removes tracking noise but keeps meaningful
    # query params so source de-duplication does not collapse distinct pages.
    cleaned = (url or "").strip()
    if not cleaned:
        return None
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"}:
        return None
    host = (parsed.hostname or "").lower()
    if not host:
        return None
    if host.startswith("www."):
        host = host[4:]
    port = parsed.port
    if (parsed.scheme == "http" and port == 80) or (parsed.scheme == "https" and port == 443):
        port = None
    netloc = host if port is None else f"{host}:{port}"
    path = parsed.path or "/"
    path = re.sub(r"/{2,}", "/", path)
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = parse_qs(parsed.query, keep_blank_values=False)
    filtered_items: list[tuple[str, str]] = []
    for key, values in sorted(query.items()):
        normalized_key = key.lower()
        if normalized_key.startswith("utm_") or normalized_key in {"fbclid", "gclid"}:
            continue
        for value in values:
            if value:
                filtered_items.append((key, value))
    normalized_query = "&".join(f"{key}={value}" for key, value in filtered_items)
    return urlunparse((parsed.scheme.lower(), netloc, path, "", normalized_query, ""))


def _trim_text(text: str, max_chars: int) -> str:
    cleaned = " ".join((text or "").split()).strip()
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars].rstrip()}..."


__all__ = [
    "_build_web_source_name",
    "_build_youtube_source_name",
    "_canonicalize_web_url",
    "_extract_youtube_video_id",
    "_normalize_youtube_id",
    "_sanitize_filename",
    "_trim_text",
    "_web_storage_path",
    "_youtube_storage_path",
]
