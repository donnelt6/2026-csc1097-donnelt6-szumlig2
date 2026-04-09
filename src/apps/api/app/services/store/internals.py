"""Internal base store implementation plus helper re-exports for compatibility."""

import logging
import random
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from openai import OpenAI
from supabase import Client, create_client

from ...core.config import get_settings
from ...schemas import (
    ActivityEvent,
    AnalyticsTopSource,
    ApplyRevisionRequest,
    AssignableMembershipRole,
    ChatAnalyticsSummary,
    ChatAnalyticsTrendPoint,
    ChatAnalyticsTrends,
    ChatEventCreate,
    ChatEventResponse,
    ChatEventType,
    ChatFeedbackRequest,
    ChatFeedbackRating,
    ChatFeedbackResponse,
    ChatRequest,
    ChatResponse,
    ChatSearchResult,
    ChatSessionDetail,
    ChatSessionSummary,
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
    GuideEntry,
    GuideGenerateRequest,
    GuideStep,
    GuideStepCreateRequest,
    GuideStepProgressUpdate,
    GuideStepWithProgress,
    HUB_COLOR_KEYS,
    HUB_ICON_KEYS,
    HistoryMessage,
    Hub,
    HubCreate,
    HubInviteRequest,
    HubMember,
    HubScope,
    HubUpdate,
    MembershipRole,
    MessageFlagStatus,
    MessageRevision,
    MessageRevisionType,
    NotificationEvent,
    Reminder,
    ReminderCandidate,
    ReminderCandidateDecision,
    ReminderCreate,
    ReminderStatus,
    ReminderSummary,
    SessionMessage,
    Source,
    SourceCreate,
    SourceStatus,
    SourceStatusResponse,
    SourceSuggestion,
    SourceSuggestionDecision,
    SourceSuggestionStatus,
    SourceSuggestionType,
    SourceType,
    UserProfileSummary,
    WebSourceCreate,
    YouTubeSourceCreate,
)
from ..tracing import ChatTraceRecorder
from .chat_helpers import (
    _QuotePair,
    _answer_has_citation,
    _build_anchored_retrieval_query,
    _build_search_snippet,
    _chat_search_score,
    _count_distinct_citation_sources,
    _extract_quotes,
    _fallback_chat_session_title,
    _has_context_reference,
    _history_has_multi_source_grounding,
    _hub_answer_repair_prompt,
    _hub_answer_system_prompt,
    _is_exploratory_chat_question,
    _is_vague_follow_up,
    _looks_like_grounded_answer,
    _match_quote_pairs_to_snippet,
    _most_recent_informative_user_turn,
    _normalize_chat_session_title,
    _normalize_retrieval_query,
    _parse_questions_from_text,
    _parse_steps_from_text,
    _preview_text,
    _referenced_citation_indices,
)
from .common_helpers import (
    _average_similarity,
    _build_web_citations,
    _clamp_window_days,
    _coerce_embedding_value,
    _cosine_similarity,
    _escape_ilike_pattern,
    _extract_response_text,
    _extract_usage,
    _extract_web_results,
    _format_web_snippet,
    _get_attr,
    _is_missing_hub_optional_column_error,
    _is_uuid_like,
    _iso_day,
    _normalize_embedding_value,
    _normalize_vector,
    _safe_float,
    _safe_int,
    _total_tokens_from_usage,
)
from .source_helpers import (
    _build_web_source_name,
    _build_youtube_source_name,
    _canonicalize_web_url,
    _extract_youtube_video_id,
    _normalize_youtube_id,
    _sanitize_filename,
    _trim_text,
    _web_storage_path,
    _youtube_storage_path,
)

logger = logging.getLogger(__name__)


class ConflictError(RuntimeError):
    """Raised when a conditional update loses a concurrency race."""


class SupabaseStore:
    """Supabase-backed store for hubs, sources, and chat."""

    # Load configuration and initialise shared clients used across the API.
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
    def _embed_query(self, text: str) -> List[float]:
        response = self.llm_client.embeddings.create(model=self.embedding_model, input=text)
        return response.data[0].embedding

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
