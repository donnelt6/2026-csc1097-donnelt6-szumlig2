"""URL normalization helpers shared by API and worker source flows."""

import re
from typing import Optional
from urllib.parse import parse_qs, urlparse, urlunparse

_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def normalize_youtube_id(value: str) -> Optional[str]:
    cleaned = (value or "").strip()
    if not _YOUTUBE_ID_RE.fullmatch(cleaned):
        return None
    return cleaned


def extract_youtube_video_id(url: str) -> Optional[str]:
    # Accept the common watch, short, embed, live, and shorts URL shapes so API
    # de-duplication and worker suggestions classify YouTube targets identically.
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host == "youtu.be":
        return normalize_youtube_id(parsed.path.strip("/").split("/", 1)[0])
    if host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
        query = parse_qs(parsed.query)
        if "v" in query and query["v"]:
            return normalize_youtube_id(query["v"][0])
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) >= 2 and parts[0] in {"shorts", "embed", "live", "v"}:
            return normalize_youtube_id(parts[1])
    return None


def canonicalize_web_url(url: str) -> Optional[str]:
    # Strip tracking noise while preserving meaningful query parameters so
    # source de-duplication does not collapse distinct pages.
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


__all__ = [
    "canonicalize_web_url",
    "extract_youtube_video_id",
    "normalize_youtube_id",
]
