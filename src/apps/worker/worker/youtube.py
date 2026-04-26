"""YouTube transcript and caption helpers."""

import base64
import json
import os
import re
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import httpx
from shared_schemas.url_utils import extract_youtube_video_id, normalize_youtube_id

from .app import logger, settings

_CAPTION_TIMECODE_RE = re.compile(
    r"^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s-->\s\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}"
)


def _fetch_youtube_transcript(
    url: str,
    language: Optional[str],
    allow_auto_captions: Optional[bool],
) -> tuple[str, dict, dict]:
    try:
        from yt_dlp import YoutubeDL
    except Exception as exc:
        raise RuntimeError("yt-dlp is required for YouTube ingestion") from exc

    preferred_language = (language or settings.youtube_default_language or "").strip() or None
    allow_auto = settings.youtube_allow_auto_captions if allow_auto_captions is None else bool(allow_auto_captions)

    with _youtube_cookiefile_path() as cookiefile:
        ydl_opts = _build_youtube_ydl_opts(cookiefile)
        with YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(url, download=False)
            except Exception as exc:
                if _is_youtube_bot_check_error(exc):
                    raise ValueError(
                        "YouTube blocked the hosted worker with a bot check. "
                        "Configure YOUTUBE_COOKIES_FILE or YOUTUBE_COOKIES_B64 with exported YouTube cookies."
                    ) from exc
                raise
    if not info:
        raise ValueError("Unable to fetch YouTube metadata")

    captions_source, lang, caption_url, caption_ext = _select_caption_track(
        info, preferred_language, allow_auto
    )
    raw = _download_caption_text(caption_url)
    transcript = _parse_caption_text(raw, caption_ext)
    if not transcript:
        raise ValueError("Caption track was empty")

    info_payload = {
        "video_id": info.get("id"),
        "title": info.get("title") or info.get("fulltitle"),
        "channel": info.get("channel") or info.get("uploader"),
        "channel_id": info.get("channel_id") or info.get("uploader_id"),
        "duration_seconds": info.get("duration"),
        "published_at": _format_upload_date(info.get("upload_date")),
    }
    captions_meta = {
        "language": lang,
        "captions_source": captions_source,
        "ext": caption_ext,
    }
    return transcript, info_payload, captions_meta


def _build_youtube_ydl_opts(cookiefile: Optional[str] = None) -> dict:
    # Keep yt-dlp metadata-only and skip video manifests; caption ingestion only
    # needs subtitle URLs, so this avoids long hosted hangs on DASH/HLS probing.
    retry_count = max(0, settings.youtube_metadata_retries)
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": max(1, settings.youtube_request_timeout_seconds),
        "retries": retry_count,
        "extractor_retries": retry_count,
        "file_access_retries": retry_count,
        "fragment_retries": retry_count,
        "ignore_no_formats_error": True,
        "extractor_args": {
            "youtube": {
                "skip": ["dash", "hls", "translated_subs"],
            },
        },
    }
    if cookiefile:
        opts["cookiefile"] = cookiefile
    return opts


@contextmanager
def _youtube_cookiefile_path():
    configured_file = settings.youtube_cookies_file.strip()
    if configured_file:
        yield configured_file
        return

    cookie_bytes = _decode_configured_youtube_cookies()
    if not cookie_bytes:
        yield None
        return

    fd, path = tempfile.mkstemp(prefix="caddie-youtube-cookies-", suffix=".txt")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(cookie_bytes)
        yield path
    finally:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            logger.warning("Failed to remove temporary YouTube cookies file: %s", path, exc_info=True)


def _decode_configured_youtube_cookies() -> Optional[bytes]:
    encoded = settings.youtube_cookies_b64.strip()
    if encoded:
        try:
            return base64.b64decode(encoded)
        except Exception as exc:
            raise ValueError("YOUTUBE_COOKIES_B64 must be valid base64-encoded Netscape cookies.txt content") from exc

    raw = settings.youtube_cookies_raw
    if raw.strip():
        return raw.encode("utf-8")
    return None


