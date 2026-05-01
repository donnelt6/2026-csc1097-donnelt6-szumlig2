"""Worker ingestion flows and helper functions."""

import os
import socket
from datetime import datetime, timezone
from typing import List, Optional

from celery.exceptions import SoftTimeLimitExceeded
from openai import OpenAI
from supabase import Client

from . import common as _common
from . import content as _content
from . import media as _media
from . import reminders as _reminders
from . import storage as _storage
from . import web as _web
from . import youtube as _youtube
from .app import logger, settings

_YOUTUBE_FAILURE_METADATA_KEYS = {
    "youtube_failure_code",
    "youtube_fallback_allowed",
    "youtube_fallback_user_message",
}


def _classify_youtube_failure(message: str) -> tuple[str, bool, str]:
    # Map low-level ingestion failures into stable codes and user-facing
    # fallback guidance that the web app can interpret consistently.
    lowered = message.strip().lower()
    if "blocked the hosted worker with a bot check" in lowered:
        return (
            "youtube_bot_check",
            True,
            "Caddie could not import captions from this YouTube URL. Upload the audio or video file manually instead.",
        )
    if "no captions available for this youtube video" in lowered:
        return (
            "youtube_no_captions",
            True,
            "This YouTube video has no usable captions. Upload the audio or video file manually instead.",
        )
    if "caption track was empty" in lowered:
        return (
            "youtube_empty_captions",
            True,
            "This YouTube video's captions were empty. Upload the audio or video file manually instead.",
        )
    if "no transcript text extracted from youtube captions" in lowered:
        return (
            "youtube_empty_transcript",
            True,
            "Caddie could not extract transcript text from the YouTube captions. Upload the audio or video file manually instead.",
        )
    if "failed to download captions" in lowered or "rate limit hit" in lowered:
        return (
            "youtube_caption_fetch_failed",
            True,
            "Caddie could not fetch the YouTube captions from this URL. Upload the audio or video file manually instead.",
        )
    if "timed out while fetching captions or generating chunks" in lowered:
        return (
            "youtube_timeout",
            True,
            "YouTube import timed out. Upload the audio or video file manually instead.",
        )
    if "yt-dlp is required" in lowered:
        return ("youtube_dependency_error", False, "YouTube import is unavailable because the worker is missing a dependency.")
    if "youtube_cookies_b64 must be valid" in lowered:
        return ("youtube_config_error", False, "YouTube import is unavailable because the worker configuration is invalid.")
    return ("youtube_internal_error", False, "YouTube import failed unexpectedly.")


def _clear_youtube_failure_metadata(metadata: Optional[dict]) -> dict:
    cleaned = dict(metadata or {})
    for key in _YOUTUBE_FAILURE_METADATA_KEYS:
        cleaned.pop(key, None)
    return cleaned


def _build_youtube_failure_metadata(existing_metadata: Optional[dict], failure_reason: str) -> dict:
    code, allowed, user_message = _classify_youtube_failure(failure_reason)
    metadata = dict(existing_metadata or {})
    metadata["youtube_failure_code"] = code
    metadata["youtube_fallback_allowed"] = allowed
    metadata["youtube_fallback_user_message"] = user_message
    return metadata


def _mirror_youtube_fallback_parent_status(
    client: Client,
    source_id: str,
    status: str,
    source_metadata: Optional[dict] = None,
    source_might_be_youtube_fallback: bool = False,
) -> None:
    # Linked manual media uploads update their failed YouTube parent through
    # metadata so the UI can show recovery progress on the original source row.
    metadata = dict(source_metadata or {})
    if not metadata:
        if not source_might_be_youtube_fallback:
            return
        metadata = _storage._get_source_metadata(client, source_id)
    if metadata.get("source_origin") != "youtube_fallback":
        return
    parent_source_id = str(metadata.get("youtube_fallback_parent_source_id") or "").strip()
    if not parent_source_id:
        return
    parent_metadata = _storage._get_source_metadata(client, parent_source_id)
    if not parent_metadata:
        return
    parent_metadata["youtube_fallback_source_id"] = source_id
    parent_metadata["youtube_fallback_source_status"] = status
    # Keep the parent row failed because the original YouTube import did fail.
    # Recovery progress is mirrored through metadata on that failed row instead
    # of rewriting the parent status to match the child upload.
    _storage._update_source(
        client,
        parent_source_id,
        status="failed",
        ingestion_metadata=parent_metadata,
    )


