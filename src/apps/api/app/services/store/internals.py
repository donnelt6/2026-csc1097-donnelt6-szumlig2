"""store.py: Central service layer for Supabase access, retrieval logic, and AI-backed API features."""

import json
import logging
import math
import random
import re
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import PurePath
from urllib.parse import parse_qs, urlparse, urlunparse
from typing import Any, Dict, List, Optional, Tuple

import httpx
from openai import OpenAI
from postgrest.exceptions import APIError
from supabase import Client, create_client

from ...core.config import get_settings
from ...schemas import (
    ApplyRevisionRequest,
    AnalyticsTopSource,
    AssignableMembershipRole,
    ChatAnalyticsSummary,
    ChatAnalyticsTrendPoint,
    ChatAnalyticsTrends,
    ChatEventCreate,
    ChatEventResponse,
    ChatEventType,
    ChatFeedbackRequest,
    ChatFeedbackResponse,
    ChatFeedbackRating,
    ChatRequest,
    ChatResponse,
    ChatSearchResult,
    ChatSessionDetail,
    ChatSessionSummary,
    Citation,
    CitationFeedbackEventType,
    CitationFeedbackRequest,
    CitationFeedbackResponse,
    CreateRevisionRequest,
    DEFAULT_HUB_COLOR_KEY,
    DEFAULT_HUB_ICON_KEY,
    FaqEntry,
    FaqGenerateRequest,
    FlagCase,
    FlagCaseStatus,
    FlagMessageRequest,
    FlagMessageResponse,
    FlaggedChatDetail,
    FlaggedChatQueueItem,
    HistoryMessage,
    GuideEntry,
    GuideGenerateRequest,
    GuideStep,
    GuideStepCreateRequest,
    GuideStepProgressUpdate,
    GuideStepWithProgress,
    HUB_COLOR_KEYS,
    HUB_ICON_KEYS,
    Hub,
    HubCreate,
    HubUpdate,
    HubInviteRequest,
    HubMember,
    HubScope,
    MessageFlagStatus,
    MessageRevision,
    MessageRevisionType,
    MembershipRole,
    NotificationEvent,
    Reminder,
    ReminderCandidate,
    ReminderCandidateDecision,
    ReminderCreate,
    ReminderStatus,
    ReminderSummary,
    Source,
    SourceCreate,
    SourceSuggestion,
    SourceSuggestionDecision,
    SourceSuggestionStatus,
    SourceSuggestionType,
    SourceStatus,
    SourceStatusResponse,
    SourceType,
    UserProfileSummary,
    WebSourceCreate,
    YouTubeSourceCreate,
    SessionMessage,
    ActivityEvent,
)
from ..tracing import ChatTraceRecorder

logger = logging.getLogger(__name__)


# Store exceptions and primary store implementation.
class ConflictError(RuntimeError):
    """Raised when a conditional update loses a concurrency race."""


