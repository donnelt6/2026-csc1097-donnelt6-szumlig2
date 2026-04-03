"""Compatibility-first package facade for the split store implementation.

Domain ownership:
- `hubs`, `sources`, `memberships`, `chat`, `moderation`, `analytics`
- `content` for FAQs and guides, `reminders`, `activity`, `users`
- helper-only exports live in `chat_helpers`, `source_helpers`, and `common_helpers`
"""

import random
import uuid

from ...schemas import FlagMessageRequest
from .base import ConflictError, StoreBase
from .chat import ChatStoreMixin
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
from .content import ContentStoreMixin
from .hubs import HubStoreMixin
from .memberships import MembershipStoreMixin
from .moderation import ModerationStoreMixin
from .analytics import AnalyticsStoreMixin
from .activity import ActivityStoreMixin
from .reminders import ReminderStoreMixin
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
from .sources import SourceStoreMixin
from .users import UserStoreMixin


class SupabaseStore(
    HubStoreMixin,
    SourceStoreMixin,
    MembershipStoreMixin,
    ChatStoreMixin,
    ModerationStoreMixin,
    AnalyticsStoreMixin,
    ContentStoreMixin,
    ReminderStoreMixin,
    ActivityStoreMixin,
    UserStoreMixin,
    StoreBase,
):
    """Supabase-backed store composed from domain-specific mixins."""


store = SupabaseStore()

__all__ = [
    "ConflictError",
    "SupabaseStore",
    "store",
    "FlagMessageRequest",
    "_QuotePair",
    "_answer_has_citation",
    "_average_similarity",
    "_build_anchored_retrieval_query",
    "_build_search_snippet",
    "_build_web_citations",
    "_build_web_source_name",
    "_build_youtube_source_name",
    "_canonicalize_web_url",
    "_chat_search_score",
    "_clamp_window_days",
    "_coerce_embedding_value",
    "_cosine_similarity",
    "_count_distinct_citation_sources",
    "_escape_ilike_pattern",
    "_extract_quotes",
    "_extract_response_text",
    "_extract_usage",
    "_extract_web_results",
    "_extract_youtube_video_id",
    "_fallback_chat_session_title",
    "_format_web_snippet",
    "_get_attr",
    "_has_context_reference",
    "_history_has_multi_source_grounding",
    "_hub_answer_repair_prompt",
    "_hub_answer_system_prompt",
    "_is_exploratory_chat_question",
    "_is_missing_hub_optional_column_error",
    "_is_uuid_like",
    "_is_vague_follow_up",
    "_iso_day",
    "_looks_like_grounded_answer",
    "_match_quote_pairs_to_snippet",
    "_most_recent_informative_user_turn",
    "_normalize_chat_session_title",
    "_normalize_embedding_value",
    "_normalize_retrieval_query",
    "_normalize_vector",
    "_normalize_youtube_id",
    "_parse_questions_from_text",
    "_parse_steps_from_text",
    "_preview_text",
    "_referenced_citation_indices",
    "_safe_float",
    "_safe_int",
    "_sanitize_filename",
    "_total_tokens_from_usage",
    "_trim_text",
    "_web_storage_path",
    "_youtube_storage_path",
]