def ingest_source(self, source_id: str, hub_id: str, storage_path: str) -> dict:
    # Handle file-backed sources, including manual media fallback uploads that
    # need transcription before the normal chunking pipeline can run.
    logger.info("worker.ingest.start source_id=%s", source_id)
    client = _common._get_supabase_client()
    source_metadata = _storage._get_source_metadata(client, source_id)
    _update_source(
        client,
        source_id,
        status="processing",
        clear_failure_reason=True,
        source_metadata=source_metadata,
        source_might_be_youtube_fallback=source_metadata.get("source_origin") == "youtube_fallback",
    )

    try:
        raw = _storage._download_from_storage(storage_path)
    except Exception as exc:
        logger.warning("worker.ingest.download_retry storage_path=%s error=%s", storage_path, exc)
        raise self.retry(exc=exc)

    try:
        if source_metadata.get("file_kind") == "media":
            text, media_metadata = _media._transcribe_media_bytes(raw, storage_path)
            extra_metadata = {
                **source_metadata,
                **media_metadata,
                **_build_media_runtime_metadata(),
            }
        else:
            text = _content._extract_text(raw, storage_path)
            extra_metadata = source_metadata or None
        text = _common._normalize_text(text)
        if not text:
            raise ValueError("No text extracted from source")

        chunk_count = _ingest_text_for_source(client, source_id, hub_id, text, extra_metadata=extra_metadata)
        logger.info("worker.ingest.complete source_id=%s", source_id)
        return {"source_id": source_id, "hub_id": hub_id, "chunks": chunk_count}
    except Exception as exc:
        logger.exception("worker.ingest.failed source_id=%s", source_id)
        failure_metadata = dict(source_metadata or {})
        if failure_metadata.get("file_kind") == "media":
            failure_metadata.update(_build_media_failure_metadata(storage_path))
        _update_source(
            client,
            source_id,
            status="failed",
            failure_reason=str(exc)[:500],
            ingestion_metadata=failure_metadata or None,
        )
        raise


def ingest_web_source(self, source_id: str, hub_id: str, url: str, storage_path: str) -> dict:
    # Crawl, snapshot, and ingest a web page into the same chunk pipeline used
    # by uploaded documents.
    logger.info("worker.web_ingest.start source_id=%s url=%s", source_id, url)
    client = _common._get_supabase_client()
    _update_source(client, source_id, status="processing", clear_failure_reason=True)

    try:
        safe_url = _web._validate_public_url(url)
        if settings.web_respect_robots and not _web._allowed_by_robots(safe_url, settings.web_user_agent):
            raise ValueError("Blocked by robots.txt")
        raw, content_type, final_url = _web._fetch_url_content(safe_url)
        text, title = _web._extract_web_text(raw, content_type)
        text = _common._normalize_text(text)
        if not text:
            raise ValueError("No text extracted from web page")
        crawl_at = datetime.now(timezone.utc).isoformat()
        pseudo_doc = _web._build_pseudo_doc(title, final_url or safe_url, crawl_at, content_type, text)
        _storage._upload_pseudo_doc(client, storage_path, pseudo_doc)
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
            logger.warning("worker.web_ingest.title_update_failed source_id=%s", source_id, exc_info=True)
        logger.info("worker.web_ingest.complete source_id=%s", source_id)
        return {"source_id": source_id, "hub_id": hub_id, "chunks": chunk_count}
    except Exception as exc:
        logger.exception("worker.web_ingest.failed source_id=%s", source_id)
        _update_source(client, source_id, status="failed", failure_reason=str(exc)[:500])
        raise


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
    # Ingest caption text plus lightweight video metadata, and preserve enough
    # failure metadata for manual fallback when hosted imports break.
    logger.info("worker.youtube_ingest.start source_id=%s url=%s", source_id, url)
    client = _common._get_supabase_client()
    existing_metadata = _storage._get_source_metadata(client, source_id)
    _update_source(
        client,
        source_id,
        status="processing",
        clear_failure_reason=True,
        ingestion_metadata=_clear_youtube_failure_metadata(existing_metadata),
    )

    try:
        transcript, info, captions_meta = _youtube._fetch_youtube_transcript(
            url,
            language=language,
            allow_auto_captions=allow_auto_captions,
        )
        if video_id:
            info["video_id"] = video_id
        text = _common._normalize_text(transcript)
        if not text:
            raise ValueError("No transcript text extracted from YouTube captions")
        fetched_at = datetime.now(timezone.utc).isoformat()
        pseudo_doc = _youtube._build_youtube_pseudo_doc(info, url, fetched_at, captions_meta, text)
        _storage._upload_pseudo_doc(client, storage_path, pseudo_doc)
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
            logger.warning("worker.youtube_ingest.title_update_failed source_id=%s", source_id, exc_info=True)
        logger.info("worker.youtube_ingest.complete source_id=%s", source_id)
        return {"source_id": source_id, "hub_id": hub_id, "chunks": chunk_count}
    except SoftTimeLimitExceeded:
        logger.exception("worker.youtube_ingest.timeout source_id=%s", source_id)
        failure_reason = "YouTube ingestion timed out while fetching captions or generating chunks"
        _update_source(
            client,
            source_id,
            status="failed",
            failure_reason=failure_reason,
            ingestion_metadata=_build_youtube_failure_metadata(_storage._get_source_metadata(client, source_id), failure_reason),
        )
        raise
    except Exception as exc:
        logger.exception("worker.youtube_ingest.failed source_id=%s", source_id)
        failure_reason = str(exc)[:500]
        _update_source(
            client,
            source_id,
            status="failed",
            failure_reason=failure_reason,
            ingestion_metadata=_build_youtube_failure_metadata(_storage._get_source_metadata(client, source_id), failure_reason),
        )
        raise


