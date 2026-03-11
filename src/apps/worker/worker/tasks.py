import hashlib
import io
import json
import logging
import time
import re
import ipaddress
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, List, Optional
from urllib.parse import quote, urlparse, urljoin
from urllib.robotparser import RobotFileParser
from zoneinfo import ZoneInfo

import httpx
from celery import Celery
from celery.schedules import crontab
import dateparser
import spacy
from openai import OpenAI
from pypdf import PdfReader
from supabase import Client, create_client

from .config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Shared Celery app for ingestion and reminder dispatch.
celery_app = Celery("caddie-worker", broker=settings.redis_url, backend=settings.redis_url)
# Beat schedule triggers reminder dispatch on a rolling window.
celery_app.conf.beat_schedule = {
    "dispatch-reminders": {
        "task": "dispatch_reminders",
        "schedule": crontab(minute=f"*/{max(1, settings.reminder_dispatch_window_minutes)}"),
    }
}


@celery_app.task(bind=True, name="ingest_source", max_retries=3, default_retry_delay=15)
def ingest_source(self, source_id: str, hub_id: str, storage_path: str) -> dict:
    """
    Ingestion flow:
    - Download from Supabase Storage
    - Extract text (PDF/DOCX/TXT/MD)
    - Chunk + embed
    - Persist chunks to pgvector
    - Update source status
    """
    logger.info("Starting ingestion for source %s", source_id)
    client = _get_supabase_client()
    _update_source(client, source_id, status="processing", clear_failure_reason=True)

    try:
        raw = _download_from_storage(storage_path)
    except Exception as exc:
        logger.warning("Download failed for %s, retrying: %s", storage_path, exc)
        raise self.retry(exc=exc)

    try:
        text = _extract_text(raw, storage_path)
        text = _normalize_text(text)
        if not text:
            raise ValueError("No text extracted from source")

        chunk_count = _ingest_text_for_source(client, source_id, hub_id, text, extra_metadata=None)
        logger.info("Completed ingestion for source %s", source_id)
        return {"source_id": source_id, "hub_id": hub_id, "chunks": chunk_count}
    except Exception as exc:
        logger.exception("Ingestion failed for source %s", source_id)
        _update_source(client, source_id, status="failed", failure_reason=str(exc)[:500])
        raise


@celery_app.task(bind=True, name="ingest_web_source", max_retries=3, default_retry_delay=15)
def ingest_web_source(self, source_id: str, hub_id: str, url: str, storage_path: str) -> dict:
    """
    Web ingestion flow:
    - Validate URL (public only)
    - Respect robots.txt if enabled
    - Fetch + extract readable text
    - Store pseudo document in Supabase Storage
    - Chunk + embed + persist to pgvector
    """
    logger.info("Starting web ingestion for source %s (%s)", source_id, url)
    client = _get_supabase_client()
    _update_source(client, source_id, status="processing", clear_failure_reason=True)

    try:
        safe_url = _validate_public_url(url)
        if settings.web_respect_robots and not _allowed_by_robots(safe_url, settings.web_user_agent):
            raise ValueError("Blocked by robots.txt")
        raw, content_type, final_url = _fetch_url_content(safe_url)
        text, title = _extract_web_text(raw, content_type)
        text = _normalize_text(text)
        if not text:
            raise ValueError("No text extracted from web page")
        crawl_at = datetime.now(timezone.utc).isoformat()
        pseudo_doc = _build_pseudo_doc(title, final_url or safe_url, crawl_at, content_type, text)
        _upload_pseudo_doc(client, storage_path, pseudo_doc)
        extra_metadata = {
            "source_type": "web",
            "url": safe_url,
            "final_url": final_url,
            "title": title,
            "crawl_at": crawl_at,
            "content_type": content_type,
            "byte_size": len(raw),
            "word_count": len(text.split()),
        }
        chunk_count = _ingest_text_for_source(client, source_id, hub_id, text, extra_metadata=extra_metadata)
        try:
            if title:
                client.table("sources").update({"original_name": title[:500]}).eq("id", source_id).execute()
        except Exception:
            logger.warning("Failed to update title for source %s", source_id, exc_info=True)
        logger.info("Completed web ingestion for source %s", source_id)
        return {"source_id": source_id, "hub_id": hub_id, "chunks": chunk_count}
    except Exception as exc:
        logger.exception("Web ingestion failed for source %s", source_id)
        _update_source(client, source_id, status="failed", failure_reason=str(exc)[:500])
        raise


