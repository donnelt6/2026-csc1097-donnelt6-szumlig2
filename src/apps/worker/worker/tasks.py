import hashlib
import io
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, List, Optional
from urllib.parse import quote
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
    _update_source(client, source_id, status="processing")

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

        chunks = _chunk_text(text, settings.chunk_size, settings.chunk_overlap)
        if not chunks:
            raise ValueError("No chunks produced from extracted text")

        embeddings = _embed_chunks(chunks)
        _insert_chunks(client, source_id, hub_id, chunks, embeddings)

        metadata = {
            "chunk_count": len(chunks),
            "embedding_model": settings.embedding_model,
            "chunk_size": settings.chunk_size,
            "chunk_overlap": settings.chunk_overlap,
        }
        _update_source(client, source_id, status="complete", ingestion_metadata=metadata)
        try:
            _detect_and_store_reminders(client, source_id, hub_id, text)
        except Exception:
            logger.exception("Reminder detection failed for source %s", source_id)
        logger.info("Completed ingestion for source %s", source_id)
        return {"source_id": source_id, "hub_id": hub_id, "chunks": len(chunks)}
    except Exception as exc:
        logger.exception("Ingestion failed for source %s", source_id)
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


def _insert_chunks(client: Client, source_id: str, hub_id: str, chunks: List[str], embeddings: List[List[float]]) -> None:
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
            }
        )
    for batch in _batch(rows, 100):
        client.table("source_chunks").insert(batch).execute()


def _update_source(
    client: Client,
    source_id: str,
    status: str,
    failure_reason: Optional[str] = None,
    ingestion_metadata: Optional[dict] = None,
) -> None:
    # Only include optional fields when present to avoid overwriting.
    payload: dict = {"status": status}
    if failure_reason is not None:
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
MIN_CONFIDENCE = 0.55
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
)
DATE_TIME_RE = re.compile(r"\b(\d{1,2}:\d{2}\b|\d{1,2}\s*(am|pm)\b)", re.IGNORECASE)
SENTENCE_BOUNDARY_RE = re.compile(r"[.!?]")
MONTH_PATTERN = (
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
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
    return candidates


def _collect_date_mentions(text: str) -> List[dict]:
    # Combine regex matches with spaCy DATE entities.
    mentions: List[dict] = []
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
    if method == "ner":
        score += 0.25
    if _has_keyword(snippet):
        score += 0.2
    if _has_time(date_text):
        score += 0.1
    if _is_ambiguous_numeric(date_text):
        score -= 0.1
    return max(0.0, min(0.95, score))


def _has_keyword(snippet: str) -> bool:
    lowered = snippet.lower()
    return any(keyword in lowered for keyword in DATE_KEYWORDS)


def _has_time(text: str) -> bool:
    return bool(DATE_TIME_RE.search(text))


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
    matches = list(DATE_TIME_RE.finditer(window_text))
    if not matches:
        return None
    mention_center = (start + end) / 2
    best = None
    best_distance = None
    for match in matches:
        match_center = win_start + (match.start() + match.end()) / 2
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
