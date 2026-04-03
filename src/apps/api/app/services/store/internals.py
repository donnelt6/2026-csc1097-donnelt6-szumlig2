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

#####################################################################################################################################################################################
    # Retrieval and answer-generation methods.
    def _select_matches(
        self,
        raw_matches: List[Dict[str, Any]],
        query_embedding: List[float],
        min_similarity: float,
        max_citations: int,
        fallback_mode: str,
        question_text: str = "",
    ) -> List[Dict[str, Any]]:
        if fallback_mode == "chat":
            exploratory_query = _is_exploratory_chat_question(question_text) or _is_vague_follow_up(question_text)
            reranked_matches = self._rerank_matches(
                raw_matches,
                query_embedding,
                len(raw_matches),
                diversify=self._should_diversify_chat_matches(raw_matches, query_embedding, question_text),
            )
            if reranked_matches:
                top_similarity = float(reranked_matches[0].get("_query_similarity") or 0)
                cutoff = top_similarity * self.chat_rerank_relative_cutoff
                filtered_matches = [
                    match
                    for match in reranked_matches
                    if float(match.get("_query_similarity") or 0) >= cutoff
                    and float(match.get("similarity") or 0) >= min_similarity
                ]
                if filtered_matches:
                    if not exploratory_query:
                        top_source_id = str(filtered_matches[0].get("source_id") or "").strip()
                        if top_source_id:
                            primary_matches = [
                                match
                                for match in filtered_matches
                                if str(match.get("source_id") or "").strip() == top_source_id
                            ]
                            max_secondary_gap = min(self.chat_diversity_confidence_gap, 0.03)
                            secondary_match = next(
                                (
                                    match
                                    for match in filtered_matches
                                    if str(match.get("source_id") or "").strip() != top_source_id
                                    and (top_similarity - float(match.get("_query_similarity") or 0)) <= max_secondary_gap
                                ),
                                None,
                            )
                            primary_limit = max_citations - 1 if secondary_match and max_citations > 1 else max_citations
                            selected_matches = primary_matches[:primary_limit] if primary_matches else filtered_matches[:1]
                            if secondary_match and len(selected_matches) < max_citations:
                                selected_matches.append(secondary_match)
                            filtered_matches = selected_matches
                    return self._strip_rerank_metadata(filtered_matches[:max_citations])
                return self._strip_rerank_metadata(reranked_matches[:1])
            if raw_matches:
                return raw_matches[:1]
            return []

        filtered_matches = [match for match in raw_matches if float(match.get("similarity") or 0) >= min_similarity]
        if filtered_matches:
            return self._strip_rerank_metadata(self._rerank_matches(filtered_matches, query_embedding, max_citations))
        if fallback_mode == "chat" and raw_matches:
            return raw_matches[:1]
        if fallback_mode == "guide" and raw_matches:
            return raw_matches[:max_citations]
        return []

    # Rerank matches.
    def _rerank_matches(
        self,
        matches: List[Dict[str, Any]],
        query_embedding: List[float],
        max_citations: int,
        diversify: bool = True,
    ) -> List[Dict[str, Any]]:
        normalized_query = _normalize_vector(query_embedding)
        candidates: List[Dict[str, Any]] = []
        for index, match in enumerate(matches):
            candidate = dict(match)
            normalized_embedding = _normalize_embedding_value(candidate.get("embedding"))
            candidate["_rank"] = index
            candidate["_normalized_embedding"] = normalized_embedding
            if normalized_query is not None and normalized_embedding is not None:
                candidate["_query_similarity"] = _cosine_similarity(normalized_query, normalized_embedding)
            else:
                candidate["_query_similarity"] = float(candidate.get("similarity") or 0)
            candidates.append(candidate)

        selected: List[Dict[str, Any]] = []
        remaining = candidates.copy()
        distinct_sources = {
            str(candidate.get("source_id") or "").strip()
            for candidate in candidates
            if str(candidate.get("source_id") or "").strip()
        }

        if diversify and len(distinct_sources) >= 2:
            while len(selected) < max_citations and remaining:
                selected_sources = {
                    str(candidate.get("source_id") or "").strip()
                    for candidate in selected
                    if str(candidate.get("source_id") or "").strip()
                }
                eligible = [
                    candidate
                    for candidate in remaining
                    if str(candidate.get("source_id") or "").strip() not in selected_sources
                ]
                if not eligible:
                    break
                next_candidate = max(
                    eligible,
                    key=lambda candidate: self._mmr_score(candidate, selected, duplicate_penalty=0.0),
                )
                selected.append(next_candidate)
                remaining.remove(next_candidate)

        while len(selected) < max_citations and remaining:
            next_candidate = max(
                remaining,
                key=lambda candidate: self._mmr_score(
                    candidate,
                    selected,
                    duplicate_penalty=self.retrieval_same_source_penalty,
                ),
                )
            selected.append(next_candidate)
            remaining.remove(next_candidate)

        return selected

    # Remove rerank metadata.
    def _strip_rerank_metadata(self, matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        cleaned: List[Dict[str, Any]] = []
        for candidate in matches:
            row = dict(candidate)
            row.pop("_rank", None)
            row.pop("_normalized_embedding", None)
            row.pop("_query_similarity", None)
            cleaned.append(row)
        return cleaned

    # Helper for should diversify chat matches.
    def _should_diversify_chat_matches(
        self,
        raw_matches: List[Dict[str, Any]],
        query_embedding: List[float],
        question_text: str,
    ) -> bool:
        if _is_exploratory_chat_question(question_text) or _is_vague_follow_up(question_text):
            return True
        candidates = self._rerank_matches(raw_matches, query_embedding, min(2, len(raw_matches)), diversify=False)
        if len(candidates) < 2:
            return False
        top_similarity = float(candidates[0].get("_query_similarity") or 0)
        second_similarity = float(candidates[1].get("_query_similarity") or 0)
        if str(candidates[0].get("source_id") or "").strip() != str(candidates[1].get("source_id") or "").strip():
            return (top_similarity - second_similarity) < self.chat_diversity_confidence_gap
        return False

    # Helper for mmr score.
    def _mmr_score(
        self,
        candidate: Dict[str, Any],
        selected: List[Dict[str, Any]],
        duplicate_penalty: float,
    ) -> Tuple[float, float, int]:
        query_similarity = float(candidate.get("_query_similarity") or 0)
        max_redundancy = 0.0
        candidate_embedding = candidate.get("_normalized_embedding")
        if candidate_embedding is not None:
            for selected_candidate in selected:
                selected_embedding = selected_candidate.get("_normalized_embedding")
                if selected_embedding is None:
                    continue
                max_redundancy = max(
                    max_redundancy,
                    _cosine_similarity(candidate_embedding, selected_embedding),
                )
        score = (self.retrieval_mmr_lambda * query_similarity) - (
            (1 - self.retrieval_mmr_lambda) * max_redundancy
        )
        candidate_source_id = str(candidate.get("source_id") or "").strip()
        if duplicate_penalty and candidate_source_id:
            selected_sources = {
                str(selected_candidate.get("source_id") or "").strip()
                for selected_candidate in selected
                if str(selected_candidate.get("source_id") or "").strip()
            }
            if candidate_source_id in selected_sources:
                score -= duplicate_penalty
        return score, query_similarity, -int(candidate.get("_rank", 0))

    # Rewrite query for retrieval.
    def _rewrite_query_for_retrieval(self, question: str, history: List[Dict[str, Any]]) -> str:
        conversation_lines: List[str] = []
        cited_snippets: List[str] = []
        for message in history[-self.chat_rewrite_history_messages :]:
            role = str(message.get("role") or "user")
            content = str(message.get("content") or "").strip()
            if content:
                conversation_lines.append(f"{role}: {content}")
            if role != "assistant":
                continue
            for citation in message.get("citations") or []:
                if isinstance(citation, dict):
                    source_id = str(citation.get("source_id") or "").strip()
                    snippet = str(citation.get("snippet") or "").strip()
                else:
                    source_id = str(getattr(citation, "source_id", "") or "").strip()
                    snippet = str(getattr(citation, "snippet", "") or "").strip()
                if not snippet:
                    continue
                cited_snippets.append(f"{source_id}: {snippet}" if source_id else snippet)

        system_prompt = (
            "Rewrite context-dependent follow-up questions into a single standalone retrieval query. "
            "Use the recent conversation and cited snippets to resolve what the user means. "
            "Preserve all active facets from recent turns instead of collapsing to only the strongest concept. "
            "When the follow-up refers to 'that', 'there', 'it', or similar, keep both the concept being discussed "
            "and the application, product, or workflow context from the recent conversation. "
            "Prefer grounded terms that already appear in recent user turns and cited snippets. "
            "Return a concise standalone retrieval query only. "
            "Return only the rewritten query as one plain-text line. Do not answer the question. "
            "Do not include citations, markdown, labels, or commentary."
        )
        conversation_text = "\n".join(conversation_lines) if conversation_lines else "None."
        citations_text = "\n".join(cited_snippets[-5:]) if cited_snippets else "None."
        user_prompt = (
            f"Current question:\n{question}\n\n"
            f"Recent conversation:\n{conversation_text}\n\n"
            f"Recent cited snippets:\n{citations_text}"
        )

        try:
            completion = self.llm_client.chat.completions.create(
                model=self.chat_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0,
            )
            rewritten = completion.choices[0].message.content or ""
        except Exception:
            return question
        return _normalize_retrieval_query(question, rewritten)

    # Generate chat session title.
    def _generate_chat_session_title(self, first_message: str) -> str:
        cleaned = " ".join((first_message or "").split()).strip()
        if not cleaned:
            return "New Chat"

        system_prompt = (
            "Write a very short chat title that summarizes the user's topic. "
            "Return 2 to 5 words. Use title case. Do not use quotes, punctuation, markdown, or labels."
        )
        user_prompt = f"First user message:\n{cleaned}"

        try:
            completion = self.llm_client.chat.completions.create(
                model=self.chat_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
            )
            content = completion.choices[0].message.content or ""
        except Exception:
            return _fallback_chat_session_title(cleaned)

        return _normalize_chat_session_title(content) or _fallback_chat_session_title(cleaned)

    # Helper for retrieve chat context.
    def _retrieve_chat_context(
        self,
        client: Client,
        hub_id: str,
        query_text: str,
        source_ids: Optional[List[str]],
    ) -> tuple[List[Dict[str, Any]], List[Citation], List[str]]:
        query_embedding = self._embed_query(query_text)
        raw_matches = self._match_chunks(client, hub_id, query_embedding, self.retrieval_candidate_pool, source_ids)
        matches = self._select_matches(
            raw_matches,
            query_embedding,
            self.min_similarity,
            self.max_citations,
            fallback_mode="chat",
            question_text=query_text,
        )

        citations: List[Citation] = []
        context_blocks: List[str] = []
        for idx, match in enumerate(matches, start=1):
            snippet = match.get("text") or ""
            citations.append(
                Citation(source_id=match["source_id"], snippet=snippet, chunk_index=match["chunk_index"])
            )
            context_blocks.append(f"[{idx}] {snippet}")
        return raw_matches, citations, context_blocks

    # Generate chat answer.
    def _generate_chat_answer(
        self,
        client: Client,
        *,
        hub_id: str,
        question: str,
        scope: HubScope,
        retrieval_source_ids: Optional[List[str]],
        history_messages: List[Dict[str, str]],
        retrieval_history: List[Dict[str, Any]],
        trace: Optional[ChatTraceRecorder] = None,
    ) -> tuple[str, List[Citation], Optional[Dict[str, Any]], Dict[str, Any]]:
        retrieval_query = question
        rewrite_attempted = False
        rewrite_used = False
        anchored_fallback_used = False
        is_vague_follow_up = _is_vague_follow_up(question)
        final_retrieval_query = retrieval_query
        if trace:
            with trace.step(
                "query_rewrite",
                question=question,
                is_vague_follow_up=is_vague_follow_up,
                retrieval_history_count=len(retrieval_history),
            ) as step:
                if self.chat_rewrite_enabled and retrieval_history and is_vague_follow_up:
                    retrieval_query = self._rewrite_query_for_retrieval(question, retrieval_history)
                    rewrite_attempted = True
                    rewrite_used = retrieval_query != question
                final_retrieval_query = retrieval_query
                step.output = {
                    "retrieval_query": retrieval_query,
                    "rewrite_attempted": rewrite_attempted,
                    "rewrite_used": rewrite_used,
                }
        elif self.chat_rewrite_enabled and retrieval_history and is_vague_follow_up:
            retrieval_query = self._rewrite_query_for_retrieval(question, retrieval_history)
            rewrite_attempted = True
            rewrite_used = retrieval_query != question
            final_retrieval_query = retrieval_query

        if trace:
            with trace.step("retrieve_context", query=retrieval_query, source_ids=retrieval_source_ids or []) as step:
                raw_matches, citations, context_blocks = self._retrieve_chat_context(
                    client,
                    hub_id,
                    retrieval_query,
                    retrieval_source_ids,
                )
                step.output = {
                    "raw_match_count": len(raw_matches),
                    "selected_citation_count": len(citations),
                    "selected_source_ids": [citation.source_id for citation in citations],
                }
        else:
            raw_matches, citations, context_blocks = self._retrieve_chat_context(
                client,
                hub_id,
                retrieval_query,
                retrieval_source_ids,
            )

        if self.chat_rewrite_enabled and retrieval_history and not raw_matches and not rewrite_attempted:
            rewritten_query = self._rewrite_query_for_retrieval(question, retrieval_history)
            rewrite_attempted = True
            if rewritten_query != retrieval_query:
                rewrite_used = True
                if trace:
                    with trace.step("rewrite_fallback", query=rewritten_query) as step:
                        raw_matches, citations, context_blocks = self._retrieve_chat_context(
                            client,
                            hub_id,
                            rewritten_query,
                            retrieval_source_ids,
                        )
                        final_retrieval_query = rewritten_query
                        step.output = {
                            "raw_match_count": len(raw_matches),
                            "selected_citation_count": len(citations),
                            "selected_source_ids": [citation.source_id for citation in citations],
                        }
                else:
                    raw_matches, citations, context_blocks = self._retrieve_chat_context(
                        client,
                        hub_id,
                        rewritten_query,
                        retrieval_source_ids,
                    )
                    final_retrieval_query = rewritten_query

        if (
            self.chat_rewrite_enabled
            and retrieval_history
            and is_vague_follow_up
            and _history_has_multi_source_grounding(retrieval_history)
            and _count_distinct_citation_sources(citations) == 1
        ):
            anchor_turn = _most_recent_informative_user_turn(retrieval_history)
            if anchor_turn:
                anchored_suffix = retrieval_query if retrieval_query != question else question
                anchored_query = _build_anchored_retrieval_query(anchor_turn, anchored_suffix)
                if anchored_query != retrieval_query:
                    if trace:
                        with trace.step("anchored_retrieval", query=anchored_query, anchor_turn=anchor_turn) as step:
                            fallback_raw_matches, fallback_citations, fallback_context_blocks = self._retrieve_chat_context(
                                client,
                                hub_id,
                                anchored_query,
                                retrieval_source_ids,
                            )
                            step.output = {
                                "raw_match_count": len(fallback_raw_matches),
                                "selected_citation_count": len(fallback_citations),
                                "selected_source_ids": [citation.source_id for citation in fallback_citations],
                            }
                    else:
                        fallback_raw_matches, fallback_citations, fallback_context_blocks = self._retrieve_chat_context(
                            client,
                            hub_id,
                            anchored_query,
                            retrieval_source_ids,
                        )
                    fallback_distinct_sources = _count_distinct_citation_sources(fallback_citations)
                    current_distinct_sources = _count_distinct_citation_sources(citations)
                    if fallback_distinct_sources > current_distinct_sources:
                        raw_matches = fallback_raw_matches
                        citations = fallback_citations
                        context_blocks = fallback_context_blocks
                        anchored_fallback_used = True
                        final_retrieval_query = anchored_query

        generation_metadata = {
            "retrieval_query": final_retrieval_query,
            "rewrite_attempted": rewrite_attempted,
            "rewrite_used": rewrite_used,
            "anchored_fallback_used": anchored_fallback_used,
            "raw_match_count": len(raw_matches),
            "selected_citation_count": len(citations),
            "selected_source_ids": [citation.source_id for citation in citations],
            "zero_hit": not bool(raw_matches),
            "used_web_search": scope == HubScope.global_scope,
            "no_context_available": not bool(context_blocks),
        }

        if scope == HubScope.global_scope:
            if trace:
                with trace.step("answer_generation", scope=scope.value, context_block_count=len(context_blocks)) as step:
                    answer, web_citations, usage = self._answer_with_web_search(question, context_blocks)
                    step.output = {
                        "citation_count": len(citations) + len(web_citations),
                        "total_tokens": _total_tokens_from_usage(usage),
                    }
            else:
                answer, web_citations, usage = self._answer_with_web_search(question, context_blocks)
            all_citations = citations + web_citations
            if not _answer_has_citation(answer, len(all_citations)):
                all_citations = []
            generation_metadata["answer_has_citations"] = bool(all_citations)
            return answer, all_citations, usage, generation_metadata

        system_prompt = _hub_answer_system_prompt()
        user_prompt = f"Question: {question}\n\nContext:\n" + "\n".join(context_blocks)

        if not context_blocks:
            answer = "I don't have enough information from this hub's sources to answer that."
            usage = None
            if trace:
                with trace.step("answer_generation", scope=scope.value, context_block_count=0) as step:
                    step.output = {"total_tokens": 0, "abstained": True}
            generation_metadata["answer_has_citations"] = False
            return answer, [], usage, generation_metadata

        raw_answer, usage = self._complete_chat_answer(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            history_messages=history_messages,
            scope=scope,
            context_block_count=len(context_blocks),
            trace=trace,
            step_name="answer_generation",
        )
        answer, final_citations = self._extract_grounded_chat_citations(raw_answer, citations)
        retried_for_citations = False
        if context_blocks and not final_citations and _looks_like_grounded_answer(answer):
            repair_prompt = _hub_answer_repair_prompt()
            repair_answer, repair_usage = self._complete_chat_answer(
                system_prompt=repair_prompt,
                user_prompt=user_prompt,
                history_messages=history_messages,
                scope=scope,
                context_block_count=len(context_blocks),
                trace=trace,
                step_name="answer_generation_retry",
            )
            repaired_text, repaired_citations = self._extract_grounded_chat_citations(repair_answer, citations)
            retried_for_citations = True
            if repaired_citations:
                answer = repaired_text
                final_citations = repaired_citations
                usage = repair_usage
        generation_metadata["answer_has_citations"] = bool(final_citations)
        generation_metadata["retried_for_citations"] = retried_for_citations
        return answer, final_citations, usage, generation_metadata

    # Extract grounded chat citations.
    def _extract_grounded_chat_citations(
        self,
        raw_answer: str,
        citations: List[Citation],
    ) -> tuple[str, List[Citation]]:
        answer, quotes = _extract_quotes(raw_answer)
        hydrated_citations = [citation.model_copy(deep=True) for citation in citations]
        for idx_str, pairs in quotes.items():
            try:
                citation_idx = int(str(idx_str).strip()) - 1
            except (TypeError, ValueError):
                continue
            if 0 <= citation_idx < len(hydrated_citations):
                snippet = hydrated_citations[citation_idx].snippet
                verified = _match_quote_pairs_to_snippet(pairs, snippet)
                if verified:
                    hydrated_citations[citation_idx].relevant_quotes = [v[0] for v in verified]
                    hydrated_citations[citation_idx].paraphrased_quotes = [v[1] for v in verified]
        referenced_indices = _referenced_citation_indices(answer, len(hydrated_citations))
        final_citations = [hydrated_citations[idx - 1] for idx in referenced_indices]
        return answer, final_citations

    # Complete chat answer.
    def _complete_chat_answer(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        history_messages: List[Dict[str, str]],
        scope: HubScope,
        context_block_count: int,
        trace: Optional[ChatTraceRecorder],
        step_name: str,
    ) -> tuple[str, Optional[Dict[str, Any]]]:
        if trace:
            with trace.step(step_name, scope=scope.value, context_block_count=context_block_count) as step:
                completion = self.llm_client.chat.completions.create(
                    model=self.chat_model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        *history_messages,
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.2,
                )
                step.output = {"total_tokens": _total_tokens_from_usage(completion.usage.model_dump() if completion.usage else None)}
        else:
            completion = self.llm_client.chat.completions.create(
                model=self.chat_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    *history_messages,
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
            )
        return completion.choices[0].message.content or "", (completion.usage.model_dump() if completion.usage else None)

    # Handle the requested data.
    def chat(self, client: Client, user_id: str, payload: ChatRequest) -> ChatResponse:
        hub_id = str(payload.hub_id)
        requested_source_ids = None if payload.source_ids is None else [str(source_id) for source_id in payload.source_ids]
        persisted_source_ids, retrieval_source_ids = self._normalize_chat_source_ids(
            client,
            hub_id,
            requested_source_ids,
        )
        started_at = time.perf_counter()

        existing_session_id: Optional[str] = None
        session_title: str
        user_message_id: Optional[str] = None
        if payload.session_id is not None:
            existing_session_id = str(payload.session_id)
            session_row = self._get_chat_session_row(client, existing_session_id)
            if str(session_row["hub_id"]) != hub_id:
                raise KeyError("Chat session not found")
            session_title = str(session_row.get("title") or "New Chat")
            history_messages = self._recent_conversation(client, existing_session_id)
            retrieval_history = self._recent_retrieval_context(client, existing_session_id)
            user_message_row = client.table("messages").insert(
                {"session_id": existing_session_id, "role": "user", "content": payload.question}
            ).execute()
            user_message_id = str(user_message_row.data[0]["id"])
        else:
            session_title = self._generate_chat_session_title(payload.question)
            history_messages = []
            retrieval_history = []
        trace = ChatTraceRecorder(
            user_id=user_id,
            hub_id=hub_id,
            session_id=existing_session_id,
            question=payload.question,
        )
        trace.annotate(
            scope=payload.scope.value,
            requested_source_ids=requested_source_ids,
            persisted_source_ids=persisted_source_ids,
            retrieval_source_ids=retrieval_source_ids,
            existing_session_id=existing_session_id,
        )
        # Helper for finalize response.
        def finalize_response(
            answer: str,
            response_citations: List[Citation],
            usage: Optional[Dict[str, Any]],
            generation_metadata: Dict[str, Any],
        ) -> ChatResponse:
            if existing_session_id is None:
                persisted = self._create_chat_session_with_messages(
                    hub_id=hub_id,
                    user_id=user_id,
                    title=session_title,
                    scope=payload.scope,
                    source_ids=persisted_source_ids,
                    user_content=payload.question,
                    assistant_content=answer,
                    assistant_citations=response_citations,
                    assistant_token_usage=usage,
                )
                latency_ms = round((time.perf_counter() - started_at) * 1000, 2)
                session_id = str(persisted["session_id"])
                assistant_message_id = str(persisted["assistant_message_id"])
                self._insert_chat_event_best_effort(
                    client,
                    hub_id=hub_id,
                    session_id=session_id,
                    user_id=user_id,
                    event_type=ChatEventType.question_asked.value,
                    metadata={
                        "scope": payload.scope.value,
                        "source_ids": persisted_source_ids,
                        "question_length": len(payload.question),
                    },
                )
                self._insert_chat_event_best_effort(
                    client,
                    hub_id=hub_id,
                    session_id=session_id,
                    message_id=assistant_message_id,
                    user_id=user_id,
                    event_type=ChatEventType.answer_received.value,
                    metadata={
                        "latency_ms": latency_ms,
                        "citation_count": len(response_citations),
                        "total_tokens": _total_tokens_from_usage(usage),
                        **generation_metadata,
                    },
                )
                trace.annotate(
                    session_id=session_id,
                    assistant_message_id=assistant_message_id,
                    latency_ms=latency_ms,
                    total_tokens=_total_tokens_from_usage(usage),
                    citation_count=len(response_citations),
                    **generation_metadata,
                )
                trace.flush(output={"answer_preview": answer[:500]})
                return ChatResponse(
                    answer=answer,
                    citations=response_citations,
                    message_id=assistant_message_id,
                    session_id=session_id,
                    session_title=str(persisted.get("session_title") or session_title or "New Chat"),
                    flag_status=MessageFlagStatus.none.value,
                    feedback_rating=None,
                )

            assistant_row = (
                client.table("messages")
                .insert(
                    {
                        "session_id": existing_session_id,
                        "role": "assistant",
                        "content": answer,
                        "citations": [citation.model_dump() for citation in response_citations],
                        "token_usage": usage,
                    }
                )
                .execute()
            )
            assistant_created_at = assistant_row.data[0].get("created_at") or datetime.now(timezone.utc).isoformat()
            self._update_chat_session_state(
                existing_session_id,
                scope=payload.scope,
                source_ids=persisted_source_ids,
                last_message_at=assistant_created_at,
            )
            latency_ms = round((time.perf_counter() - started_at) * 1000, 2)
            self._insert_chat_event_best_effort(
                client,
                hub_id=hub_id,
                session_id=existing_session_id,
                message_id=user_message_id,
                user_id=user_id,
                event_type=ChatEventType.question_asked.value,
                metadata={
                    "scope": payload.scope.value,
                    "source_ids": persisted_source_ids,
                    "question_length": len(payload.question),
                },
            )
            self._insert_chat_event_best_effort(
                client,
                hub_id=hub_id,
                session_id=existing_session_id,
                message_id=str(assistant_row.data[0]["id"]),
                user_id=user_id,
                event_type=ChatEventType.answer_received.value,
                metadata={
                    "latency_ms": latency_ms,
                    "citation_count": len(response_citations),
                    "total_tokens": _total_tokens_from_usage(usage),
                    **generation_metadata,
                },
            )
            trace.annotate(
                session_id=existing_session_id,
                assistant_message_id=str(assistant_row.data[0]["id"]),
                latency_ms=latency_ms,
                total_tokens=_total_tokens_from_usage(usage),
                citation_count=len(response_citations),
                **generation_metadata,
            )
            trace.flush(output={"answer_preview": answer[:500]})
            return ChatResponse(
                answer=answer,
                citations=response_citations,
                message_id=assistant_row.data[0]["id"],
                session_id=existing_session_id,
                session_title=session_title,
                flag_status=MessageFlagStatus.none.value,
                feedback_rating=None,
            )

        answer, citations, usage, generation_metadata = self._generate_chat_answer(
            client,
            hub_id=hub_id,
            question=payload.question,
            scope=payload.scope,
            retrieval_source_ids=retrieval_source_ids,
            history_messages=history_messages,
            retrieval_history=retrieval_history,
            trace=trace,
        )
        return finalize_response(answer, citations, usage, generation_metadata)

    # Chat feedback and analytics methods.
    # Handle history.
    def chat_history(self, client: Client, user_id: str, hub_id: str) -> List[HistoryMessage]:
        response = (
            client.table("chat_sessions")
            .select("id")
            .eq("hub_id", str(hub_id))
            .eq("created_by", str(user_id))
            .is_("deleted_at", "null")
            .order("last_message_at", desc=True)
            .limit(1)
            .execute()
        )
        if not response.data:
            return []
        rows = self._list_session_messages(
            client,
            response.data[0]["id"],
            fields="id, role, content, citations, created_at",
        )
        flag_metadata = self._message_flag_metadata([str(row["id"]) for row in rows if row.get("role") == "assistant"])
        return [
            HistoryMessage(
                role=m["role"],
                content=m["content"],
                citations=[Citation(**c) for c in (m.get("citations") or [])],
                created_at=m["created_at"],
                active_flag_id=flag_metadata.get(str(m["id"]), {}).get("active_flag_id"),
                flag_status=flag_metadata.get(str(m["id"]), {}).get("flag_status", MessageFlagStatus.none.value),
            )
            for m in rows
        ]

    # Create chat feedback.
    def create_chat_feedback(
        self,
        client: Client,
        user_id: str,
        message_id: str,
        payload: ChatFeedbackRequest,
    ) -> ChatFeedbackResponse:
        message_row = self._visible_message_for_user(client, message_id)
        if str(message_row.get("role") or "") != "assistant":
            raise ValueError("Feedback can only be submitted for assistant messages.")
        session_row = self._get_chat_session_row(self.service_client, str(message_row["session_id"]), include_deleted=True)
        response = (
            client.table("chat_feedback")
            .upsert(
                {
                    "hub_id": str(session_row["hub_id"]),
                    "session_id": str(message_row["session_id"]),
                    "message_id": str(message_id),
                    "user_id": str(user_id),
                    "rating": payload.rating.value,
                    "reason": payload.reason,
                },
                on_conflict="message_id,user_id",
            )
            .execute()
        )
        row = (response.data or [{}])[0]
        self._insert_chat_event_best_effort(
            client,
            hub_id=str(session_row["hub_id"]),
            session_id=str(message_row["session_id"]),
            message_id=str(message_id),
            user_id=user_id,
            event_type=ChatEventType.answer_feedback_submitted.value,
            metadata={"rating": payload.rating.value},
        )
        return ChatFeedbackResponse(
            message_id=str(message_id),
            rating=ChatFeedbackRating(str(row.get("rating") or payload.rating.value)),
            reason=row.get("reason") if isinstance(row, dict) else payload.reason,
            updated_at=row.get("updated_at") or datetime.now(timezone.utc),
        )

    # Create citation feedback.
    def create_citation_feedback(
        self,
        client: Client,
        user_id: str,
        message_id: str,
        payload: CitationFeedbackRequest,
    ) -> CitationFeedbackResponse:
        message_row = self._visible_message_for_user(client, message_id)
        if str(message_row.get("role") or "") != "assistant":
            raise ValueError("Citation feedback can only be submitted for assistant messages.")
        citations = [Citation(**citation) for citation in (message_row.get("citations") or [])]
        matched_citation = next(
            (
                citation
                for citation in citations
                if citation.source_id == payload.source_id
                and (payload.chunk_index is None or citation.chunk_index == payload.chunk_index)
            ),
            None,
        )
        if matched_citation is None:
            raise ValueError("Citation not found for this message.")
        session_row = self._get_chat_session_row(self.service_client, str(message_row["session_id"]), include_deleted=True)
        response = (
            client.table("citation_feedback")
            .insert(
                {
                    "hub_id": str(session_row["hub_id"]),
                    "session_id": str(message_row["session_id"]),
                    "message_id": str(message_id),
                    "user_id": str(user_id),
                    "source_id": payload.source_id,
                    "chunk_index": payload.chunk_index,
                    "event_type": payload.event_type.value,
                    "note": payload.note,
                }
            )
            .execute()
        )
        row = (response.data or [{}])[0]
        self._insert_chat_event_best_effort(
            client,
            hub_id=str(session_row["hub_id"]),
            session_id=str(message_row["session_id"]),
            message_id=str(message_id),
            user_id=user_id,
            event_type=(
                ChatEventType.citation_opened.value
                if payload.event_type == CitationFeedbackEventType.opened
                else ChatEventType.citation_flagged.value
            ),
            metadata={
                "source_id": payload.source_id,
                "chunk_index": payload.chunk_index,
            },
        )
        return CitationFeedbackResponse(
            message_id=str(message_id),
            source_id=str(row.get("source_id") or payload.source_id),
            chunk_index=row.get("chunk_index", payload.chunk_index),
            event_type=CitationFeedbackEventType(str(row.get("event_type") or payload.event_type.value)),
            created_at=row.get("created_at") or datetime.now(timezone.utc),
        )

    # LLM and retrieval support methods.
    # Answer a question using hub context and web search results.
    def _answer_with_web_search(
        self,
        question: str,
        context_blocks: List[str],
    ) -> tuple[str, List[Citation], Optional[dict]]:
        system_prompt = (
            "You are Caddie, an onboarding assistant. Use hub context and web search results. "
            "If hub context is relevant, cite it with [n] matching the context list. "
            "Only include citations when you are directly using the cited content. "
            "If the user sends small talk or a greeting, respond politely and ask how you can help."
        )
        hub_context = "\n".join(context_blocks) if context_blocks else "None."
        user_prompt = f"Question: {question}\n\nHub context:\n{hub_context}"

        try:
            responses_client = getattr(self.llm_client, "responses", None)
            if responses_client is None:
                raise RuntimeError("Responses API unavailable for web search")
            response = responses_client.create(
                model=self.chat_model,
                input=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                tools=[{"type": "web_search_preview"}],
                temperature=0.2,
            )
            answer = _extract_response_text(response) or ""
            web_citations = _build_web_citations(response)
            usage = _extract_usage(response)
            if not answer:
                answer = "I couldn't find enough information to answer that."
            return answer, web_citations, usage
        except Exception:
            # Fall back to a hub-only answer if web search is unavailable.
            completion = self.llm_client.chat.completions.create(
                model=self.chat_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
            )
            answer = completion.choices[0].message.content or ""
            usage = completion.usage.model_dump() if completion.usage else None
            if not answer:
                answer = "I couldn't find enough information to answer that."
            return answer, [], usage

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