@celery_app.task(bind=True, name="ingest_youtube_source", max_retries=3, default_retry_delay=15)
def ingest_youtube_source(
    self,
    source_id: str,
    hub_id: str,
    url: str,
    storage_path: str,
    language: Optional[str] = None,
    allow_auto_captions: Optional[bool] = None,
    video_id: Optional[str] = None,
) -> dict:
    """
    YouTube ingestion flow:
    - Fetch video info + captions via yt-dlp
    - Store pseudo document in Supabase Storage
    - Chunk + embed + persist to pgvector
    """
    logger.info("Starting YouTube ingestion for source %s (%s)", source_id, url)
    client = _get_supabase_client()
    _update_source(client, source_id, status="processing", clear_failure_reason=True)

    try:
        transcript, info, captions_meta = _fetch_youtube_transcript(
            url,
            language=language,
            allow_auto_captions=allow_auto_captions,
        )
        if video_id:
            info["video_id"] = video_id
        text = _normalize_text(transcript)
        if not text:
            raise ValueError("No transcript text extracted from YouTube captions")
        fetched_at = datetime.now(timezone.utc).isoformat()
        pseudo_doc = _build_youtube_pseudo_doc(info, url, fetched_at, captions_meta, text)
        _upload_pseudo_doc(client, storage_path, pseudo_doc)
        extra_metadata = {
            "source_type": "youtube",
            "url": url,
            "video_id": info.get("video_id"),
            "title": info.get("title"),
            "channel": info.get("channel"),
            "channel_id": info.get("channel_id"),
            "published_at": info.get("published_at"),
            "duration_seconds": info.get("duration_seconds"),
            "language": captions_meta.get("language"),
            "captions_source": captions_meta.get("captions_source"),
            "transcript_fetched_at": fetched_at,
            "word_count": len(text.split()),
        }
        chunk_count = _ingest_text_for_source(client, source_id, hub_id, text, extra_metadata=extra_metadata)
        try:
            video_title = info.get("title")
            if video_title:
                client.table("sources").update({"original_name": video_title[:500]}).eq("id", source_id).execute()
        except Exception:
            logger.warning("Failed to update title for source %s", source_id, exc_info=True)
        logger.info("Completed YouTube ingestion for source %s", source_id)
        return {"source_id": source_id, "hub_id": hub_id, "chunks": chunk_count}
    except Exception as exc:
        logger.exception("YouTube ingestion failed for source %s", source_id)
        _update_source(client, source_id, status="failed", failure_reason=str(exc)[:500])
        raise


def _get_supabase_client() -> Client:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase credentials missing in worker environment")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _download_from_storage(storage_path: str) -> bytes:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase credentials missing for storage download")
    # Use service key to fetch the object directly from Supabase Storage.
    safe_path = quote(storage_path, safe="/")
    storage_url = f"{settings.supabase_url}/storage/v1/object/{settings.storage_bucket}/{safe_path}"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
    }
    with httpx.Client(timeout=60) as client:
        resp = client.get(storage_url, headers=headers)
        resp.raise_for_status()
    return resp.content


def _validate_public_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("URL scheme must be http or https")
    if not parsed.netloc:
        raise ValueError("URL must include a host")
    hostname = parsed.hostname or ""
    if not hostname:
        raise ValueError("URL must include a host")
    _ensure_public_host(hostname)
    return parsed.geturl()


def _ensure_public_host(hostname: str) -> None:
    ip_list: List[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    try:
        ip_list.append(ipaddress.ip_address(hostname))
    except ValueError:
        try:
            infos = socket.getaddrinfo(hostname, None)
        except OSError as exc:
            raise ValueError("Unable to resolve host") from exc
        for info in infos:
            addr = info[4][0]
            try:
                ip_list.append(ipaddress.ip_address(addr))
            except ValueError:
                continue
    for addr in ip_list:
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast or addr.is_unspecified:
            raise ValueError("URL resolves to a private or non-public address")


def _allowed_by_robots(url: str, user_agent: str) -> bool:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    try:
        with httpx.Client(timeout=settings.web_timeout_seconds) as client:
            resp = client.get(robots_url, headers={"User-Agent": user_agent}, follow_redirects=True)
            if resp.status_code >= 400:
                return True
            parser = RobotFileParser()
            parser.parse(resp.text.splitlines())
            return parser.can_fetch(user_agent, url)
    except Exception:
        return True


def _fetch_url_content(url: str) -> tuple[bytes, str, str]:
    headers = {"User-Agent": settings.web_user_agent}
    max_bytes = max(1, settings.web_max_bytes)
    current_url = url
    max_redirects = 5
    with httpx.Client(timeout=settings.web_timeout_seconds, follow_redirects=False) as client:
        for _ in range(max_redirects + 1):
            with client.stream("GET", current_url, headers=headers) as resp:
                if 300 <= resp.status_code < 400:
                    location = resp.headers.get("location")
                    if not location:
                        raise ValueError("Redirect without location header")
                    next_url = urljoin(current_url, location)
                    parsed = urlparse(next_url)
                    if not parsed.scheme or not parsed.netloc:
                        raise ValueError("Invalid redirect URL")
                    _ensure_public_host(parsed.hostname or "")
                    current_url = next_url
                    continue
                resp.raise_for_status()
                content_type = resp.headers.get("content-type", "")
                total = 0
                chunks: list[bytes] = []
                for chunk in resp.iter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError("Web content exceeds size limit")
                    chunks.append(chunk)
                return b"".join(chunks), content_type, current_url
    raise ValueError("Too many redirects")


def _extract_web_text(raw: bytes, content_type: str) -> tuple[str, Optional[str]]:
    encoding = "utf-8"
    match = re.search(r"charset=([\\w-]+)", content_type, re.IGNORECASE)
    if match:
        encoding = match.group(1)
    html = raw.decode(encoding, errors="ignore")
    lowered = content_type.lower()
    if "text/html" not in lowered and "application/xhtml" not in lowered and "<html" not in html.lower():
        cleaned = " ".join(html.split())
        return cleaned, None

    title = None
    text = ""
    try:
        from readability import Document

        doc = Document(html)
        title = doc.short_title() or doc.title()
        content_html = doc.summary()
        text = _html_to_text(content_html)
    except Exception:
        text = ""
    if not text:
        text = _html_to_text(html)
    cleaned = " ".join(text.split())
    return cleaned, title


def _html_to_text(html: str) -> str:
    try:
        from bs4 import BeautifulSoup
    except Exception:
        return re.sub(r"<[^>]+>", " ", html)
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return soup.get_text(separator=" ")


def _build_pseudo_doc(title: Optional[str], url: str, crawl_at: str, content_type: str, text: str) -> str:
    header_title = title or url
    lines = [
        f"# {header_title}",
        f"Source: {url}",
        f"Crawled: {crawl_at}",
        f"Content-Type: {content_type or 'unknown'}",
        "",
        text,
    ]
    return "\n".join(lines)


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

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
    }
    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
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


