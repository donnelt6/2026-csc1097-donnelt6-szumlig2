"""tasks.py: Celery task entrypoints plus worker task orchestration."""

import hashlib
import json
import re
import ssl
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
from zoneinfo import ZoneInfo

import dateparser
import redis
import spacy
from celery.exceptions import SoftTimeLimitExceeded
from openai import OpenAI
from supabase import Client

from . import common as _common
from . import content as _content
from . import response_utils as _response_utils
from . import storage as _storage
from . import web as _web
from . import youtube as _youtube
from .app import celery_app, logger, settings


# Celery ingestion tasks.
# These task entrypoints stay in `worker.tasks` so Celery commands and task
# names keep working while helper logic lives in focused worker modules.
# Ingests an uploaded file source by downloading, extracting, chunking, and storing its content.
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
    logger.info("worker.ingest.start source_id=%s", source_id)
    client = _common._get_supabase_client()
    _update_source(client, source_id, status="processing", clear_failure_reason=True)

    try:
        raw = _storage._download_from_storage(storage_path)
    except Exception as exc:
        logger.warning("worker.ingest.download_retry storage_path=%s error=%s", storage_path, exc)
        raise self.retry(exc=exc)

    try:
        text = _content._extract_text(raw, storage_path)
        text = _common._normalize_text(text)
        if not text:
            raise ValueError("No text extracted from source")

        chunk_count = _ingest_text_for_source(client, source_id, hub_id, text, extra_metadata=None)
        logger.info("worker.ingest.complete source_id=%s", source_id)
        return {"source_id": source_id, "hub_id": hub_id, "chunks": chunk_count}
    except Exception as exc:
        logger.exception("worker.ingest.failed source_id=%s", source_id)
        _update_source(client, source_id, status="failed", failure_reason=str(exc)[:500])
        raise


# Ingests a web source by fetching the page, extracting text, and storing the resulting chunks.
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


# Ingests a YouTube source by downloading captions and storing the transcript content.
@celery_app.task(
    bind=True,
    name="ingest_youtube_source",
    max_retries=3,
    default_retry_delay=15,
    soft_time_limit=settings.youtube_task_soft_time_limit_seconds,
    time_limit=settings.youtube_task_time_limit_seconds,
)
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
    logger.info("worker.youtube_ingest.start source_id=%s url=%s", source_id, url)
    client = _common._get_supabase_client()
    _update_source(client, source_id, status="processing", clear_failure_reason=True)

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
    except SoftTimeLimitExceeded as exc:
        logger.exception("worker.youtube_ingest.timeout source_id=%s", source_id)
        _update_source(
            client,
            source_id,
            status="failed",
            failure_reason="YouTube ingestion timed out while fetching captions or generating chunks",
        )
        raise
    except Exception as exc:
        logger.exception("worker.youtube_ingest.failed source_id=%s", source_id)
        _update_source(client, source_id, status="failed", failure_reason=str(exc)[:500])
        raise


# Scans eligible hubs and generates any new source suggestions that should be queued.
@celery_app.task(name="scan_source_suggestions")
def scan_source_suggestions() -> dict:
    client = _common._get_supabase_client()
    now = datetime.now(timezone.utc)
    eligible_hubs = _list_eligible_source_suggestion_hubs(client, now=now)
    processed = 0
    generated = 0

    for hub in eligible_hubs:
        hub_id = str(hub.get("id") or "")
        if not hub_id:
            continue
        # Use a short-lived Redis lock so multiple workers do not scan the same hub together.
        lock = _acquire_source_suggestion_lock(hub_id)
        if lock is None:
            logger.info("worker.source_suggestions.lock_held hub_id=%s", hub_id)
            continue
        try:
            result = _generate_source_suggestions_for_hub(client, hub_id, now=now)
            processed += 1
            generated += int(result.get("inserted", 0) or 0)
        except Exception:
            logger.exception("worker.source_suggestions.failed hub_id=%s", hub_id)
            _mark_source_suggestion_scan(client, hub_id, now=now, generated=False)
        finally:
            _release_source_suggestion_lock(lock)

    return {"eligible_hubs": len(eligible_hubs), "processed_hubs": processed, "generated": generated}