class SupabaseStore:
    """Supabase-backed store for hubs, sources, and chat."""

    # Load configuration and initialise shared clients used across the API.
    # Initialize the object with the required settings and clients.
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_role_key or not settings.supabase_anon_key:
            raise RuntimeError(
                "Supabase credentials missing. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY."
            )
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is missing. Add it to apps/api/.env.")
        self.supabase_url = settings.supabase_url
        self.supabase_anon_key = settings.supabase_anon_key
        self.storage_bucket = settings.supabase_storage_bucket
        self.embedding_model = settings.embedding_model
        self.chat_model = settings.chat_model
        self.top_k = settings.top_k
        self.min_similarity = settings.min_similarity
        self.max_citations = settings.max_citations
        self.chat_rewrite_enabled = settings.chat_rewrite_enabled
        self.chat_rewrite_history_messages = settings.chat_rewrite_history_messages
        self.retrieval_candidate_pool = max(settings.top_k, settings.retrieval_candidate_pool)
        self.retrieval_mmr_lambda = settings.retrieval_mmr_lambda
        self.retrieval_same_source_penalty = settings.retrieval_same_source_penalty
        self.chat_rerank_relative_cutoff = settings.chat_rerank_relative_cutoff
        self.chat_diversity_confidence_gap = settings.chat_diversity_confidence_gap
        self.faq_default_count = settings.faq_default_count
        self.faq_context_chunks_per_source = settings.faq_context_chunks_per_source
        self.faq_max_citations = settings.faq_max_citations
        self.faq_min_similarity = settings.faq_min_similarity
        self.guide_default_steps = settings.guide_default_steps
        self.guide_context_chunks_per_source = settings.guide_context_chunks_per_source
        self.guide_max_citations = settings.guide_max_citations
        self.guide_min_similarity = settings.guide_min_similarity
        self.analytics_summary_days = settings.analytics_summary_days
        self.analytics_trend_days = settings.analytics_trend_days
        self.service_client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        self.llm_client = OpenAI(api_key=settings.openai_api_key)

    # Chat-facing retrieval and answer generation now live in chat.py.
    # Embed query.
    def _embed_query(self, text: str) -> List[float]:
        response = self.llm_client.embeddings.create(model=self.embedding_model, input=text)
        return response.data[0].embedding

    # Match chunks.
    def _match_chunks(
        self,
        client: Client,
        hub_id: str,
        embedding: List[float],
        top_k: int,
        source_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        response = client.rpc(
            "match_source_chunks",
            {
                "query_embedding": embedding,
                "match_count": top_k,
                "match_hub": str(hub_id),
                "match_sources": source_ids,
            },
        ).execute()
        return response.data or []

    # Fetch source context.
    def _fetch_source_context(
        self,
        client: Client,
        hub_id: str,
        source_id: str,
        limit: int,
    ) -> List[dict]:
        response = (
            client.table("source_chunks")
            .select("source_id, chunk_index, text")
            .eq("hub_id", str(hub_id))
            .eq("source_id", str(source_id))
            .order("chunk_index")
            .limit(limit)
            .execute()
        )
        return response.data or []

# Shared store instance used by routers and dependencies.
_VAGUE_FOLLOW_UP_PHRASES = {
    "tell me more",
    "more",
    "go on",
    "continue",
    "explain that",
    "expand on that",
    "what about that",
    "what about this",
    "elaborate",
}
_DEICTIC_TOKENS = {"that", "this", "it", "those", "these", "there", "here"}
_FOLLOW_UP_LEAD_TOKENS = {
    "why",
    "how",
    "what",
    "where",
    "when",
    "which",
    "who",
    "is",
    "are",
    "was",
    "were",
    "do",
    "does",
    "did",
    "can",
    "could",
    "would",
    "should",
    "will",
    "have",
    "has",
    "had",
}
_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._ -]")


# Standalone helper functions used throughout the store module.

# Sanitize a filename so it is safe to use in storage paths.
# Sanitize filename.
def _sanitize_filename(name: str) -> str:
    base = PurePath(name).name.strip()
    base = _FILENAME_SAFE_RE.sub("_", base)
    base = base.strip(" ._-")
    if not base:
        raise ValueError("Invalid file name.")
    if len(base) > 255:
        base = base[:255]
    return base