def _select_caption_track(
    info: dict,
    preferred_language: Optional[str],
    allow_auto: bool,
) -> tuple[str, str, str, str]:
    subtitles = info.get("subtitles") or {}
    selected = _pick_caption_from_map(subtitles, preferred_language)
    if selected:
        lang, url, ext = selected
        return "manual", lang, url, ext
    if allow_auto:
        auto = info.get("automatic_captions") or {}
        selected = _pick_caption_from_map(auto, preferred_language)
        if selected:
            lang, url, ext = selected
            return "auto", lang, url, ext
    raise ValueError("No captions available for the requested language")


def _pick_caption_from_map(
    captions: dict,
    preferred_language: Optional[str],
) -> Optional[tuple[str, str, str]]:
    if not captions:
        return None
    preferred_norm = _normalize_language(preferred_language) if preferred_language else None
    candidates: list[str] = []
    if preferred_norm:
        candidates.append(preferred_norm)
        if "-" in preferred_norm:
            candidates.append(preferred_norm.split("-", 1)[0])
    else:
        candidates.extend(["en", "en-us", "en-gb"])

    for candidate in candidates:
        for lang_key, formats in captions.items():
            key_norm = _normalize_language(lang_key)
            if key_norm == candidate or key_norm.startswith(candidate):
                selected = _select_caption_format(lang_key, formats)
                if selected:
                    return selected

    for lang_key, formats in captions.items():
        selected = _select_caption_format(lang_key, formats)
        if selected:
            return selected
    return None


def _select_caption_format(lang: str, formats: list[dict]) -> Optional[tuple[str, str, str]]:
    if not formats or not isinstance(formats, list):
        return None
    preferred_exts = ["vtt", "srt", "srv3", "srv2", "srv1", "ttml", "json3"]
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
                raise
            except httpx.RequestError as exc:
                last_exc = exc
                if attempt < max_attempts:
                    delay = base_delay * (2 ** (attempt - 1))
                    logger.warning("Caption fetch failed, retrying in %.1fs: %s", delay, exc)
                    time.sleep(delay)
                    continue
                raise
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


def _upload_pseudo_doc(client: Client, storage_path: str, content: str) -> None:
    if not storage_path:
        raise ValueError("Storage path missing for pseudo document")
    payload = content.encode("utf-8")
    try:
        client.storage.from_(settings.storage_bucket).remove([storage_path])
    except Exception:
        pass
    client.storage.from_(settings.storage_bucket).upload(
        storage_path,
        payload,
        {"content-type": "text/markdown"},
    )


def _extract_text(raw: bytes, storage_path: str) -> str:
    # Route by file extension to the right extractor.
    ext = Path(storage_path).suffix.lower()
    if ext == ".pdf":
        return _extract_pdf(raw)
    if ext == ".docx":
        return _extract_docx(raw)
    if ext in {".md", ".txt"}:
        return raw.decode("utf-8", errors="ignore")
    return raw.decode("utf-8", errors="ignore")


def _extract_pdf(raw: bytes) -> str:
    # Best-effort extraction; missing text yields empty strings per page.
    reader = PdfReader(io.BytesIO(raw))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages)


def _extract_docx(raw: bytes) -> str:
    import docx  # local import to avoid unused dependency warnings if not used

    doc = docx.Document(io.BytesIO(raw))
    return "\n".join(paragraph.text for paragraph in doc.paragraphs)


def _normalize_text(text: str) -> str:
    # Collapse mixed whitespace into single spaces for cleaner chunks.
    return " ".join(text.replace("\r", "\n").split())