def _is_youtube_bot_check_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "sign in to confirm" in message and "not a bot" in message


def _select_caption_track(
    info: dict,
    preferred_language: Optional[str],
    allow_auto: bool,
) -> tuple[str, str, str, str]:
    subtitles = info.get("subtitles") or {}
    auto_caps = (info.get("automatic_captions") or {}) if allow_auto else {}

    preferred_norm = _normalize_language(preferred_language) if preferred_language else None
    preferred_is_english = preferred_norm in (None, "en") or (preferred_norm or "").startswith("en")

    selected = _pick_caption_preferred(subtitles, preferred_language)
    if selected:
        lang, url, ext = selected
        return "manual", lang, url, ext

    selected = _pick_caption_preferred(auto_caps, preferred_language)
    if selected:
        lang, url, ext = selected
        return "auto", lang, url, ext

    if not preferred_is_english:
        selected = _pick_caption_preferred(subtitles, "en")
        if selected:
            lang, url, ext = selected
            return "manual", lang, url, ext
        selected = _pick_caption_preferred(auto_caps, "en")
        if selected:
            lang, url, ext = selected
            return "auto", lang, url, ext

    selected = _pick_caption_any(subtitles)
    if selected:
        lang, url, ext = selected
        return "manual", lang, url, ext

    selected = _pick_caption_any(auto_caps)
    if selected:
        lang, url, ext = selected
        return "auto", lang, url, ext

    raise ValueError("No captions available for this YouTube video")


def _pick_caption_preferred(captions: dict, preferred_language: Optional[str]) -> Optional[tuple[str, str, str]]:
    if not captions:
        return None
    if preferred_language:
        preferred_norm = _normalize_language(preferred_language)
        for lang, formats in captions.items():
            normalized = _normalize_language(lang)
            if normalized == preferred_norm:
                return _select_caption_format(lang, formats)
        if preferred_norm.startswith("en"):
            for lang, formats in captions.items():
                normalized = _normalize_language(lang)
                if normalized.startswith("en"):
                    return _select_caption_format(lang, formats)
    return None


def _pick_caption_any(captions: dict) -> Optional[tuple[str, str, str]]:
    if not captions:
        return None
    for lang, formats in captions.items():
        selected = _select_caption_format(lang, formats)
        if selected:
            return selected
    return None


def _select_caption_format(lang: str, formats: list[dict]) -> Optional[tuple[str, str, str]]:
    if not formats or not isinstance(formats, list):
        return None
    preferred_exts = ["vtt", "srt", "json3", "srv1", "srv2", "srv3", "ttml"]
    for ext in preferred_exts:
        for item in formats:
            if item.get("ext") == ext and item.get("url"):
                return lang, item["url"], ext
    for item in formats:
        if item.get("url"):
            return lang, item["url"], item.get("ext") or "vtt"
    return None


def _download_caption_text(url: str) -> bytes:
    max_bytes = max(1, settings.youtube_max_bytes)
    retry_statuses = {429, 500, 502, 503, 504}
    max_attempts = 3
    base_delay = 1.5
    last_exc: Optional[Exception] = None
    with httpx.Client(timeout=settings.web_timeout_seconds, follow_redirects=True) as client:
        for attempt in range(1, max_attempts + 1):
            try:
                with client.stream("GET", url) as resp:
                    resp.raise_for_status()
                    total = 0
                    chunks: list[bytes] = []
                    for chunk in resp.iter_bytes():
                        total += len(chunk)
                        if total > max_bytes:
                            raise ValueError("Caption file exceeds size limit")
                        chunks.append(chunk)
                    return b"".join(chunks)
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                status = exc.response.status_code
                if status in retry_statuses and attempt < max_attempts:
                    delay = base_delay * (2 ** (attempt - 1))
                    logger.warning("Caption fetch got %s, retrying in %.1fs", status, delay)
                    time.sleep(delay)
                    continue
                if status == 429:
                    raise ValueError("YouTube rate limit hit; try again later") from exc
                raise ValueError(f"Failed to download captions (HTTP {status})") from exc
            except httpx.RequestError as exc:
                last_exc = exc
                if attempt < max_attempts:
                    delay = base_delay * (2 ** (attempt - 1))
                    logger.warning("Caption fetch failed, retrying in %.1fs: %s", delay, exc)
                    time.sleep(delay)
                    continue
                raise ValueError(f"Failed to download captions ({exc})") from exc
    if last_exc:
        raise last_exc
    raise RuntimeError("Failed to download captions")