# Chunks text, embeds it, stores the vectors, and triggers reminder detection for a source.
def _ingest_text_for_source(
    client: Client,
    source_id: str,
    hub_id: str,
    text: str,
    extra_metadata: Optional[dict],
) -> int:
    # Re-check source existence before and after embedding so user-driven source
    # deletion cannot leave newly generated chunks behind.
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
        _detect_and_store_reminders(client, source_id, hub_id, text)
    except Exception:
        logger.exception("Reminder detection failed for source %s", source_id)
    return len(chunks)


# Splits text into overlapping word chunks for embedding.
def _chunk_text(text: str, chunk_size: int, overlap: int) -> List[str]:
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
        # Rewind by the configured overlap so adjacent chunks keep enough shared
        # context for retrieval without duplicating the full window each time.
        start = max(end - overlap, 0)
    return chunks


# Requests embeddings for the prepared text chunks from OpenAI.
def _embed_chunks(chunks: List[str]) -> List[List[float]]:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY missing in worker environment")
    client = OpenAI(api_key=settings.openai_api_key)
    embeddings: List[List[float]] = []
    for batch in _common._batch(chunks, 64):
        # Batch requests to keep payload size under API limits.
        response = client.embeddings.create(model=settings.embedding_model, input=batch)
        embeddings.extend([item.embedding for item in response.data])
    return embeddings


# Writes embedded chunk records into the database in batches.
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
    for batch in _common._batch(rows, 100):
        client.table("source_chunks").insert(batch).execute()


# Deletes older chunk rows for the same source before new ones are inserted.
def _clear_existing_chunks_before(client: Client, source_id: str, cutoff: str) -> None:
    _storage._clear_existing_chunks_before(client, source_id, cutoff)


# Updates the source status and related bookkeeping fields in the database.
def _update_source(
    client: Client,
    source_id: str,
    status: str,
    failure_reason: Optional[str] = None,
    ingestion_metadata: Optional[dict] = None,
    clear_failure_reason: bool = False,
) -> None:
    _storage._update_source(
        client,
        source_id,
        status,
        failure_reason=failure_reason,
        ingestion_metadata=ingestion_metadata,
        clear_failure_reason=clear_failure_reason,
    )


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


# Reminder detection and date parsing helpers.
# Finds possible reminder dates in source text and stores any valid reminder candidates.
def _detect_and_store_reminders(client: Client, source_id: str, hub_id: str, text: str) -> None:

    # Cap text length for deterministic runtime; candidates are deduped via upsert.
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
    for batch in _common._batch(rows, 50):
        client.table("reminder_candidates").upsert(
            batch, on_conflict="source_id,due_at,snippet_hash"
        ).execute()


# Builds reminder date candidates from multiple date-detection strategies.
def _find_date_candidates(text: str, timezone_name: str) -> List[dict]:
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
        # Attach a nearby time to otherwise date-only mentions when one is available.
        # Date mentions often appear beside a separate time token; combine them
        # here so downstream parsing preserves the intended due time.
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
        # Deduplicate by parsed due date plus snippet so repeated mentions do not create duplicate candidates.
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


# Collects standalone date mentions from the source text.
def _collect_date_mentions(text: str) -> List[dict]:
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


# Deduplicates reminder candidates and keeps the strongest match for each date.
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


# Collects date range mentions so start and end dates can be interpreted together.
def _collect_range_mentions(text: str) -> List[dict]:
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


# Lazily loads and caches the spaCy model used for date extraction support.
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


# Parses a detected date phrase into a timezone-aware datetime.
def _parse_date_text(date_text: str, timezone_name: str, now: datetime) -> Optional[datetime]:
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


# Safely resolves a timezone name into a `ZoneInfo` object.
def _safe_zoneinfo(name: str) -> Optional[ZoneInfo]:
    try:
        return ZoneInfo(name)
    except Exception:
        return None


# Extracts a local text snippet around a detected date for context and scoring.
def _extract_snippet(text: str, start: int, end: int, radius: int = 120) -> str:
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


# Builds a short reminder title from the surrounding source snippet.
def _build_title(snippet: str) -> str:
    cleaned = snippet.strip()
    if len(cleaned) <= 80:
        return cleaned
    return f"{cleaned[:77].rstrip()}..."


# Hashes a snippet so repeated reminder candidates can be deduplicated.
def _hash_snippet(snippet: str) -> str:
    return hashlib.sha256(snippet.lower().encode("utf-8")).hexdigest()