def _ingest_text_for_source(
    client: Client,
    source_id: str,
    hub_id: str,
    text: str,
    extra_metadata: Optional[dict],
) -> int:
    chunks = _chunk_text(text, settings.chunk_size, settings.chunk_overlap)
    if not chunks:
        raise ValueError("No chunks produced from extracted text")
    if not _source_exists(client, source_id):
        logger.info("Source %s deleted before ingest; skipping.", source_id)
        return 0
    ingest_started_at = datetime.now(timezone.utc)
    ingest_timestamp = ingest_started_at.isoformat()
    embeddings = _embed_chunks(chunks)
    if not _source_exists(client, source_id):
        logger.info("Source %s deleted during embed; skipping insert.", source_id)
        return 0
    _insert_chunks(client, source_id, hub_id, chunks, embeddings, ingest_timestamp)
    _clear_existing_chunks_before(client, source_id, ingest_timestamp)
    existing_metadata = _get_source_metadata(client, source_id)
    metadata = {
        "chunk_count": len(chunks),
        "embedding_model": settings.embedding_model,
        "chunk_size": settings.chunk_size,
        "chunk_overlap": settings.chunk_overlap,
    }
    merged = {**existing_metadata, **metadata}
    if extra_metadata:
        merged.update(extra_metadata)
    _update_source(client, source_id, status="complete", ingestion_metadata=merged)
    try:
        _detect_and_store_reminders(client, source_id, hub_id, text)
    except Exception:
        logger.exception("Reminder detection failed for source %s", source_id)
    return len(chunks)


def _chunk_text(text: str, chunk_size: int, overlap: int) -> List[str]:
    # Sliding window with overlap for better semantic continuity.
    words = text.split()
    if not words:
        return []
    chunks: List[str] = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk_words = words[start:end]
        chunks.append(" ".join(chunk_words))
        if end == len(words):
            break
        start = max(end - overlap, 0)
    return chunks


def _embed_chunks(chunks: List[str]) -> List[List[float]]:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY missing in worker environment")
    client = OpenAI(api_key=settings.openai_api_key)
    embeddings: List[List[float]] = []
    for batch in _batch(chunks, 64):
        # Batch requests to keep payload size under API limits.
        response = client.embeddings.create(model=settings.embedding_model, input=batch)
        embeddings.extend([item.embedding for item in response.data])
    return embeddings