def _ingest_text_for_source(
    client: Client,
    source_id: str,
    hub_id: str,
    text: str,
    extra_metadata: Optional[dict],
) -> int:
    # All ingestion entrypoints converge here once they have normalized text,
    # keeping chunking, embeddings, and reminder detection consistent.
    chunks = _chunk_text(text, settings.chunk_size, settings.chunk_overlap)
    if not chunks:
        raise ValueError("No chunks produced from extracted text")
    if not _storage._source_exists(client, source_id):
        logger.info("Source %s deleted before ingest; skipping.", source_id)
        return 0
    ingest_started_at = datetime.now(timezone.utc)
    ingest_timestamp = ingest_started_at.isoformat()
    embeddings = _embed_chunks(chunks)
    if not _storage._source_exists(client, source_id):
        logger.info("Source %s deleted during embed; skipping insert.", source_id)
        return 0
    _insert_chunks(client, source_id, hub_id, chunks, embeddings, ingest_timestamp)
    _clear_existing_chunks_before(client, source_id, ingest_timestamp)
    existing_metadata = _storage._get_source_metadata(client, source_id)
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
        _reminders._detect_and_store_reminders(client, source_id, hub_id, text)
    except Exception:
        logger.exception("Reminder detection failed for source %s", source_id)
    return len(chunks)


def _chunk_text(text: str, chunk_size: int, overlap: int) -> List[str]:
    # Chunk by words with overlap because retrieval quality matters more than
    # preserving original formatting boundaries for these source types.
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
    # Batch embedding calls to stay within payload limits while keeping retries
    # scoped to smaller groups of chunks.
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY missing in worker environment")
    client = OpenAI(api_key=settings.openai_api_key)
    embeddings: List[List[float]] = []
    for batch in _common._batch(chunks, 64):
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
    # Insert chunk rows in batches so large sources do not build a single huge
    # PostgREST payload.
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
    for batch in _common._batch(rows, 100):
        client.table("source_chunks").insert(batch).execute()


def _clear_existing_chunks_before(client: Client, source_id: str, cutoff: str) -> None:
    _storage._clear_existing_chunks_before(client, source_id, cutoff)


def _update_source(
    client: Client,
    source_id: str,
    status: str,
    failure_reason: Optional[str] = None,
    ingestion_metadata: Optional[dict] = None,
    clear_failure_reason: bool = False,
    source_metadata: Optional[dict] = None,
    source_might_be_youtube_fallback: bool = False,
) -> None:
    # Wrap storage-layer source updates so YouTube fallback metadata mirroring
    # stays attached to every status transition.
    _storage._update_source(
        client,
        source_id,
        status,
        failure_reason=failure_reason,
        ingestion_metadata=ingestion_metadata,
        clear_failure_reason=clear_failure_reason,
    )
    _mirror_youtube_fallback_parent_status(
        client,
        source_id,
        status,
        source_metadata=ingestion_metadata if ingestion_metadata is not None else source_metadata,
        source_might_be_youtube_fallback=source_might_be_youtube_fallback,
    )


def _build_media_runtime_metadata() -> dict:
    return {
        "transcription_runtime_host": socket.gethostname(),
        "transcription_runtime_pid": os.getpid(),
        "transcription_model": settings.transcription_model,
    }


def _build_media_failure_metadata(storage_path: str) -> dict:
    return {
        **_build_media_runtime_metadata(),
        "transcription_storage_path": storage_path,
        "transcription_input_extension": _media._media_extension(storage_path).lstrip("."),
    }


__all__ = [
    "SoftTimeLimitExceeded",
    "_chunk_text",
    "_classify_youtube_failure",
    "_ingest_text_for_source",
    "_update_source",
    "ingest_source",
    "ingest_web_source",
    "ingest_youtube_source",
]