# Scores a reminder candidate so better matches can win during deduplication.
def _score_candidate(method: str, snippet: str, date_text: str) -> float:
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


# Checks whether a snippet contains reminder-related keywords.
def _has_keyword(snippet: str) -> bool:
    lowered = snippet.lower()
    return any(keyword in lowered for keyword in DATE_KEYWORDS)


# Checks whether a date phrase also contains an explicit time.
def _has_time(text: str) -> bool:
    return bool(DATE_TIME_RE.search(text))


# Checks whether reminder keywords appear near a detected date mention.
def _has_keyword_near(text: str, start: int, end: int, window: int = 120) -> bool:
    if start < 0 or end < 0:
        return False
    win_start = max(0, start - window)
    win_end = min(len(text), end + window)
    return _has_keyword(text[win_start:win_end])


# Checks whether a date phrase is relative rather than a concrete scheduled date.
def _looks_relative(date_text: str) -> bool:
    value = date_text.strip().lower()
    return bool(
        re.search(
            r"\b(next|tomorrow|today|tonight|this|within|in\s+\d+|end of|end-of|after)\b",
            value,
        )
    )


# Checks whether a parsed phrase looks like a time without a date.
def _is_time_only(date_text: str) -> bool:
    return bool(TIME_ONLY_RE.match(date_text.strip()))


# Checks whether a phrase refers to a week rather than a specific event date.
def _is_week_reference(date_text: str) -> bool:
    return bool(re.search(r"\b(?:week|wk)\s*\d{1,2}\b", date_text.strip().lower()))


# Checks whether a phrase names only a weekday without enough scheduling detail.
def _is_day_only(date_text: str) -> bool:
    return bool(re.fullmatch(r"\d{1,2}(st|nd|rd|th)?", date_text.strip(), re.IGNORECASE))


# Checks whether a phrase resembles a numeric calendar date.
def _is_numeric_date(date_text: str) -> bool:
    value = date_text.strip()
    if re.search(r"[a-zA-Z]", value):
        return False
    return bool(re.search(r"[/-]", value)) or value.isdigit()


# Checks whether a phrase is only digits without enough date context.
def _is_numeric_only(date_text: str) -> bool:
    return bool(re.fullmatch(r"\d+", date_text.strip()))


# Extracts the trailing date text from a detected date range.
def _extract_range_end(date_text: str) -> Optional[str]:
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


# Normalizes short range endings so they can be parsed with the range start.
def _normalize_numeric_range_end(start_text: str, end_text: str) -> Optional[str]:
    start_parts = re.split(r"[/-]", start_text)
    end_parts = re.split(r"[/-]", end_text)
    if len(end_parts) == 2 and len(start_parts) >= 3:
        return f"{end_parts[0]}/{end_parts[1]}/{start_parts[2]}"
    if len(end_parts) >= 2:
        return "/".join(end_parts)
    return None


# Checks whether a date phrase appears too many times to be a useful reminder anchor.
def _is_repeated_date(text: str, date_text: str) -> bool:
    needle = date_text.strip().lower()
    if len(needle) < 4:
        return False
    return text.lower().count(needle) >= 3


# Rejects dates that look historical, vague, or otherwise unsuitable for reminders.
def _looks_historical_or_vague_date(date_text: str) -> bool:
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