def _insert_chunks(
    client: Client,
    source_id: str,
    hub_id: str,
    chunks: List[str],
    embeddings: List[List[float]],
    created_at: str,
) -> None:
    rows = []
    for idx, (text, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
        rows.append(
            {
                "source_id": source_id,
                "hub_id": hub_id,
                "chunk_index": idx,
                "text": text,
                "embedding": embedding,
                "token_count": len(text.split()),
                "metadata": {"word_count": len(text.split())},
                "created_at": created_at,
            }
        )
    for batch in _batch(rows, 100):
        client.table("source_chunks").insert(batch).execute()


def _clear_existing_chunks_before(client: Client, source_id: str, cutoff: str) -> None:
    # Remove only chunks created before this ingest started to avoid deleting new inserts.
    client.table("source_chunks").delete().eq("source_id", source_id).lt("created_at", cutoff).execute()


def _source_exists(client: Client, source_id: str) -> bool:
    response = client.table("sources").select("id").eq("id", source_id).limit(1).execute()
    return bool(response.data)


def _get_source_metadata(client: Client, source_id: str) -> dict:
    response = (
        client.table("sources")
        .select("ingestion_metadata")
        .eq("id", source_id)
        .limit(1)
        .execute()
    )
    if not response.data:
        return {}
    metadata = response.data[0].get("ingestion_metadata") or {}
    return metadata if isinstance(metadata, dict) else {}


def _update_source(
    client: Client,
    source_id: str,
    status: str,
    failure_reason: Optional[str] = None,
    ingestion_metadata: Optional[dict] = None,
    clear_failure_reason: bool = False,
) -> None:
    # Only include optional fields when present to avoid overwriting.
    payload: dict = {"status": status}
    if failure_reason is not None or clear_failure_reason:
        payload["failure_reason"] = failure_reason
    if ingestion_metadata is not None:
        payload["ingestion_metadata"] = ingestion_metadata
    client.table("sources").update(payload).eq("id", source_id).execute()


def _batch(items: List, size: int) -> Iterable[List]:
    # Yield successive slices for batched inserts/requests.
    for i in range(0, len(items), size):
        yield items[i : i + size]

# Reminder detection pipeline (regex + spaCy) and dispatch.

MAX_TEXT_CHARS = 200_000
MIN_CONFIDENCE = 0.7
MAX_CANDIDATES = 6
DATE_KEYWORDS = (
    "due",
    "deadline",
    "submit",
    "submission",
    "by",
    "before",
    "no later than",
    "must be received",
    "final date",
    "window",
)
DATE_TIME_RE = re.compile(r"\b(\d{1,2}:\d{2}\b|\d{1,2}\s*(am|pm)\b)", re.IGNORECASE)
TIME_ONLY_RE = re.compile(r"^\s*\d{1,2}(:\d{2})?\s*(am|pm)?\s*$", re.IGNORECASE)
SENTENCE_BOUNDARY_RE = re.compile(r"[.!?]")
MONTH_PATTERN = (
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
)
RANGE_NUMERIC_RE = re.compile(
    r"(?P<start>\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\s*(?:-|\u2013|\u2014)\s*"
    r"(?P<end>\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)"
)
RANGE_MONTH_RE = re.compile(
    rf"(?P<start>\d{{1,2}}(?:st|nd|rd|th)?)\s*(?:-|\u2013|\u2014)\s*"
    rf"(?P<end>\d{{1,2}}(?:st|nd|rd|th)?)\s+(?P<month>{MONTH_PATTERN})(?:\s+(?P<year>\d{{4}}))?",
    re.IGNORECASE,
)
DATE_REGEXES = [
    re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"),
    re.compile(r"\b\d{4}-\d{1,2}-\d{1,2}\b"),
    re.compile(rf"\b(?:{MONTH_PATTERN})\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s+\d{{4}})?\b", re.IGNORECASE),
    re.compile(rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:{MONTH_PATTERN})(?:\s+\d{{4}})?\b", re.IGNORECASE),
]

_NLP = None


def _detect_and_store_reminders(client: Client, source_id: str, hub_id: str, text: str) -> None:
    # Cap text length for deterministic runtime; candidates are deduped via upsert.
    # Note: an optional LLM pass could run here (async) to re-rank/validate low-confidence candidates.
    cleaned = text[:MAX_TEXT_CHARS]
    candidates = _find_date_candidates(cleaned, settings.default_timezone)
    if not candidates:
        return
    rows = []
    for candidate in candidates:
        rows.append(
            {
                "hub_id": hub_id,
                "source_id": source_id,
                "detected_by": candidate["detected_by"],
                "snippet": candidate["snippet"],
                "snippet_hash": candidate["snippet_hash"],
                "due_at": candidate["due_at"],
                "timezone": candidate["timezone"],
                "title_suggestion": candidate["title_suggestion"],
                "confidence": candidate["confidence"],
                "status": "pending",
            }
        )
    for batch in _batch(rows, 50):
        client.table("reminder_candidates").upsert(
            batch, on_conflict="source_id,due_at,snippet_hash"
        ).execute()


def _find_date_candidates(text: str, timezone_name: str) -> List[dict]:
    # Parse mentions into timestamps, score, and keep the top N unique snippets.
    mentions = _collect_date_mentions(text)
    now = datetime.now(timezone.utc)
    candidates: List[dict] = []
    seen_keys: set[tuple[str, str]] = set()
    for mention in mentions:
        date_text = mention["text"]
        if re.fullmatch(r"\d{4}", date_text.strip()):
            continue
        range_end = _extract_range_end(date_text)
        if range_end:
            date_text = range_end
        if _looks_historical_or_vague_date(date_text):
            continue
        if mention["method"] == "ner" and _is_numeric_only(date_text):
            continue
        if _is_day_only(date_text):
            continue
        if _is_time_only(date_text):
            continue
        if _is_week_reference(date_text):
            continue
        time_hint = _extract_time_hint(text, mention["start"], mention["end"])
        parse_text = date_text
        if time_hint and not _has_time(date_text):
            parse_text = f"{date_text} {time_hint}"
        parsed = _parse_date_text(parse_text, timezone_name, now)
        if not parsed:
            continue
        if not _is_reasonable_date(parsed, now):
            continue
        snippet = _extract_snippet(text, mention["start"], mention["end"])
        has_keyword = _has_keyword(snippet) or _has_keyword_near(text, mention["start"], mention["end"])
        if _looks_relative(date_text) and not has_keyword:
            continue
        if _is_repeated_date(text, date_text) and not has_keyword:
            continue
        if _is_numeric_date(parse_text) and not has_keyword:
            continue
        confidence = _score_candidate(mention["method"], snippet, parse_text)
        if confidence < MIN_CONFIDENCE:
            continue
        snippet_hash = _hash_snippet(snippet)
        key = (parsed.isoformat(), snippet_hash)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        candidates.append(
            {
                "detected_by": mention["method"],
                "snippet": snippet,
                "snippet_hash": snippet_hash,
                "due_at": parsed.isoformat(),
                "timezone": timezone_name,
                "title_suggestion": _build_title(snippet),
                "confidence": confidence,
            }
        )
        if len(candidates) >= MAX_CANDIDATES:
            break
    return _dedupe_best_candidates(candidates)


def _collect_date_mentions(text: str) -> List[dict]:
    # Combine regex matches with spaCy DATE entities.
    mentions: List[dict] = []
    mentions.extend(_collect_range_mentions(text))
    for regex in DATE_REGEXES:
        for match in regex.finditer(text):
            mentions.append(
                {"text": match.group(0), "start": match.start(), "end": match.end(), "method": "regex"}
            )
    nlp = _get_nlp()
    if nlp is None:
        return mentions
    doc = nlp(text)
    for ent in doc.ents:
        if ent.label_ != "DATE":
            continue
        mentions.append(
            {"text": ent.text, "start": ent.start_char, "end": ent.end_char, "method": "ner"}
        )
    return mentions


def _dedupe_best_candidates(candidates: List[dict]) -> List[dict]:
    best_by_snippet: dict[str, dict] = {}
    for candidate in candidates:
        key = candidate.get("snippet_hash") or ""
        best = best_by_snippet.get(key)
        if best is None:
            best_by_snippet[key] = candidate
            continue
        if candidate["confidence"] > best["confidence"]:
            best_by_snippet[key] = candidate
        elif candidate["confidence"] == best["confidence"] and candidate["due_at"] < best["due_at"]:
            best_by_snippet[key] = candidate
    filtered: List[dict] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = candidate.get("snippet_hash") or ""
        if key in seen:
            continue
        if best_by_snippet.get(key) is candidate:
            filtered.append(candidate)
            seen.add(key)
    return filtered


def _collect_range_mentions(text: str) -> List[dict]:
    # Convert date ranges into a single end-date mention.
    mentions: List[dict] = []
    for match in RANGE_NUMERIC_RE.finditer(text):
        end_text = _normalize_numeric_range_end(match.group("start"), match.group("end"))
        if not end_text:
            continue
        mentions.append(
            {"text": end_text, "start": match.start("end"), "end": match.end("end"), "method": "range"}
        )
    for match in RANGE_MONTH_RE.finditer(text):
        end_text = f"{match.group('end')} {match.group('month')}"
        if match.group("year"):
            end_text = f"{end_text} {match.group('year')}"
        mentions.append(
            {"text": end_text, "start": match.start("end"), "end": match.end("end"), "method": "range"}
        )
    return mentions


def _get_nlp():
    global _NLP
    if _NLP is not None:
        return _NLP
    try:
        # Soft-fail if spaCy or the model is unavailable.
        _NLP = spacy.load("en_core_web_sm")
    except Exception:
        _NLP = None
    return _NLP


def _parse_date_text(date_text: str, timezone_name: str, now: datetime) -> Optional[datetime]:
    # Interpret dates using DMY order and normalize to UTC.
    iso_match = re.fullmatch(r"\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2})(?::\d{2})?)?\s*", date_text)
    if iso_match:
        base = iso_match.group(1)
        time_part = iso_match.group(2)
        parsed = datetime.fromisoformat(f"{base} {time_part}" if time_part else base)
        if parsed.tzinfo is None:
            tz = _safe_zoneinfo(timezone_name) or timezone.utc
            parsed = parsed.replace(tzinfo=tz)
        if not time_part:
            parsed = parsed.replace(hour=9, minute=0, second=0, microsecond=0)
        return parsed.astimezone(timezone.utc)
    settings_payload = {
        "PREFER_DATES_FROM": "future",
        "RELATIVE_BASE": now,
        "RETURN_AS_TIMEZONE_AWARE": True,
        "TIMEZONE": timezone_name,
        "TO_TIMEZONE": "UTC",
        "DATE_ORDER": "DMY",
    }
    parsed = dateparser.parse(date_text, settings=settings_payload)
    if not parsed:
        return None
    if parsed.tzinfo is None:
        tz = _safe_zoneinfo(timezone_name) or timezone.utc
        parsed = parsed.replace(tzinfo=tz)
    if not _has_time(date_text):
        # Default date-only mentions to 9:00 local time.
        parsed = parsed.replace(hour=9, minute=0, second=0, microsecond=0)
    return parsed.astimezone(timezone.utc)


def _safe_zoneinfo(name: str) -> Optional[ZoneInfo]:
    try:
        return ZoneInfo(name)
    except Exception:
        return None


def _extract_snippet(text: str, start: int, end: int, radius: int = 120) -> str:
    # Prefer sentence-bounded snippets around the mention to give context.
    snippet_start = max(0, start - radius)
    snippet_end = min(len(text), end + radius)
    window = text[snippet_start:snippet_end]
    if not window:
        return ""
    local_start = max(0, start - snippet_start)
    local_end = max(0, end - snippet_start)
    sentence_start = _find_sentence_start(window, local_start)
    sentence_end = _find_sentence_end(window, local_end)
    if sentence_start >= sentence_end:
        sentence_start = max(0, local_start - radius // 2)
        sentence_end = min(len(window), local_end + radius // 2)
    snippet = window[sentence_start:sentence_end]
    snippet = re.sub(r"\s+", " ", snippet).strip()
    snippet = re.sub(r"\b\d{1,2}\)\s*", "", snippet)
    return snippet[:280]


def _build_title(snippet: str) -> str:
    cleaned = snippet.strip()
    if len(cleaned) <= 80:
        return cleaned
    return f"{cleaned[:77].rstrip()}..."


def _hash_snippet(snippet: str) -> str:
    return hashlib.sha256(snippet.lower().encode("utf-8")).hexdigest()


def _score_candidate(method: str, snippet: str, date_text: str) -> float:
    # Lightweight heuristic score to keep only strong candidates.
    score = 0.3
    if method == "regex":
        score += 0.35
    if method == "range":
        score += 0.35
    if method == "ner":
        score += 0.25
    if _has_keyword(snippet):
        score += 0.2
    if _has_time(date_text):
        score += 0.1
    if _is_ambiguous_numeric(date_text):
        score -= 0.1
    if _looks_mathy(snippet):
        score -= 0.2
    return max(0.0, min(0.95, score))


def _has_keyword(snippet: str) -> bool:
    lowered = snippet.lower()
    return any(keyword in lowered for keyword in DATE_KEYWORDS)


def _has_time(text: str) -> bool:
    return bool(DATE_TIME_RE.search(text))


def _has_keyword_near(text: str, start: int, end: int, window: int = 120) -> bool:
    # Look for deadline keywords near the mention without expanding the snippet too far.
    if start < 0 or end < 0:
        return False
    win_start = max(0, start - window)
    win_end = min(len(text), end + window)
    return _has_keyword(text[win_start:win_end])


def _looks_relative(date_text: str) -> bool:
    # Flag relative phrases that need a nearby deadline keyword to be trusted.
    value = date_text.strip().lower()
    return bool(
        re.search(
            r"\b(next|tomorrow|today|tonight|this|within|in\s+\d+|end of|end-of|after)\b",
            value,
        )
    )


def _is_time_only(date_text: str) -> bool:
    # Ignore time-only mentions without an actual date.
    return bool(TIME_ONLY_RE.match(date_text.strip()))


def _is_week_reference(date_text: str) -> bool:
    # Skip week numbers unless a term calendar is configured elsewhere.
    return bool(re.search(r"\b(?:week|wk)\s*\d{1,2}\b", date_text.strip().lower()))


def _is_day_only(date_text: str) -> bool:
    # Avoid parsing bare day-of-month mentions like "15th".
    return bool(re.fullmatch(r"\d{1,2}(st|nd|rd|th)?", date_text.strip(), re.IGNORECASE))


def _is_numeric_date(date_text: str) -> bool:
    # Identify numeric-only date patterns that are prone to false positives.
    value = date_text.strip()
    if re.search(r"[a-zA-Z]", value):
        return False
    return bool(re.search(r"[/-]", value)) or value.isdigit()


def _is_numeric_only(date_text: str) -> bool:
    # Plain numeric tokens (e.g., "2026") should not be treated as due dates.
    return bool(re.fullmatch(r"\d+", date_text.strip()))


def _extract_range_end(date_text: str) -> Optional[str]:
    # If a range is detected, return the end date as the candidate.
    match = RANGE_NUMERIC_RE.search(date_text)
    if match:
        return _normalize_numeric_range_end(match.group("start"), match.group("end"))
    match = RANGE_MONTH_RE.search(date_text)
    if match:
        end_text = f"{match.group('end')} {match.group('month')}"
        if match.group("year"):
            end_text = f"{end_text} {match.group('year')}"
        return end_text
    return None


def _normalize_numeric_range_end(start_text: str, end_text: str) -> Optional[str]:
    # Fill in missing year from the range start when needed.
    start_parts = re.split(r"[/-]", start_text)
    end_parts = re.split(r"[/-]", end_text)
    if len(end_parts) == 2 and len(start_parts) >= 3:
        return f"{end_parts[0]}/{end_parts[1]}/{start_parts[2]}"
    if len(end_parts) >= 2:
        return "/".join(end_parts)
    return None


def _is_repeated_date(text: str, date_text: str) -> bool:
    # Repeated dates are usually headers/footers, not deadlines.
    needle = date_text.strip().lower()
    if len(needle) < 4:
        return False
    return text.lower().count(needle) >= 3


def _looks_historical_or_vague_date(date_text: str) -> bool:
    # Filter out historical references like "1800s" or "circa 1553".
    value = date_text.strip().lower()
    if re.search(r"\b\d{3,4}s\b", value):
        return True
    if re.fullmatch(r"(?:in|by|during|around|circa|c\.|approx\.?|about)?\s*\d{4}", value):
        return True
    if re.search(r"\b\d{1,2}(st|nd|rd|th)\s+century\b", value):
        return True
    if re.search(r"\b(?:bc|bce|ad|ce)\b", value):
        return True
    return False


def _is_ambiguous_numeric(date_text: str) -> bool:
    match = re.match(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b", date_text.strip())
    if not match:
        return False
    first = int(match.group(1))
    second = int(match.group(2))
    return first <= 12 and second <= 12 and first != second


def _find_sentence_start(window: str, idx: int) -> int:
    start = 0
    for match in SENTENCE_BOUNDARY_RE.finditer(window[:idx]):
        start = match.end()
    while start < len(window) and window[start].isspace():
        start += 1
    return start


def _find_sentence_end(window: str, idx: int) -> int:
    match = SENTENCE_BOUNDARY_RE.search(window[idx:])
    if match:
        end = idx + match.end()
    else:
        end = len(window)
    while end > 0 and end < len(window) and window[end - 1].isspace():
        end -= 1
    return end


def _extract_time_hint(text: str, start: int, end: int, window: int = 60) -> Optional[str]:
    # Attach the nearest time (e.g. "5pm") to date-only mentions.
    if start < 0 or end < 0:
        return None
    win_start = max(0, start - window)
    win_end = min(len(text), end + window)
    window_text = text[win_start:win_end]
    local_start = max(0, start - win_start)
    local_end = max(0, end - win_start)
    sentence_start = _find_sentence_start(window_text, local_start)
    sentence_end = _find_sentence_end(window_text, local_end)
    sentence_text = window_text[sentence_start:sentence_end]
    matches = list(DATE_TIME_RE.finditer(sentence_text))
    if not matches:
        return None
    mention_center = (start + end) / 2
    best = None
    best_distance = None
    for match in matches:
        match_center = win_start + sentence_start + (match.start() + match.end()) / 2
        distance = abs(match_center - mention_center)
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best = match.group(0)
    return best


def _is_reasonable_date(value: datetime, now: datetime) -> bool:
    if value < now - timedelta(days=30):
        return False
    if value > now + timedelta(days=365 * 2):
        return False
    return True


def _looks_mathy(snippet: str) -> bool:
    if not snippet:
        return False
    letters = sum(ch.isalpha() for ch in snippet)
    digits = sum(ch.isdigit() for ch in snippet)
    symbols = sum(ch in "=+-*/^_" for ch in snippet)
    if letters == 0:
        return digits > 0
    digit_ratio = digits / max(letters, 1)
    symbol_ratio = symbols / max(len(snippet), 1)
    lowered = snippet.lower()
    if "mod " in lowered or "modulo" in lowered:
        return True
    return digit_ratio >= 0.6 or symbol_ratio > 0.05


@celery_app.task(name="dispatch_reminders")
def dispatch_reminders() -> dict:
    # Find reminders due now or within the lead window; enqueue notifications once.
    client = _get_supabase_client()
    now = datetime.now(timezone.utc)
    lead_hours = max(1, settings.reminder_lead_hours)
    window = max(1, settings.reminder_dispatch_window_minutes)
    lead_start = now + timedelta(hours=lead_hours) - timedelta(minutes=window)
    lead_end = now + timedelta(hours=lead_hours) + timedelta(minutes=window)

    lead_candidates = (
        client.table("reminders")
        .select("*")
        .eq("status", "scheduled")
        .gte("due_at", lead_start.isoformat())
        .lte("due_at", lead_end.isoformat())
        .execute()
        .data
    )
    due_candidates = (
        client.table("reminders")
        .select("*")
        .eq("status", "scheduled")
        .lte("due_at", now.isoformat())
        .execute()
        .data
    )

    hub_policy_cache: dict[str, dict] = {}
    sent = 0

    for reminder in lead_candidates:
        sent += _dispatch_for_reminder(
            client,
            reminder,
            "lead",
            now,
            hub_policy_cache,
        )

    for reminder in due_candidates:
        sent += _dispatch_for_reminder(
            client,
            reminder,
            "due",
            now,
            hub_policy_cache,
        )
        _mark_reminder_sent(client, reminder["id"], now)

    return {"notifications_sent": sent}


def _dispatch_for_reminder(
    client: Client,
    reminder: dict,
    kind: str,
    now: datetime,
    hub_policy_cache: dict[str, dict],
) -> int:
    # Apply hub policy to schedule lead/due notifications
    hub_id = reminder.get("hub_id")
    if not hub_id:
        return 0
    policy = _get_hub_policy(client, hub_id, hub_policy_cache)
    channels = _normalize_channels(policy.get("channels"))
    if not channels:
        return 0
    due_at = _parse_iso(reminder.get("due_at"))
    if not due_at:
        return 0
    scheduled_for = due_at
    if kind == "lead":
        lead_hours = int(policy.get("lead_hours") or settings.reminder_lead_hours)
        scheduled_for = due_at - timedelta(hours=lead_hours)
    sent = 0
    for channel in channels:
        if _create_notification_if_needed(
            client, reminder, channel, kind, scheduled_for, now
        ):
            sent += 1
    return sent


def _create_notification_if_needed(
    client: Client,
    reminder: dict,
    channel: str,
    kind: str,
    scheduled_for: datetime,
    now: datetime,
) -> bool:
    # Idempotency key prevents duplicate notifications across repeated runs
    key = f"{reminder['id']}:{kind}:{scheduled_for.isoformat()}:{channel}"
    existing = (
        client.table("notifications")
        .select("id")
        .eq("idempotency_key", key)
        .limit(1)
        .execute()
        .data
    )
    if existing:
        return False

    payload = {
        "user_id": reminder["user_id"],
        "reminder_id": reminder["id"],
        "channel": channel,
        "status": "queued",
        "scheduled_for": scheduled_for.isoformat(),
        "idempotency_key": key,
    }
    response = client.table("notifications").insert(payload).execute()
    if not response.data:
        return False
    notification_id = response.data[0]["id"]

    # Mark as sent immediately for in-app notifications.
    _update_notification(client, notification_id, "sent", now, None, None)
    return True



def _update_notification(
    client: Client,
    notification_id: str,
    status_value: str,
    now: datetime,
    provider_id: Optional[str],
    error: Optional[str],
) -> None:
    payload = {"status": status_value, "sent_at": now.isoformat(), "provider_id": provider_id, "error": error}
    client.table("notifications").update(payload).eq("id", notification_id).execute()


def _mark_reminder_sent(client: Client, reminder_id: str, now: datetime) -> None:
    client.table("reminders").update({"status": "sent", "sent_at": now.isoformat()}).eq("id", reminder_id).execute()


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    cleaned = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        return None


def _get_hub_policy(client: Client, hub_id: str, cache: dict[str, dict]) -> dict:
    cached = cache.get(hub_id)
    if cached is not None:
        return cached
    response = client.table("hubs").select("reminder_policy").eq("id", hub_id).limit(1).execute()
    policy = response.data[0].get("reminder_policy") if response.data else {}
    if not isinstance(policy, dict):
        policy = {}
    if "lead_hours" not in policy:
        policy["lead_hours"] = settings.reminder_lead_hours
    cache[hub_id] = policy
    return policy


def _normalize_channels(value: Optional[list]) -> list[str]:
    # Only allow supported channels; fall back to in-app.
    if not value:
        return ["in_app"]
    channels: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        key = item.lower()
        if key == "in_app":
            channels.append(key)
    return channels or ["in_app"]