def _parse_caption_text(raw: bytes, ext: str) -> str:
    text = raw.decode("utf-8", errors="ignore")
    ext_lower = (ext or "").lower()
    if ext_lower in {"vtt", "srt"}:
        return _strip_vtt_srt(text)
    if ext_lower in {"srv1", "srv2", "srv3", "ttml", "xml"}:
        return _strip_xml(text)
    if ext_lower == "json3":
        return _parse_json3(text)
    cleaned = _strip_vtt_srt(text)
    return cleaned or _strip_xml(text)


def _strip_vtt_srt(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        if cleaned.startswith("WEBVTT") or cleaned.startswith("NOTE"):
            continue
        if cleaned.isdigit():
            continue
        if _CAPTION_TIMECODE_RE.match(cleaned):
            continue
        cleaned = re.sub(r"<[^>]+>", "", cleaned)
        lines.append(cleaned)
    return " ".join(lines).strip()


def _strip_xml(text: str) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", text)
    return " ".join(cleaned.split()).strip()


def _parse_json3(text: str) -> str:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return ""
    parts: list[str] = []
    for event in payload.get("events", []) or []:
        for seg in event.get("segs", []) or []:
            seg_text = seg.get("utf8")
            if seg_text:
                parts.append(seg_text)
    return " ".join(parts).strip()


def _normalize_language(value: Optional[str]) -> str:
    if not value:
        return ""
    return value.strip().lower().replace("_", "-")


def _format_upload_date(value: Optional[str]) -> Optional[str]:
    if not value or len(value) != 8:
        return None
    return f"{value[:4]}-{value[4:6]}-{value[6:]}"


def _format_duration(seconds: Optional[int]) -> Optional[str]:
    if seconds is None:
        return None
    try:
        total = int(seconds)
    except (TypeError, ValueError):
        return None
    hours = total // 3600
    minutes = (total % 3600) // 60
    secs = total % 60
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _build_youtube_pseudo_doc(info: dict, url: str, fetched_at: str, captions_meta: dict, text: str) -> str:
    title = info.get("title") or "YouTube Video"
    lines: list[str] = [f"# {title}"]
    if url:
        lines.append(f"Source: {url}")
    if info.get("video_id"):
        lines.append(f"Video ID: {info['video_id']}")
    if info.get("channel"):
        lines.append(f"Channel: {info['channel']}")
    if info.get("published_at"):
        lines.append(f"Published: {info['published_at']}")
    duration = _format_duration(info.get("duration_seconds"))
    if duration:
        lines.append(f"Duration: {duration}")
    if captions_meta.get("language"):
        lines.append(f"Language: {captions_meta['language']}")
    if captions_meta.get("captions_source"):
        lines.append(f"Captions: {captions_meta['captions_source']}")
    lines.append(f"Fetched: {fetched_at}")
    lines.append("")
    lines.append(text)
    return "\n".join(lines)


def _canonicalize_youtube_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


__all__ = [
    "_build_youtube_pseudo_doc",
    "_build_youtube_ydl_opts",
    "_canonicalize_youtube_url",
    "_decode_configured_youtube_cookies",
    "_download_caption_text",
    "_fetch_youtube_transcript",
    "_format_duration",
    "_format_upload_date",
    "_is_youtube_bot_check_error",
    "_normalize_language",
    "_parse_caption_text",
    "_parse_json3",
    "_pick_caption_any",
    "_pick_caption_preferred",
    "_select_caption_format",
    "_select_caption_track",
    "_strip_xml",
    "_strip_vtt_srt",
    "extract_youtube_video_id",
    "normalize_youtube_id",
]