# Helper for web storage path.
def _web_storage_path(hub_id: str, source_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{hub_id}/{source_id}/web-{stamp}.md"


# Helper for youtube storage path.
def _youtube_storage_path(hub_id: str, source_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{hub_id}/{source_id}/youtube-{stamp}.md"


# Build readable default names for web and YouTube sources.
# Build web source name.
def _build_web_source_name(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc or parsed.path or url
    display = host.strip()
    if parsed.path and parsed.path not in {"/", ""}:
        display = f"{display}{parsed.path}"
    if parsed.query:
        display = f"{display}?{parsed.query}"
    return display[:255]


# Build youtube source name.
def _build_youtube_source_name(url: str, video_id: str) -> str:
    parsed = urlparse(url)
    host = (parsed.netloc or "youtube.com").lower()
    if host.startswith("www."):
        host = host[4:]
    display = f"{host}/{video_id}"
    return display[:255]


_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
# URL parsing and normalisation helpers.
# Extract youtube video id.
def _extract_youtube_video_id(url: str) -> Optional[str]:
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




# Normalize youtube id.
def _normalize_youtube_id(value: str) -> Optional[str]:
    if not value:
        return None
    candidate = value.strip()
    if not _YOUTUBE_ID_RE.fullmatch(candidate):
        return None
    return candidate


# Canonicalize web url.
def _canonicalize_web_url(url: str) -> Optional[str]:
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


# Text cleanup and parsing helpers.
# Trim text.
def _trim_text(text: str, max_chars: int) -> str:
    cleaned = " ".join((text or "").split()).strip()
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars].rstrip()}..."


# Normalize chat session title.
def _normalize_chat_session_title(text: str) -> str:
    collapsed = " ".join((text or "").split()).strip().strip("\"'`")
    collapsed = re.sub(r"^[Tt]itle\s*:\s*", "", collapsed)
    collapsed = re.sub(r"[\r\n]+", " ", collapsed)
    collapsed = re.sub(r"[^\w\s/&+-]", "", collapsed)
    collapsed = re.sub(r"\s+", " ", collapsed).strip()
    if not collapsed:
        return ""
    words = collapsed.split()
    if len(words) > 5:
        words = words[:5]
    normalized = " ".join(words)
    return normalized[:80].strip() or ""


# Build a fallback chat session title.
def _fallback_chat_session_title(text: str) -> str:
    collapsed = " ".join((text or "").split()).strip()
    if not collapsed:
        return "New Chat"
    words = collapsed.split()[:5]
    normalized = " ".join(words)
    return normalized[:80].strip() or "New Chat"


# Parse questions from text.
def _parse_questions_from_text(raw: str, max_count: int) -> List[str]:
    if not raw:
        return []
    text = raw.strip()
    candidates: List[str] = []
    seen: set[str] = set()

    # Helper to add parsed items to the result list.
    def _add(items: List[str]) -> None:
        for item in items:
            cleaned = str(item).strip().strip('"').strip("'")
            if not cleaned:
                continue
            if not cleaned.endswith("?"):
                cleaned = cleaned.rstrip(".")
                cleaned = f"{cleaned}?"
            key = cleaned.lower()
            if key in seen:
                continue
            seen.add(key)
            candidates.append(cleaned)
            if len(candidates) >= max_count:
                break

    # Helper to parse a JSON array when the model returns one.
    def _load_json_array(value: str) -> Optional[List[str]]:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
        return None

    parsed = _load_json_array(text)
    if parsed is None:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1 and end > start:
            parsed = _load_json_array(text[start : end + 1])

    if parsed is not None:
        _add(parsed)
        return candidates

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    cleaned_lines: List[str] = []
    for line in lines:
        cleaned = re.sub(r"^[\-\*\d\.\)\s]+", "", line).strip()
        if cleaned:
            cleaned_lines.append(cleaned)
    _add(cleaned_lines)
    return candidates


# Parse steps from text.
def _parse_steps_from_text(raw: str, max_count: int) -> List[Dict[str, str]]:
    if not raw:
        return []
    text = raw.strip()
    steps: List[Dict[str, str]] = []

    # Helper to normalize one parsed text value.
    def _clean(value: str) -> str:
        cleaned = re.sub(r"^[\-\*\d\.\)\s]+", "", value or "").strip()
        return cleaned

    # Helper to add one parsed step to the result list.
    def _add_step(title: Optional[str], instruction: str) -> None:
        if len(steps) >= max_count:
            return
        cleaned_instruction = _clean(instruction)
        if not cleaned_instruction:
            return
        cleaned_title = _clean(title or "")
        steps.append(
            {
                "title": cleaned_title if cleaned_title else "",
                "instruction": cleaned_instruction,
            }
        )

    # Helper to parse a JSON array when the model returns one.
    def _load_json_array(value: str) -> Optional[List[Any]]:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        if isinstance(parsed, list):
            return parsed
        return None

    parsed = _load_json_array(text)
    if parsed is None:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1 and end > start:
            parsed = _load_json_array(text[start : end + 1])

    if parsed is not None:
        for item in parsed:
            if len(steps) >= max_count:
                break
            if isinstance(item, dict):
                title = item.get("title") or item.get("name") or ""
                instruction = item.get("instruction") or item.get("step") or item.get("text") or ""
                _add_step(title, str(instruction))
            else:
                _add_step("", str(item))
        return steps

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if len(steps) >= max_count:
            break
        _add_step("", line)
    return steps


# Citation extraction and grounding helpers.
class _QuotePair:
    """A paraphrase + approximate direct quote pair from the LLM."""

    __slots__ = ("paraphrase", "quote")

    # Initialize the object with the required settings and clients.
    def __init__(self, paraphrase: str, quote: str) -> None:
        self.paraphrase = paraphrase
        self.quote = quote


# Extract the answer text and trailing quote payload from the model output.
def _extract_quotes(raw_answer: str) -> tuple[str, Dict[str, List[_QuotePair]]]:
    """Split the QUOTES: JSON block from the answer.

    Supports both the new paired format (objects with paraphrase+quote)
    and the legacy format (plain string arrays) for backwards compatibility.
    """
    marker = "QUOTES:"
    idx = raw_answer.rfind(marker)
    if idx == -1:
        return raw_answer.strip(), {}
    answer = raw_answer[:idx].strip()
    json_part = raw_answer[idx + len(marker) :].strip()
    try:
        quotes = json.loads(json_part)
        if isinstance(quotes, dict):
            result: Dict[str, List[_QuotePair]] = {}
            for k, v in quotes.items():
                pairs: List[_QuotePair] = []
                items = v if isinstance(v, list) else [v]
                for item in items:
                    if isinstance(item, dict):
                        paraphrase = str(item.get("paraphrase") or "").strip()
                        quote = str(item.get("quote") or "").strip()
                        if quote:
                            pairs.append(_QuotePair(paraphrase=paraphrase, quote=quote))
                    elif isinstance(item, str):
                        # Legacy format: plain string treated as quote only
                        if item.strip():
                            pairs.append(_QuotePair(paraphrase="", quote=item.strip()))
                if pairs:
                    result[str(k)] = pairs
            return answer, result
    except (json.JSONDecodeError, ValueError):
        pass
    return answer, {}


# Match quote pairs back to the most relevant snippet regions.
def _match_quote_pairs_to_snippet(
    pairs: list,
    snippet: str,
    threshold: float = 0.45,
) -> list[tuple[str, str]]:
    """Match all quote pairs to distinct regions of the snippet simultaneously.

    Instead of greedily assigning one quote at a time (where an early quote can
    steal the best region from a later quote), this finds the top candidate
    regions for every quote, then picks the global assignment that maximises
    total score with no overlapping regions.

    Returns list of (matched_snippet_text, paraphrase) in the original pair order.
    """
    snippet_lower = snippet.lower()
    s_words = snippet_lower.split()
    if not s_words:
        return []

    _stop = frozenset(
        "a an the is are was were be been being have has had do does did "
        "will would could should may might shall can to of in for on with "
        "at by from it its this that and or but not no if so as than you "
        "your he she they them their we our".split()
    )

    # Pre-compute word char offsets once
    word_starts: list[int] = []
    word_ends: list[int] = []
    pos = 0
    for w in s_words:
        idx = snippet_lower.index(w, pos)
        word_starts.append(idx)
        word_ends.append(idx + len(w))
        pos = idx + len(w)

    # For each pair, find top-k candidate regions (scored)
    # Each candidate: (score, char_start, char_end, snippet_text)
    _Candidate = tuple  # (score, char_start, char_end, text)
    all_candidates: list[list[_Candidate]] = []

    for pair in pairs:
        q = (pair.quote or "").strip()
        if not q:
            all_candidates.append([])
            continue

        candidates: list[_Candidate] = []

        # Try exact match first — gets score 1.0
        q_lower = q.lower()
        search_pos = 0
        while search_pos < len(snippet_lower):
            idx = snippet_lower.find(q_lower, search_pos)
            if idx == -1:
                break
            candidates.append((1.0, idx, idx + len(q_lower), q))
            search_pos = idx + 1

        # Fuzzy candidates via sliding window
        q_words_list = q.lower().split()
        if len(q_words_list) >= 3:
            q_content = {w for w in q_words_list if w not in _stop}
            if len(q_content) < 2:
                q_content = set(q_words_list)

            min_win = max(3, len(q_words_list) // 2)
            max_win = min(len(s_words), len(q_words_list) * 4)

            scored_windows: list[tuple[float, int, int]] = []
            for win_size in range(min_win, max_win + 1, max(1, (max_win - min_win) // 8)):
                for start in range(0, len(s_words) - win_size + 1, max(1, win_size // 5)):
                    window_content = {w for w in s_words[start : start + win_size] if w not in _stop}
                    overlap = len(q_content & window_content)
                    recall = overlap / len(q_content)
                    precision = overlap / max(len(window_content), 1)
                    score = recall * 0.7 + precision * 0.3
                    if score >= threshold:
                        scored_windows.append((score, start, start + win_size))

            # Keep top 5 fuzzy candidates to limit search space
            scored_windows.sort(key=lambda x: x[0], reverse=True)
            for score, ws, we in scored_windows[:5]:
                cs = word_starts[ws]
                ce = word_ends[min(we - 1, len(word_ends) - 1)]
                candidates.append((score, cs, ce, snippet[cs:ce]))

        all_candidates.append(candidates)

    # Greedy-by-best-score global assignment: sort ALL candidates across
    # all pairs by score descending, assign each to its pair if the region
    # hasn't been claimed yet.
    # This ensures the highest-confidence matches get their preferred region
    # before weaker matches.
    assignment: dict[int, _Candidate] = {}
    claimed_ranges: list[tuple[int, int]] = []

    # Build flat list: (score, pair_index, candidate)
    flat: list[tuple[float, int, _Candidate]] = []
    for pair_idx, cands in enumerate(all_candidates):
        for cand in cands:
            flat.append((cand[0], pair_idx, cand))
    flat.sort(key=lambda x: x[0], reverse=True)

    for _score, pair_idx, cand in flat:
        if pair_idx in assignment:
            continue
        c_start, c_end = cand[1], cand[2]
        # Check overlap with already-claimed regions
        overlaps = False
        for cs, ce in claimed_ranges:
            if c_start < ce and c_end > cs:
                overlaps = True
                break
        if not overlaps:
            assignment[pair_idx] = cand
            claimed_ranges.append((c_start, c_end))
        if len(assignment) == len(pairs):
            break

    # Build result in original order
    result: list[tuple[str, str]] = []
    for i, pair in enumerate(pairs):
        if i in assignment:
            matched_text = assignment[i][3]
            paraphrase = (pair.paraphrase or matched_text).strip()
            result.append((matched_text, paraphrase))
    return result


# Check or answer has citation.
def _answer_has_citation(answer: str, max_index: int) -> bool:
    if not answer:
        return False
    for match in re.findall(r"\[(\d+)\]", answer):
        try:
            idx = int(match)
        except ValueError:
            continue
        if 1 <= idx <= max_index:
            return True
    return False


# Check whether like grounded answer.
def _looks_like_grounded_answer(answer: str) -> bool:
    cleaned = re.sub(r"\s+", " ", (answer or "")).strip()
    if not cleaned:
        return False
    lowered = cleaned.lower()
    abstention_markers = [
        "don't have enough information",
        "do not have enough information",
        "not enough information",
        "insufficient information",
        "cannot determine",
        "can't determine",
    ]
    return not any(marker in lowered for marker in abstention_markers)


# Helper for referenced citation indices.
def _referenced_citation_indices(answer: str, max_index: int) -> List[int]:
    if not answer or max_index <= 0:
        return []
    indices: List[int] = []
    seen: set[int] = set()
    for match in re.findall(r"\[(\d+)\]", answer):
        try:
            idx = int(match)
        except ValueError:
            continue
        if 1 <= idx <= max_index and idx not in seen:
            seen.add(idx)
            indices.append(idx)
    return indices


# Chat query and history helpers.
# Check whether exploratory chat question.
def _is_exploratory_chat_question(question: str) -> bool:
    normalized = re.sub(r"\s+", " ", (question or "").strip().lower())
    if not normalized:
        return False
    exploratory_markers = [
        "compare",
        "difference",
        "differences",
        "across",
        "versus",
        "vs",
        "overview",
        "summarize",
        "summary",
        "options",
        "pros and cons",
    ]
    return any(marker in normalized for marker in exploratory_markers)


# Check whether vague follow up.
def _is_vague_follow_up(question: str) -> bool:
    normalized = re.sub(r"\s+", " ", (question or "").strip().lower())
    if not normalized:
        return False
    if normalized in _VAGUE_FOLLOW_UP_PHRASES:
        return True
    tokens = re.findall(r"\b[\w']+\b", normalized)
    if not tokens:
        return False
    if len(tokens) <= 4 and any(token in _DEICTIC_TOKENS for token in tokens):
        return True
    return tokens[0] in _FOLLOW_UP_LEAD_TOKENS and _has_context_reference(tokens)


# Helper for most recent informative user turn.
def _most_recent_informative_user_turn(history: List[Dict[str, Any]]) -> Optional[str]:
    for message in reversed(history):
        if str(message.get("role") or "") != "user":
            continue
        content = str(message.get("content") or "").strip()
        if content and not _is_vague_follow_up(content):
            return content
    return None


# Helper for history has multi source grounding.
def _history_has_multi_source_grounding(history: List[Dict[str, Any]]) -> bool:
    grounded_sources: set[str] = set()
    for message in history:
        if str(message.get("role") or "") != "assistant":
            continue
        for citation in message.get("citations") or []:
            if isinstance(citation, dict):
                source_id = str(citation.get("source_id") or "").strip()
            else:
                source_id = str(getattr(citation, "source_id", "") or "").strip()
            if source_id:
                grounded_sources.add(source_id)
            if len(grounded_sources) >= 2:
                return True
    return False


# Count distinct citation sources.
def _count_distinct_citation_sources(citations: List[Any]) -> int:
    distinct_sources: set[str] = set()
    for citation in citations:
        if isinstance(citation, dict):
            source_id = str(citation.get("source_id") or "").strip()
        else:
            source_id = str(getattr(citation, "source_id", "") or "").strip()
        if source_id:
            distinct_sources.add(source_id)
    return len(distinct_sources)


# Check whether context reference.
def _has_context_reference(tokens: List[str]) -> bool:
    for index, token in enumerate(tokens):
        if token in {"that", "it", "those", "these"}:
            return True
        if token in {"there", "here"} and index == len(tokens) - 1:
            return True
        if token == "this" and index == len(tokens) - 1:
            return True
    return False


# Build anchored retrieval query.
def _build_anchored_retrieval_query(anchor_turn: str, query_suffix: str) -> str:
    anchor = (anchor_turn or "").strip()
    suffix = (query_suffix or "").strip()
    if not anchor:
        return suffix
    if not suffix:
        return anchor
    if anchor.lower() == suffix.lower():
        return anchor
    separator = "" if anchor.endswith((".", "?", "!")) else "."
    return f"{anchor}{separator} {suffix}".strip()


# Normalize retrieval query.
def _normalize_retrieval_query(original_question: str, rewritten_query: str) -> str:
    candidate = (rewritten_query or "").replace("\r", "\n").strip()
    if not candidate:
        return original_question

    candidate = candidate.splitlines()[0].strip()
    candidate = candidate.strip("`'\" ")
    if ":" in candidate:
        prefix, remainder = candidate.split(":", 1)
        if prefix.strip().lower() in {"query", "rewritten query", "search query"}:
            candidate = remainder.strip()
    candidate = re.sub(r"\[\d+\]", "", candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip()
    if not candidate or candidate.lower() in {"n/a", "none"}:
        return original_question
    return candidate


# Prompt, search, and ranking helpers.
# Return the main system prompt used for grounded hub answers.
def _hub_answer_system_prompt() -> str:
    return (
        "You are Caddie, an onboarding assistant. Answer using the provided context only. "
        "Do not infer or invent unstated dates, names, deadlines, policies, contacts, locations, or requirements. "
        "If the context is insufficient, say you don't have enough information. "
        "Every factual claim supported by the context must include an inline citation like [n] that matches the context list. "
        "Do not give an uncited factual answer. "
        "If the user sends small talk or a greeting, respond politely and ask how you can help.\n\n"
        "After your answer, on a new line, output QUOTES: followed by a JSON object.\n"
        "For each citation number you used, provide an array of objects with two fields:\n"
        '- "paraphrase": a short, clean summary of the point you are making (one sentence).\n'
        '- "quote": copy a passage from the context that supports the point. '
        "Copy it as closely as possible from the source text, even if messy or repetitive. "
        "It does not need to be exact but should contain enough key words to locate the region.\n"
        "Include all distinct pieces of information you used, not just one. Example:\n"
        'QUOTES: {"1": [{"paraphrase": "clean summary of point", "quote": "approximate passage from context 1"}], '
        '"3": [{"paraphrase": "another clean summary", "quote": "approximate passage from context 3"}]}'
    )


# Return the repair prompt used when an answer needs stricter grounding.
def _hub_answer_repair_prompt() -> str:
    return (
        "You are revising an onboarding answer to ensure strict grounding. "
        "Use the provided context only. Do not infer unstated facts. "
        "Every factual claim must include an inline citation like [n]. "
        "If you cannot support a claim with the provided context, say you don't have enough information instead of answering it. "
        "Return a corrected answer with citations, then on a new line output QUOTES: JSON in the same format as requested."
    )


# Build a preview of text.
def _preview_text(value: Any, limit: int = 140) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 1)].rstrip()}..."


# Escape ilike pattern.
def _escape_ilike_pattern(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# Build search snippet.
def _build_search_snippet(content: str, query: str, radius: int = 72) -> tuple[str, str | None]:
    collapsed = re.sub(r"\s+", " ", (content or "")).strip()
    normalized_query = re.sub(r"\s+", " ", (query or "")).strip()
    if not collapsed or not normalized_query:
        return "", None

    lower_content = collapsed.lower()
    lower_query = normalized_query.lower()
    index = lower_content.find(lower_query)
    if index == -1:
        words = [word for word in lower_query.split(" ") if word]
        index = next((lower_content.find(word) for word in words if lower_content.find(word) != -1), -1)
        if index == -1:
            return "", None
        matched_text = next((word for word in words if lower_content.find(word) == index), None)
    else:
        matched_text = collapsed[index:index + len(normalized_query)]

    start = max(0, index - radius)
    end = min(len(collapsed), index + len(matched_text or normalized_query) + radius)
    snippet = collapsed[start:end].strip()
    if start > 0:
        snippet = f"...{snippet}"
    if end < len(collapsed):
        snippet = f"{snippet}..."
    return snippet, matched_text


# Handle search score.
def _chat_search_score(session_title: str, snippet: str, matched_text: str, matched_role: str) -> int:
    haystack = f"{session_title} {snippet}".lower()
    needle = (matched_text or "").lower()
    if not haystack or not needle:
        return 0
    occurrences = haystack.count(needle)
    starts_sentence = 1 if needle and needle in haystack[: max(len(needle) + 16, 24)] else 0
    title_boost = 100 if matched_role == "title" else 0
    return title_boost + occurrences * 10 + starts_sentence


# Embedding and vector math helpers.
# Calculate the average similarity.
def _average_similarity(matches: List[Dict[str, Any]]) -> float:
    if not matches:
        return 0.0
    values = [float(match.get("similarity") or 0) for match in matches]
    return sum(values) / len(values)


# Normalize embedding value.
def _normalize_embedding_value(value: Any) -> Optional[List[float]]:
    vector = _coerce_embedding_value(value)
    if vector is None:
        return None
    return _normalize_vector(vector)


# Coerce embedding value.
def _coerce_embedding_value(value: Any) -> Optional[List[float]]:
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return None
        if isinstance(parsed, list):
            try:
                return [float(item) for item in parsed]
            except (TypeError, ValueError):
                return None
    return None


# Normalize vector.
def _normalize_vector(vector: Optional[List[float]]) -> Optional[List[float]]:
    if not vector:
        return None
    magnitude = math.sqrt(sum(value * value for value in vector))
    if magnitude <= 0:
        return None
    return [value / magnitude for value in vector]


# Helper for cosine similarity.
def _cosine_similarity(left: Optional[List[float]], right: Optional[List[float]]) -> float:
    if left is None or right is None or len(left) != len(right):
        return 0.0
    return sum(left_value * right_value for left_value, right_value in zip(left, right))


# General-purpose coercion and formatting helpers.
# Return attr.
def _get_attr(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


# Check whether missing hub optional column error.
def _is_missing_hub_optional_column_error(exc: APIError) -> bool:
    message = (getattr(exc, "message", "") or str(exc)).lower()
    if "column" not in message or "does not exist" not in message:
        return False
    return "icon_key" in message or "archived_at" in message


# Safely convert int.
def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


# Safely convert float.
def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


# Helper for iso day.
def _iso_day(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return datetime.now(timezone.utc).date().isoformat()


# Clamp window days.
def _clamp_window_days(value: int) -> int:
    return max(1, min(int(value), 90))


# Check whether uuid like.
def _is_uuid_like(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError, AttributeError):
        return False


# Calculate total tokens from usage.
def _total_tokens_from_usage(usage: Optional[Dict[str, Any]]) -> int:
    if not usage:
        return 0
    total = usage.get("total_tokens")
    if total is not None:
        return _safe_int(total)
    return _safe_int(usage.get("input_tokens")) + _safe_int(usage.get("output_tokens"))


# Extract response text.
def _extract_response_text(response: Any) -> str:
    text = _get_attr(response, "output_text")
    if isinstance(text, str) and text.strip():
        return text
    output = _get_attr(response, "output", []) or []
    for item in output:
        if _get_attr(item, "type") != "message":
            continue
        content = _get_attr(item, "content", [])
        if isinstance(content, list):
            for part in content:
                part_type = _get_attr(part, "type")
                if part_type in {"output_text", "text"}:
                    text = _get_attr(part, "text")
                    if isinstance(text, str) and text.strip():
                        return text
        text = _get_attr(item, "text")
        if isinstance(text, str) and text.strip():
            return text
    return ""


# Extract usage.
def _extract_usage(response: Any) -> Optional[dict]:
    usage = _get_attr(response, "usage")
    if usage is None:
        return None
    if isinstance(usage, dict):
        return usage
    dump = getattr(usage, "model_dump", None)
    if callable(dump):
        return dump()
    return None


# Extract web results.
def _extract_web_results(response: Any) -> list[Any]:
    output = _get_attr(response, "output", []) or []
    results: list[Any] = []
    for item in output:
        if _get_attr(item, "type") != "web_search_call":
            continue
        call = _get_attr(item, "web_search_call", item)
        call_results = _get_attr(call, "results", None)
        if call_results:
            results.extend(call_results)
    return results


# Format web snippet.
def _format_web_snippet(title: str, snippet: str, url: str) -> str:
    parts = []
    if title:
        parts.append(title)
    if snippet:
        parts.append(snippet)
    if url:
        parts.append(f"source: {url}")
    return " - ".join(parts)


# Build web citations.
def _build_web_citations(response: Any) -> List[Citation]:
    results = _extract_web_results(response)
    citations: List[Citation] = []
    for idx, result in enumerate(results, start=1):
        title = _get_attr(result, "title", "") or ""
        snippet = _get_attr(result, "snippet", "") or _get_attr(result, "content", "") or ""
        url = _get_attr(result, "url", "") or _get_attr(result, "link", "") or ""
        citation_id = url or f"web-{idx}"
        citations.append(Citation(source_id=citation_id, snippet=_format_web_snippet(title, snippet, url)))
    return citations