# Rejects numeric date phrases that are too ambiguous to trust.
def _is_ambiguous_numeric(date_text: str) -> bool:
    match = re.match(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b", date_text.strip())
    if not match:
        return False
    first = int(match.group(1))
    second = int(match.group(2))
    return first <= 12 and second <= 12 and first != second


# Finds the start of the local sentence around a detected match.
def _find_sentence_start(window: str, idx: int) -> int:
    start = 0
    for match in SENTENCE_BOUNDARY_RE.finditer(window[:idx]):
        start = match.end()
    while start < len(window) and window[start].isspace():
        start += 1
    return start


# Finds the end of the local sentence around a detected match.
def _find_sentence_end(window: str, idx: int) -> int:
    match = SENTENCE_BOUNDARY_RE.search(window[idx:])
    if match:
        end = idx + match.end()
    else:
        end = len(window)
    while end > 0 and end < len(window) and window[end - 1].isspace():
        end -= 1
    return end


# Extracts a nearby time expression that may refine the parsed reminder date.
def _extract_time_hint(text: str, start: int, end: int, window: int = 60) -> Optional[str]:
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


# Checks whether a parsed reminder date falls within a sensible time range.
def _is_reasonable_date(value: datetime, now: datetime) -> bool:
    if value < now - timedelta(days=30):
        return False
    if value > now + timedelta(days=365 * 2):
        return False
    return True


# Rejects snippets that look more like formulas than natural-language reminders.
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


# Source suggestion scanning and discovery helpers.
# Builds the Redis client used for worker locks and background coordination.
def _get_redis_client() -> redis.Redis:

    redis_url = settings.redis_url
    client_kwargs: dict = {}

    if redis_url.lower().startswith("rediss://"):
        parsed = urlparse(redis_url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        ssl_cert_reqs_raw = (query.get("ssl_cert_reqs") or [None])[-1]
        if isinstance(ssl_cert_reqs_raw, str):
            mapped = {
                "cert_none": ssl.CERT_NONE,
                "none": ssl.CERT_NONE,
                "0": ssl.CERT_NONE,
                "cert_optional": ssl.CERT_OPTIONAL,
                "optional": ssl.CERT_OPTIONAL,
                "1": ssl.CERT_OPTIONAL,
                "cert_required": ssl.CERT_REQUIRED,
                "required": ssl.CERT_REQUIRED,
                "2": ssl.CERT_REQUIRED,
            }.get(ssl_cert_reqs_raw.strip().lower())
            if mapped is not None:
                client_kwargs["ssl_cert_reqs"] = mapped
                if mapped == ssl.CERT_NONE:
                    client_kwargs["ssl_check_hostname"] = False
                query.pop("ssl_cert_reqs", None)
                redis_url = urlunparse(
                    (
                        parsed.scheme,
                        parsed.netloc,
                        parsed.path,
                        parsed.params,
                        urlencode(query, doseq=True),
                        parsed.fragment,
                    )
                )

    return redis.Redis.from_url(redis_url, **client_kwargs)


# Claims a per-hub Redis lock so only one worker scans suggestions at a time.
def _acquire_source_suggestion_lock(hub_id: str) -> Optional[tuple[redis.Redis, str, str]]:
    client = _get_redis_client()
    key = f"locks:source-suggestions:{hub_id}"
    token = str(uuid.uuid4())
    try:
        acquired = client.set(key, token, nx=True, ex=max(60, settings.suggested_sources_lock_ttl_seconds))
    except Exception:
        client.close()
        raise
    if not acquired:
        client.close()
        return None
    return client, key, token


# Releases a previously acquired source-suggestion Redis lock.
def _release_source_suggestion_lock(lock: tuple[redis.Redis, str, str]) -> None:
    client, key, token = lock
    try:
        current = client.get(key)
        if current is not None and current.decode("utf-8", errors="ignore") == token:
            client.delete(key)
    finally:
        client.close()


# Loads hubs that are eligible for a new source-suggestion scan.
def _list_eligible_source_suggestion_hubs(client: Client, now: Optional[datetime] = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    hubs_response = client.table("hubs").select("id,last_source_suggestion_scan_at").execute()
    hubs = hubs_response.data or []
    if not hubs:
        return []

    complete_counts: dict[str, int] = defaultdict(int)
    for row in client.table("sources").select("hub_id").eq("status", "complete").execute().data or []:
        hub_id = str(row.get("hub_id") or "")
        if hub_id:
            complete_counts[hub_id] += 1

    active_cutoff = now - timedelta(days=max(1, settings.suggested_sources_active_days))
    active_hub_ids = {
        str(row.get("hub_id"))
        for row in (
            client.table("hub_members")
            .select("hub_id")
            .not_.is_("accepted_at", "null")
            .gte("last_accessed_at", active_cutoff.isoformat())
            .execute()
            .data
            or []
        )
        if row.get("hub_id")
    }
    pending_hub_ids = {
        str(row.get("hub_id"))
        for row in client.table("source_suggestions").select("hub_id").eq("status", "pending").execute().data or []
        if row.get("hub_id")
    }
    return _filter_eligible_source_suggestion_hubs(
        hubs,
        complete_source_counts=complete_counts,
        active_hub_ids=active_hub_ids,
        pending_hub_ids=pending_hub_ids,
        now=now,
    )


# Filters hubs down to those that are active, ready, and outside cooldown windows.
def _filter_eligible_source_suggestion_hubs(
    hubs: list[dict],
    *,
    complete_source_counts: dict[str, int],
    active_hub_ids: set[str],
    pending_hub_ids: set[str],
    now: datetime,
) -> list[dict]:
    eligible: list[dict] = []
    cooldown = timedelta(minutes=max(1, settings.suggested_sources_hub_cooldown_minutes))
    min_sources = max(1, settings.suggested_sources_min_complete_sources)

    for hub in hubs:
        hub_id = str(hub.get("id") or "")
        if not hub_id:
            continue
        if hub_id in pending_hub_ids:
            continue
        if complete_source_counts.get(hub_id, 0) < min_sources:
            continue
        if hub_id not in active_hub_ids:
            continue
        last_scan = _common._parse_iso(hub.get("last_source_suggestion_scan_at"))
        if last_scan is not None and last_scan > now - cooldown:
            continue
        eligible.append(hub)
    return eligible


# Generates and stores new source suggestions for a single eligible hub.
def _generate_source_suggestions_for_hub(client: Client, hub_id: str, now: Optional[datetime] = None) -> dict:
    now = now or datetime.now(timezone.utc)
    seed_source_ids, context_text = _build_source_suggestion_context(client, hub_id)
    if len(seed_source_ids) < settings.suggested_sources_min_complete_sources or not context_text.strip():
        _mark_source_suggestion_scan(client, hub_id, now=now, generated=False)
        return {"inserted": 0, "reason": "insufficient_context"}

    discovered, search_metadata = _discover_source_suggestions(context_text)
    normalized = _normalize_source_suggestion_candidates(
        discovered,
        hub_id=hub_id,
        seed_source_ids=seed_source_ids,
        search_metadata=search_metadata,
    )
    existing_suggestion_targets = _load_existing_source_suggestion_targets(client, hub_id)
    existing_source_targets = _load_existing_source_targets(client, hub_id)
    pending_rows = _filter_new_source_suggestions(
        normalized,
        existing_source_targets=existing_source_targets,
        existing_suggestion_targets=existing_suggestion_targets,
        limit=max(1, settings.suggested_sources_batch_limit),
    )
    if pending_rows:
        client.table("source_suggestions").insert(pending_rows).execute()
    _mark_source_suggestion_scan(client, hub_id, now=now, generated=bool(pending_rows))
    return {"inserted": len(pending_rows)}


# Builds the LLM context bundle used to discover new source suggestions.
def _build_source_suggestion_context(client: Client, hub_id: str) -> tuple[list[str], str]:
    source_rows = (
        client.table("sources")
        .select("id,type,original_name,ingestion_metadata,created_at")
        .eq("hub_id", hub_id)
        .eq("status", "complete")
        .order("created_at", desc=True)
        .limit(max(1, settings.suggested_sources_context_limit))
        .execute()
        .data
        or []
    )
    if not source_rows:
        return [], ""

    source_ids = [str(row.get("id")) for row in source_rows if row.get("id")]
    chunk_rows = []
    if source_ids:
        chunk_rows = (
            client.table("source_chunks")
            .select("source_id,chunk_index,text")
            .in_("source_id", source_ids)
            .order("chunk_index")
            .execute()
            .data
            or []
        )

    excerpts: dict[str, list[str]] = defaultdict(list)
    max_chunks = max(1, settings.suggested_sources_chunks_per_source)
    for row in chunk_rows:
        source_id = str(row.get("source_id") or "")
        text = _common._normalize_text(str(row.get("text") or ""))
        if not source_id or not text or len(excerpts[source_id]) >= max_chunks:
            continue
        excerpts[source_id].append(_common._trim_text(text, 500))

    blocks: list[str] = []
    for row in source_rows:
        source_id = str(row.get("id") or "")
        source_type = str(row.get("type") or "file")
        title = str(row.get("original_name") or source_id)
        metadata = row.get("ingestion_metadata") if isinstance(row.get("ingestion_metadata"), dict) else {}
        lines = [f"Source ID: {source_id}", f"Type: {source_type}", f"Title: {title}"]
        if source_type == "web":
            url = metadata.get("final_url") or metadata.get("url")
            if url:
                lines.append(f"URL: {url}")
        if source_type == "youtube":
            channel = metadata.get("channel")
            if channel:
                lines.append(f"Channel: {channel}")
            video_id = metadata.get("video_id")
            if video_id:
                lines.append(f"Video ID: {video_id}")
        for idx, excerpt in enumerate(excerpts.get(source_id, []), start=1):
            lines.append(f"Excerpt {idx}: {excerpt}")
        blocks.append("\n".join(lines))
    return source_ids, "\n\n".join(blocks)


# Calls the LLM and web search tools to discover candidate source suggestions.
def _discover_source_suggestions(context_text: str) -> tuple[list[dict], dict]:
    if not settings.openai_api_key:
        logger.warning("Skipping source suggestions because OPENAI_API_KEY is missing")
        return [], {"error": "missing_openai_api_key"}

    llm_client = OpenAI(api_key=settings.openai_api_key)
    responses_client = getattr(llm_client, "responses", None)
    if responses_client is None:
        logger.warning("Skipping source suggestions because Responses API is unavailable")
        return [], {"error": "responses_api_unavailable"}

    system_prompt = (
        "You find suggested sources for a study hub. Use web search to find public resources that complement the existing hub material. "
        "Return only a JSON array with up to 6 objects. Each object must include: "
        "type ('web' or 'youtube'), url, title, description, rationale, confidence. "
        "Prefer authoritative pages and relevant YouTube videos. When relevant, include at least 1 YouTube video in the returned set. "
        "Avoid login pages, homepages with no clear relevance, PDFs, and duplicates."
    )
    user_prompt = f"Hub context:\n{context_text}"

    try:
        # Ask the model to use web search and return a strict JSON array of candidates.
        response = responses_client.create(
            model=settings.suggested_sources_model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            tools=[{"type": "web_search_preview"}],
            temperature=0.2,
        )
        raw_text = _response_utils._extract_response_text(response)
        # Parse defensively because the model can still wrap JSON in markdown or extra text.
        candidates = _parse_source_suggestion_candidates(raw_text)
        # Keep only lightweight search metadata so suggestion rows capture
        # enough audit context without storing the full tool payload.
        search_results = []
        for item in _response_utils._extract_web_search_results(response)[:10]:
            search_results.append(
                {
                    "title": _response_utils._get_attr(item, "title", "") or "",
                    "url": _response_utils._get_attr(item, "url", "") or _response_utils._get_attr(item, "link", "") or "",
                }
            )
        metadata = {
            "model": settings.suggested_sources_model,
            "usage": _response_utils._extract_usage(response),
            "search_results": search_results,
        }
        return candidates, metadata
    except Exception as exc:
        logger.warning("Source suggestion discovery failed", exc_info=True)
        return [], {"error": str(exc)[:500], "model": settings.suggested_sources_model}


# Normalizes raw candidate objects into validated suggestion payloads.
def _normalize_source_suggestion_candidates(
    candidates: list[dict],
    *,
    hub_id: str,
    seed_source_ids: list[str],
    search_metadata: dict,
) -> list[dict]:
    normalized: list[dict] = []
    for candidate in candidates:
        row = _normalize_source_suggestion_candidate(
            candidate,
            hub_id=hub_id,
            seed_source_ids=seed_source_ids,
            search_metadata=search_metadata,
        )
        if row is not None:
            normalized.append(row)
    return normalized


# Validates and reshapes a single discovered suggestion candidate.
def _normalize_source_suggestion_candidate(
    candidate: dict,
    *,
    hub_id: str,
    seed_source_ids: list[str],
    search_metadata: dict,
) -> Optional[dict]:
    # Normalize discovered candidates into one stored shape so later duplicate
    # checks only need canonical URL or canonical YouTube id comparisons.
    raw_url = str(candidate.get("url") or "").strip()
    if not raw_url:
        return None

    try:
        safe_url = _web._validate_public_url(raw_url)
    except Exception:
        return None

    suggested_type = str(candidate.get("type") or "web").strip().lower()
    video_id = _youtube.extract_youtube_video_id(safe_url)
    if suggested_type == "youtube" or video_id:
        if not video_id:
            return None
        return {
            "hub_id": hub_id,
            "type": "youtube",
            "status": "pending",
            "url": _youtube._canonicalize_youtube_url(video_id),
            "canonical_url": None,
            "video_id": video_id,
            "title": _trim_source_suggestion_text(candidate.get("title"), 255),
            "description": _trim_source_suggestion_text(candidate.get("description"), 1000),
            "rationale": _trim_source_suggestion_text(candidate.get("rationale"), 1000),
            "confidence": _coerce_confidence(candidate.get("confidence")),
            "seed_source_ids": seed_source_ids,
            "search_metadata": search_metadata,
        }

    canonical_url = _web.canonicalize_web_url(safe_url)
    if suggested_type != "web" or not canonical_url:
        return None
    return {
        "hub_id": hub_id,
        "type": "web",
        "status": "pending",
        "url": safe_url,
        "canonical_url": canonical_url,
        "video_id": None,
        "title": _trim_source_suggestion_text(candidate.get("title"), 255),
        "description": _trim_source_suggestion_text(candidate.get("description"), 1000),
        "rationale": _trim_source_suggestion_text(candidate.get("rationale"), 1000),
        "confidence": _coerce_confidence(candidate.get("confidence")),
        "seed_source_ids": seed_source_ids,
        "search_metadata": search_metadata,
    }


# Loads existing suggestion targets so duplicates can be skipped.
def _load_existing_source_suggestion_targets(client: Client, hub_id: str) -> set[tuple[str, str]]:
    rows = client.table("source_suggestions").select("type,canonical_url,video_id").eq("hub_id", hub_id).execute().data or []
    targets: set[tuple[str, str]] = set()
    for row in rows:
        key = _source_suggestion_target_key(row)
        if key is not None:
            targets.add(key)
    return targets


# Loads existing source targets so already-added content is not suggested again.
def _load_existing_source_targets(client: Client, hub_id: str) -> set[tuple[str, str]]:
    rows = client.table("sources").select("type,ingestion_metadata").eq("hub_id", hub_id).execute().data or []
    targets: set[tuple[str, str]] = set()
    for row in rows:
        source_type = str(row.get("type") or "")
        metadata = row.get("ingestion_metadata") if isinstance(row.get("ingestion_metadata"), dict) else {}
        if source_type == "youtube":
            video_id = str(metadata.get("video_id") or "")
            if not video_id:
                video_id = _youtube.extract_youtube_video_id(str(metadata.get("url") or ""))
            if video_id:
                targets.add(("youtube", video_id))
        elif source_type == "web":
            canonical_url = _web.canonicalize_web_url(str(metadata.get("final_url") or metadata.get("url") or ""))
            if canonical_url:
                targets.add(("web", canonical_url))
    return targets


# Deduplicates and caps candidate suggestions before insertion.
def _filter_new_source_suggestions(
    candidates: list[dict],
    *,
    existing_source_targets: set[tuple[str, str]],
    existing_suggestion_targets: set[tuple[str, str]],
    limit: int,
) -> list[dict]:
    # If the first pass fills every slot with web pages, pull one YouTube result
    # forward when available so suggestion sets stay mixed and more useful.
    deduped: list[dict] = []
    seen_targets = set(existing_source_targets) | set(existing_suggestion_targets)
    for candidate in candidates:
        key = _source_suggestion_target_key(candidate)
        if key is None or key in seen_targets:
            continue
        seen_targets.add(key)
        deduped.append(candidate)

    max_items = max(1, limit)
    accepted = deduped[:max_items]
    if not accepted:
        return []

    if any(str(candidate.get("type") or "").strip().lower() == "youtube" for candidate in accepted):
        return accepted

    youtube_candidate = next(
        (candidate for candidate in deduped[max_items:] if str(candidate.get("type") or "").strip().lower() == "youtube"),
        None,
    )
    if youtube_candidate is None:
        return accepted

    replacement_index = next(
        (index for index in range(len(accepted) - 1, -1, -1) if str(accepted[index].get("type") or "").strip().lower() != "youtube"),
        None,
    )
    if replacement_index is None:
        return accepted

    accepted[replacement_index] = youtube_candidate
    return accepted


# Builds a comparable key for a candidate's canonical target.
def _source_suggestion_target_key(candidate: dict) -> Optional[tuple[str, str]]:
    suggestion_type = str(candidate.get("type") or "").strip().lower()
    if suggestion_type == "youtube":
        video_id = str(candidate.get("video_id") or "").strip()
        if video_id:
            return ("youtube", video_id)
        return None
    if suggestion_type == "web":
        canonical_url = str(candidate.get("canonical_url") or "").strip()
        if canonical_url:
            return ("web", canonical_url)
    return None


# Updates the hub scan timestamp after a suggestion run finishes.
def _mark_source_suggestion_scan(client: Client, hub_id: str, *, now: datetime, generated: bool) -> None:
    payload = {"last_source_suggestion_scan_at": now.isoformat()}
    if generated:
        payload["last_source_suggestion_generated_at"] = now.isoformat()
    client.table("hubs").update(payload).eq("id", hub_id).execute()

# Trims optional suggestion text fields to a safe maximum length.
def _trim_source_suggestion_text(value: object, max_chars: int) -> Optional[str]:
    cleaned = _common._normalize_text(str(value or ""))
    if not cleaned:
        return None
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars].rstrip()}..."


# Converts a suggestion confidence value into a bounded float.
def _coerce_confidence(value: object) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.5
    return max(0.0, min(1.0, confidence))


# Parses the LLM output into a list of candidate suggestion objects.
def _parse_source_suggestion_candidates(raw: str) -> list[dict]:
    text = (raw or "").strip()
    if not text:
        return []
    if text.startswith("```"):
        lines = [line for line in text.splitlines() if not line.startswith("```")]
        text = "\n".join(lines).strip()

    candidates_to_try = [text]
    if "[" in text and "]" in text:
        candidates_to_try.append(text[text.find("[") : text.rfind("]") + 1])

    for candidate_text in candidates_to_try:
        try:
            parsed = json.loads(candidate_text)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            parsed = parsed.get("candidates")
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
    return []

# Reminder dispatch tasks and notification helpers.
# Dispatches due reminders and records any notification updates that result.
@celery_app.task(name="dispatch_reminders")
def dispatch_reminders() -> dict:
    client = _common._get_supabase_client()
    now = datetime.now(timezone.utc)
    lead_hours = max(1, settings.reminder_lead_hours)
    window = max(1, settings.reminder_dispatch_window_minutes)
    lead_start = now + timedelta(hours=lead_hours) - timedelta(minutes=window)
    lead_end = now + timedelta(hours=lead_hours) + timedelta(minutes=window)

    # Fetch both upcoming lead reminders and already-due reminders in the same run.
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
        # Mark the reminder as sent only after the due notification path has been processed.
        _mark_reminder_sent(client, reminder["id"], now)

    return {"notifications_sent": sent}


# Processes one reminder record and sends notifications through the enabled channels.
def _dispatch_for_reminder(
    client: Client,
    reminder: dict,
    kind: str,
    now: datetime,
    hub_policy_cache: dict[str, dict],
) -> int:
    hub_id = reminder.get("hub_id")
    if not hub_id:
        return 0
    policy = _get_hub_policy(client, hub_id, hub_policy_cache)
    channels = _normalize_channels(policy.get("channels"))
    if not channels:
        return 0
    due_at = _common._parse_iso(reminder.get("due_at"))
    if not due_at:
        return 0
    scheduled_for = due_at
    if kind == "lead":
        if "notify_before" in reminder and reminder["notify_before"] is None:
            return 0  # User explicitly chose no notification
        notify_before = reminder.get("notify_before")
        if notify_before is not None:
            scheduled_for = due_at - timedelta(minutes=notify_before)
        else:
            lead_hours = int(policy.get("lead_hours") or settings.reminder_lead_hours)
            scheduled_for = due_at - timedelta(hours=lead_hours)
    sent = 0
    for channel in channels:
        if _create_notification_if_needed(
            client, reminder, channel, kind, scheduled_for, now
        ):
            sent += 1
    return sent


# Creates a reminder notification unless one already exists for the same dispatch window.
def _create_notification_if_needed(
    client: Client,
    reminder: dict,
    channel: str,
    kind: str,
    scheduled_for: datetime,
    now: datetime,
) -> bool:
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



# Updates an existing reminder notification with the latest dispatch outcome.
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


# Marks a reminder as sent after its dispatch completes successfully.
def _mark_reminder_sent(client: Client, reminder_id: str, now: datetime) -> None:
    client.table("reminders").update({"status": "sent", "sent_at": now.isoformat()}).eq("id", reminder_id).execute()

# Loads and caches reminder policy settings for a hub.
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


# Normalizes a channel list into lowercase unique values.
def _normalize_channels(value: Optional[list]) -> list[str]:
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




