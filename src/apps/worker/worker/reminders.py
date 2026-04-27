"""Reminder candidate detection and date-parsing helpers."""

import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

import dateparser
import spacy
from supabase import Client

from . import common as _common
from .app import logger, settings

# Cap reminder scanning to a deterministic amount of source text per ingest.
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
        _NLP = spacy.load("en_core_web_sm")
    except Exception:
        _NLP = None
    return _NLP


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
        parsed = parsed.replace(hour=9, minute=0, second=0, microsecond=0)
    return parsed.astimezone(timezone.utc)


def _safe_zoneinfo(name: str) -> Optional[ZoneInfo]:
    try:
        return ZoneInfo(name)
    except Exception:
        return None


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


def _build_title(snippet: str) -> str:
    cleaned = snippet.strip()
    if len(cleaned) <= 80:
        return cleaned
    return f"{cleaned[:77].rstrip()}..."


def _hash_snippet(snippet: str) -> str:
    return hashlib.sha256(snippet.lower().encode("utf-8")).hexdigest()


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


def _has_keyword(snippet: str) -> bool:
    lowered = snippet.lower()
    return any(keyword in lowered for keyword in DATE_KEYWORDS)


def _has_time(text: str) -> bool:
    return bool(DATE_TIME_RE.search(text))


def _has_keyword_near(text: str, start: int, end: int, window: int = 120) -> bool:
    if start < 0 or end < 0:
        return False
    win_start = max(0, start - window)
    win_end = min(len(text), end + window)
    return _has_keyword(text[win_start:win_end])


def _looks_relative(date_text: str) -> bool:
    value = date_text.strip().lower()
    return bool(
        re.search(
            r"\b(next|tomorrow|today|tonight|this|within|in\s+\d+|end of|end-of|after)\b",
            value,
        )
    )


def _is_time_only(date_text: str) -> bool:
    return bool(TIME_ONLY_RE.match(date_text.strip()))


def _is_week_reference(date_text: str) -> bool:
    return bool(re.search(r"\b(?:week|wk)\s*\d{1,2}\b", date_text.strip().lower()))


def _is_day_only(date_text: str) -> bool:
    return bool(re.fullmatch(r"\d{1,2}(st|nd|rd|th)?", date_text.strip(), re.IGNORECASE))


def _is_numeric_date(date_text: str) -> bool:
    value = date_text.strip()
    if re.search(r"[a-zA-Z]", value):
        return False
    return bool(re.search(r"[/-]", value)) or value.isdigit()


def _is_numeric_only(date_text: str) -> bool:
    return bool(re.fullmatch(r"\d+", date_text.strip()))


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


def _normalize_numeric_range_end(start_text: str, end_text: str) -> Optional[str]:
    start_parts = re.split(r"[/-]", start_text)
    end_parts = re.split(r"[/-]", end_text)
    if len(end_parts) == 2 and len(start_parts) >= 3:
        return f"{end_parts[0]}/{end_parts[1]}/{start_parts[2]}"
    if len(end_parts) >= 2:
        return "/".join(end_parts)
    return None


def _is_repeated_date(text: str, date_text: str) -> bool:
    needle = date_text.strip().lower()
    if len(needle) < 4:
        return False
    return text.lower().count(needle) >= 3


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


__all__ = [
    "_detect_and_store_reminders",
    "_find_date_candidates",
]
