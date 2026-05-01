"""ChatStoreMixin: handles chat sessions, retrieval, answer generation, and chat feedback flows."""

import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from supabase import Client

from ...schemas import (
    ChatEventCreate,
    ChatEventResponse,
    ChatEventType,
    ChatFeedbackRating,
    ChatFeedbackRequest,
    ChatFeedbackResponse,
    ChatRequest,
    ChatResponse,
    ChatSearchResult,
    ChatSessionDetail,
    ChatSessionSummary,
    Citation,
    CitationFeedbackEventType,
    CitationFeedbackRequest,
    CitationFeedbackResponse,
    HistoryMessage,
    HubScope,
    MessageFlagStatus,
    SessionMessage,
)
from ..tracing import ChatTraceRecorder
from .base import logger
from .chat_helpers import (
    _answer_has_citation,
    _build_anchored_retrieval_query,
    _build_search_snippet,
    _chat_search_score,
    _count_distinct_citation_sources,
    _extract_quotes,
    _fallback_chat_session_title,
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
    _preview_text,
    _referenced_citation_indices,
    _score_answer_snippet_overlap,
    _smalltalk_intent,
    _smalltalk_response,
)
from .common_helpers import (
    _build_web_citations,
    _cosine_similarity,
    _escape_ilike_pattern,
    _extract_response_text,
    _extract_usage,
    _normalize_embedding_value,
    _normalize_vector,
    _total_tokens_from_usage,
)


_HUB_ABSTAIN_ANSWER = "I don't have enough information from this hub's sources to answer that."
_SESSION_MESSAGE_ABSTAIN_MARKERS = (
    "don't have enough information",
    "do not have enough information",
    "not enough information",
    "insufficient information",
    "cannot determine",
    "can't determine",
)
_SESSION_MESSAGE_GREETING_RESPONSES = {
    _smalltalk_response("greeting"),
    _smalltalk_response("thanks"),
}


class ChatStoreMixin:
    # -------------------------------------------------------------------------
    # Session and message lookup helpers
    # -------------------------------------------------------------------------

    # Fetch a batch of session rows by id for moderation and chat detail views.
    def _service_chat_session_rows(self, session_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        if not session_ids:
            return {}
        response = (
            self.service_client.table("chat_sessions")
            .select("id, hub_id, title, scope, source_ids, created_at, last_message_at, deleted_at")
            .in_("id", session_ids)
            .execute()
        )
        return {str(row["id"]): row for row in (response.data or [])}

    # Fetch a batch of message rows by id for moderation and session hydration.
    def _service_message_rows(self, message_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        if not message_ids:
            return {}
        response = (
            self.service_client.table("messages")
            .select("id,session_id,role,content,citations,answer_status,created_at")
            .in_("id", message_ids)
            .execute()
        )
        return {str(row["id"]): row for row in (response.data or [])}

    # Normalize optional source filters against the hub's current complete sources.
    def _normalize_chat_source_ids(
        self,
        client: Client,
        hub_id: str,
        requested_source_ids: Optional[List[str]],
    ) -> tuple[List[str], Optional[List[str]]]:
        complete_source_ids = self._complete_source_ids_for_hub(client, hub_id)
        if requested_source_ids is None:
            return complete_source_ids, None
        normalized_source_ids = self._normalize_source_ids_to_complete_order(
            requested_source_ids,
            complete_source_ids,
        )
        return normalized_source_ids, normalized_source_ids

    # Convert a raw chat session row into the API summary shape.
    def _serialize_chat_session(
        self,
        row: Dict[str, Any],
        complete_source_ids: List[str],
    ) -> ChatSessionSummary:
        source_ids = self._normalize_source_ids_to_complete_order(
            [str(source_id) for source_id in (row.get("source_ids") or [])],
            complete_source_ids,
        )
        return ChatSessionSummary(
            id=str(row["id"]),
            hub_id=str(row["hub_id"]),
            title=str(row.get("title") or "New Chat"),
            scope=row.get("scope") or HubScope.hub.value,
            source_ids=source_ids,
            created_at=row["created_at"],
            last_message_at=row.get("last_message_at") or row["created_at"],
        )

    # Fetch one chat session row, optionally including deleted sessions.
    def _get_chat_session_row(
        self,
        client: Client,
        session_id: str,
        *,
        include_deleted: bool = False,
    ) -> Dict[str, Any]:
        query = (
            client.table("chat_sessions")
            .select("id, hub_id, created_by, title, scope, source_ids, created_at, last_message_at, deleted_at")
            .eq("id", str(session_id))
            .limit(1)
        )
        if not include_deleted:
            query = query.is_("deleted_at", "null")
        response = query.execute()
        if not response.data:
            raise KeyError("Chat session not found")
        return response.data[0]

    # Ensure the given user owns the chat session before allowing write actions.
    def _require_chat_session_owner(
        self,
        client: Client,
        user_id: str,
        session_id: str,
        *,
        include_deleted: bool = False,
    ) -> Dict[str, Any]:
        row = self._get_chat_session_row(client, session_id, include_deleted=include_deleted)
        if str(row.get("created_by") or "") != str(user_id):
            raise PermissionError("Only the chat creator can modify this session.")
        return row

    # Return ordered messages for one session, with optional field and limit control.
    def _list_session_messages(
        self,
        client: Client,
        session_id: str,
        fields: str = "id, role, content, citations, answer_status, created_at",
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        query = (
            client.table("messages")
            .select(fields)
            .eq("session_id", str(session_id))
            .order("created_at", desc=False)
        )
        if limit is not None:
            query = query.limit(limit)
        response = query.execute()
        return response.data or []

    # Convert stored message rows into lightweight LLM conversation messages.
    def _conversation_from_message_rows(self, rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
        return [
            {"role": row["role"], "content": row["content"]}
            for row in rows[-self.chat_rewrite_history_messages :]
        ]

    # Convert stored message rows into retrieval history that still includes citations.
    def _retrieval_context_from_message_rows(self, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [
            {
                "role": row["role"],
                "content": row["content"],
                "citations": row.get("citations") or [],
            }
            for row in rows[-self.chat_rewrite_history_messages :]
        ]

    # Return recent conversation history for title generation and answer calls.
    def _recent_conversation(self, client: Client, session_id: str) -> List[Dict[str, str]]:
        try:
            rows = self._list_session_messages(
                client,
                session_id,
                fields="role, content, created_at",
            )
            return self._conversation_from_message_rows(rows)
        except Exception:
            return []

    # Return recent retrieval history with citations for query rewriting.
    def _recent_retrieval_context(self, client: Client, session_id: str) -> List[Dict[str, Any]]:
        try:
            rows = self._list_session_messages(
                client,
                session_id,
                fields="role, content, citations, created_at",
            )
            return self._retrieval_context_from_message_rows(rows)
        except Exception:
            return []

    # Reconstruct answer_status for older assistant history rows that predate
    # persisted answer_status support.
    def _session_message_answer_status(
        self,
        role: str,
        content: str,
        citations: List[Citation],
        persisted_status: Optional[str] = None,
    ) -> Optional[str]:
        if role != "assistant":
            return None
        if persisted_status:
            return persisted_status
        if citations:
            return "answered"
        normalized = (content or "").strip()
        if normalized in _SESSION_MESSAGE_GREETING_RESPONSES:
            return "greeting"
        lowered = normalized.lower()
        if any(marker in lowered for marker in _SESSION_MESSAGE_ABSTAIN_MARKERS):
            return "abstained"
        return "answered"

    # Persist the derived assistant answer_status for rows created through the
    # session-creation RPC until the database function is updated.
    def _persist_message_answer_status(self, message_id: str, answer_status: Optional[str]) -> None:
        if not answer_status:
            return
        self.service_client.table("messages").update(
            {"answer_status": answer_status}
        ).eq("id", str(message_id)).execute()

    # Convert a stored message row into the public session-message schema.
    def _serialize_session_message(
        self,
        message: Dict[str, Any],
        flag_metadata: Optional[Dict[str, Dict[str, Any]]] = None,
        feedback_metadata: Optional[Dict[str, Optional[str]]] = None,
    ) -> SessionMessage:
        message_id = str(message["id"])
        metadata = (flag_metadata or {}).get(message_id, {})
        citations = [Citation(**citation) for citation in (message.get("citations") or [])]
        return SessionMessage(
            id=message_id,
            role=message["role"],
            content=message["content"],
            citations=citations,
            created_at=message["created_at"],
            active_flag_id=metadata.get("active_flag_id"),
            flag_status=metadata.get("flag_status", MessageFlagStatus.none.value),
            feedback_rating=(feedback_metadata or {}).get(message_id),
            answer_status=self._session_message_answer_status(
                message["role"],
                message["content"],
                citations,
                message.get("answer_status"),
            ),
        )

    # Fetch a message row visible to the calling user through the request-scoped client.
    def _visible_message_for_user(self, client: Client, message_id: str) -> Dict[str, Any]:
        response = (
            client.table("messages")
            .select("id,session_id,role,content,citations,answer_status,created_at")
            .eq("id", str(message_id))
            .limit(1)
            .execute()
        )
        if not response.data:
            raise KeyError("Message not found")
        return response.data[0]

    # Fetch a message row through the service client for internal workflows.
    def _service_message_row(self, message_id: str) -> Dict[str, Any]:
        response = (
            self.service_client.table("messages")
            .select("id,session_id,role,content,citations,answer_status,created_at")
            .eq("id", str(message_id))
            .limit(1)
            .execute()
        )
        if not response.data:
            raise KeyError("Message not found")
        return response.data[0]

    # Return the current user's chat feedback ratings keyed by assistant message id.
    def _message_feedback_map_for_user(self, message_ids: List[str], user_id: str) -> Dict[str, Optional[str]]:
        if not message_ids:
            return {}
        response = (
            self.service_client.table("chat_feedback")
            .select("message_id,rating")
            .eq("user_id", str(user_id))
            .in_("message_id", message_ids)
            .execute()
        )
        return {str(row["message_id"]): (row.get("rating") or None) for row in (response.data or [])}

    # Update the persisted scope, selected sources, and last-message timestamp for an existing session.
    def _update_chat_session_state(
        self,
        session_id: str,
        *,
        scope: HubScope,
        source_ids: List[str],
        last_message_at: str,
    ) -> None:
        self.service_client.table("chat_sessions").update(
            {
                "scope": scope.value,
                "source_ids": source_ids,
                "last_message_at": last_message_at,
            }
        ).eq("id", str(session_id)).execute()

    # Create a new chat session and its first user/assistant message pair through the service RPC.
    def _create_chat_session_with_messages(
        self,
        *,
        hub_id: str,
        user_id: str,
        title: str,
        scope: HubScope,
        source_ids: List[str],
        user_content: str,
        assistant_content: str,
        assistant_citations: List[Citation],
        assistant_token_usage: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        response = self.service_client.rpc(
            "create_chat_session_with_messages",
            {
                "p_hub_id": str(hub_id),
                "p_created_by": str(user_id),
                "p_title": title,
                "p_scope": scope.value,
                "p_source_ids": source_ids,
                "p_user_content": user_content,
                "p_assistant_content": assistant_content,
                "p_assistant_citations": [citation.model_dump() for citation in assistant_citations],
                "p_assistant_token_usage": assistant_token_usage,
            },
        ).execute()
        data = response.data or []
        if isinstance(data, dict):
            return data
        if not data:
            raise RuntimeError("Failed to create chat session.")
        return data[0]

    # -------------------------------------------------------------------------
    # Session read/write endpoints
    # -------------------------------------------------------------------------

    # List the current user's active chat sessions for a hub.
    def list_chat_sessions(self, client: Client, user_id: str, hub_id: str) -> List[ChatSessionSummary]:
        response = (
            client.table("chat_sessions")
            .select("id, hub_id, title, scope, source_ids, created_at, last_message_at")
            .eq("hub_id", str(hub_id))
            .eq("created_by", str(user_id))
            .is_("deleted_at", "null")
            .order("last_message_at", desc=True)
            .limit(50)
            .execute()
        )
        complete_source_ids = self._complete_source_ids_for_hub(client, hub_id)
        return [self._serialize_chat_session(row, complete_source_ids) for row in (response.data or [])]

    # Search recent chat titles and message content for one user's sessions in a hub.
    def search_chat_messages(
        self,
        client: Client,
        user_id: str,
        hub_id: str,
        query: str,
        limit: int = 8,
    ) -> List[ChatSearchResult]:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip())
        if len(normalized_query) < 2:
            return []

        sessions_response = (
            client.table("chat_sessions")
            .select("id, hub_id, title, last_message_at")
            .eq("hub_id", str(hub_id))
            .eq("created_by", str(user_id))
            .is_("deleted_at", "null")
            .order("last_message_at", desc=True)
            .limit(200)
            .execute()
        )
        session_rows = sessions_response.data or []
        if not session_rows:
            return []

        session_lookup = {str(row["id"]): row for row in session_rows}
        session_ids = list(session_lookup.keys())
        pattern = f"%{_escape_ilike_pattern(normalized_query)}%"
        results: List[ChatSearchResult] = []

        # Search session titles first so strong title matches can rank highly even without a message hit.
        for session in session_rows:
            session_title = str(session.get("title") or "New Chat")
            title_snippet, matched_text = _build_search_snippet(session_title, normalized_query, radius=20)
            if not title_snippet:
                continue
            results.append(
                ChatSearchResult(
                    session_id=str(session.get("id") or ""),
                    session_title=session_title,
                    hub_id=str(session.get("hub_id") or hub_id),
                    message_id=None,
                    matched_role="title",
                    snippet=title_snippet,
                    matched_text=matched_text,
                    created_at=session.get("last_message_at") or datetime.now(timezone.utc).isoformat(),
                )
            )

        messages_response = (
            client.table("messages")
            .select("id, session_id, role, content, created_at")
            .in_("session_id", session_ids)
            .ilike("content", pattern)
            .order("created_at", desc=True)
            .limit(200)
            .execute()
        )

        for row in messages_response.data or []:
            session_id = str(row.get("session_id") or "")
            session = session_lookup.get(session_id)
            if not session:
                continue
            content = str(row.get("content") or "")
            snippet, matched_text = _build_search_snippet(content, normalized_query)
            if not snippet:
                continue
            results.append(
                ChatSearchResult(
                    session_id=session_id,
                    session_title=str(session.get("title") or "New Chat"),
                    hub_id=str(session.get("hub_id") or hub_id),
                    message_id=str(row.get("id") or ""),
                    matched_role=str(row.get("role") or "assistant"),
                    snippet=snippet,
                    matched_text=matched_text,
                    created_at=row.get("created_at") or datetime.now(timezone.utc).isoformat(),
                )
            )

        results.sort(
            key=lambda item: (
                _chat_search_score(
                    item.session_title,
                    item.snippet,
                    item.matched_text or normalized_query,
                    item.matched_role,
                ),
                str(item.created_at),
            ),
            reverse=True,
        )
        return results[:limit]

    # Return a chat session along with its messages, moderation metadata, and feedback metadata.
    def get_chat_session_with_messages(
        self,
        client: Client,
        user_id: str,
        hub_id: str,
        session_id: str,
    ) -> ChatSessionDetail:
        row = self._get_chat_session_row(client, session_id)
        if str(row["hub_id"]) != str(hub_id):
            raise KeyError("Chat session not found")
        complete_source_ids = self._complete_source_ids_for_hub(client, hub_id)
        session = self._serialize_chat_session(row, complete_source_ids)
        messages = self._list_session_messages(client, session_id)
        assistant_message_ids = [str(message["id"]) for message in messages if message.get("role") == "assistant"]
        flag_metadata = self._message_flag_metadata(assistant_message_ids)
        feedback_metadata = self._message_feedback_map_for_user(assistant_message_ids, user_id)
        return ChatSessionDetail(
            session=session,
            messages=[self._serialize_session_message(message, flag_metadata, feedback_metadata) for message in messages],
        )

    # Rename one owned chat session.
    def rename_chat_session(self, client: Client, user_id: str, session_id: str, title: str) -> None:
        self._require_chat_session_owner(client, user_id, session_id)
        self.service_client.table("chat_sessions").update(
            {"title": title}
        ).eq("id", str(session_id)).is_("deleted_at", "null").execute()

    # Soft-delete one owned chat session.
    def delete_chat_session(self, client: Client, user_id: str, session_id: str) -> None:
        row = self._require_chat_session_owner(client, user_id, session_id, include_deleted=True)
        if str(row.get("deleted_at") or "").strip():
            return
        self.service_client.table("chat_sessions").update(
            {"deleted_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", str(session_id)).is_("deleted_at", "null").execute()

    # -------------------------------------------------------------------------
    # Chat event logging
    # -------------------------------------------------------------------------

    # Confirm that a user can access a hub either as owner or accepted member.
    def _require_hub_access(self, user_id: str, hub_id: str) -> None:
        hub_response = (
            self.service_client.table("hubs")
            .select("id, owner_id")
            .eq("id", str(hub_id))
            .limit(1)
            .execute()
        )
        if not hub_response.data:
            raise KeyError("Hub not found")
        if str(hub_response.data[0].get("owner_id") or "") == str(user_id):
            return

        member_response = (
            self.service_client.table("hub_members")
            .select("accepted_at")
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
        if not member_response.data or not member_response.data[0].get("accepted_at"):
            raise PermissionError("Hub access required.")

    # Insert one analytics/chat event row.
    def _insert_chat_event(
        self,
        client: Client,
        *,
        hub_id: str,
        user_id: str,
        event_type: str,
        session_id: Optional[str] = None,
        message_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        response = (
            client.table("chat_events")
            .insert(
                {
                    "hub_id": str(hub_id),
                    "session_id": str(session_id) if session_id else None,
                    "message_id": str(message_id) if message_id else None,
                    "user_id": str(user_id),
                    "event_type": str(event_type),
                    "metadata": metadata or {},
                }
            )
            .execute()
        )
        return (response.data or [{}])[0]

    # Insert a chat event without allowing analytics failures to break the request path.
    def _insert_chat_event_best_effort(self, client: Client, **kwargs: Any) -> Optional[Dict[str, Any]]:
        try:
            return self._insert_chat_event(client, **kwargs)
        except Exception:
            logger.exception(
                "chat.analytics_event_insert_failed",
                extra={
                    "hub_id": kwargs.get("hub_id"),
                    "session_id": kwargs.get("session_id"),
                    "message_id": kwargs.get("message_id"),
                    "user_id": kwargs.get("user_id"),
                    "event_type": kwargs.get("event_type"),
                },
            )
            return None

    # Validate and create one explicit chat event requested by the API.
    def create_chat_event(self, client: Client, user_id: str, payload: ChatEventCreate) -> ChatEventResponse:
        self._require_hub_access(user_id, str(payload.hub_id))
        if payload.session_id is not None:
            session_row = self._require_chat_session_owner(
                client,
                user_id,
                str(payload.session_id),
                include_deleted=True,
            )
            if str(session_row.get("hub_id") or "") != str(payload.hub_id):
                raise ValueError("Chat session does not belong to this hub.")
        if payload.message_id is not None:
            message_row = self._visible_message_for_user(client, str(payload.message_id))
            session_row = self._require_chat_session_owner(
                client,
                user_id,
                str(message_row["session_id"]),
                include_deleted=True,
            )
            if str(session_row.get("hub_id") or "") != str(payload.hub_id):
                raise ValueError("Message does not belong to this hub.")
            if payload.session_id is not None and str(message_row["session_id"]) != str(payload.session_id):
                raise ValueError("Message does not belong to this chat session.")
        inserted = self._insert_chat_event(
            client,
            hub_id=str(payload.hub_id),
            user_id=user_id,
            event_type=payload.event_type.value,
            session_id=str(payload.session_id) if payload.session_id else None,
            message_id=str(payload.message_id) if payload.message_id else None,
            metadata=payload.metadata,
        )
        self.log_activity(
            client,
            str(payload.hub_id),
            user_id,
            payload.event_type.value,
            "chat_event",
            str(payload.message_id or payload.session_id or payload.hub_id),
            payload.metadata,
        )
        return ChatEventResponse(
            event_type=ChatEventType(inserted.get("event_type") or payload.event_type.value),
            created_at=inserted.get("created_at") or datetime.now(timezone.utc),
        )

    # -------------------------------------------------------------------------
    # Retrieval and answer generation
    # -------------------------------------------------------------------------

    # Select the final retrieval matches used to build citations and answer context.
    def _select_matches(
        self,
        raw_matches: List[Dict[str, Any]],
        query_embedding: List[float],
        min_similarity: float,
        max_citations: int,
        fallback_mode: str,
        question_text: str = "",
    ) -> List[Dict[str, Any]]:
        question_preview = _preview_text(question_text)
        top_raw_similarity = max((float(match.get("similarity") or 0) for match in raw_matches), default=0.0)

        def _log(path: str, count: int) -> None:
            logger.info(
                "chat.select_matches mode=%s path=%s top_sim=%.3f raw=%d kept=%d threshold=%.2f q=%r",
                fallback_mode,
                path,
                top_raw_similarity,
                len(raw_matches),
                count,
                min_similarity,
                question_preview,
            )

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
                    selected = self._strip_rerank_metadata(filtered_matches[:max_citations])
                    _log("filtered", len(selected))
                    return selected
                selected = self._strip_rerank_metadata(reranked_matches[:1])
                _log("top1_reranked", len(selected))
                return selected
            if raw_matches:
                _log("top1_raw", 1)
                return raw_matches[:1]
            _log("none", 0)
            return []

        filtered_matches = [match for match in raw_matches if float(match.get("similarity") or 0) >= min_similarity]
        if filtered_matches:
            selected = self._strip_rerank_metadata(self._rerank_matches(filtered_matches, query_embedding, max_citations))
            _log("filtered", len(selected))
            return selected
        if fallback_mode == "guide" and raw_matches:
            _log("topN_raw", len(raw_matches[:max_citations]))
            return raw_matches[:max_citations]
        _log("none", 0)
        return []

    # Rerank retrieval matches with similarity and diversity-aware scoring.
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

    # Strip helper metadata before matches are turned into citations or returned from helper flows.
    def _strip_rerank_metadata(self, matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        cleaned: List[Dict[str, Any]] = []
        for candidate in matches:
            row = dict(candidate)
            row.pop("_rank", None)
            row.pop("_normalized_embedding", None)
            row.pop("_query_similarity", None)
            cleaned.append(row)
        return cleaned

    # Decide whether a chat question benefits from diversified multi-source retrieval.
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

    # Score one candidate during max-marginal-relevance reranking.
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

    # Rewrite a vague follow-up into a standalone retrieval query using recent conversation and citations.
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

    # Generate a short title for a new chat session from its first user message.
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

    # Retrieve the raw matches and the final citation/context block list for one question.
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

    # Run the full chat-answer pipeline: rewrite, retrieve, optionally retry, and generate the final answer.
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

        # First try rewriting context-dependent follow-up questions into a better retrieval query.
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

        # Retrieve initial context using the chosen query.
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

        # If the first retrieval missed entirely, attempt one rewrite-based fallback.
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

        # For multi-source grounded follow-ups, try an anchored query if the first result set collapses to one source.
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

        # Global-scope chats can use web search as a supplement to hub context.
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
            generation_metadata["answer_status"] = "answered"
            return answer, all_citations, usage, generation_metadata

        system_prompt = _hub_answer_system_prompt()
        user_prompt = f"Question: {question}\n\nContext:\n" + "\n".join(context_blocks)

        # If no hub context is available, abstain instead of hallucinating an answer.
        if not context_blocks:
            answer = _HUB_ABSTAIN_ANSWER
            usage = None
            if trace:
                with trace.step("answer_generation", scope=scope.value, context_block_count=0) as step:
                    step.output = {"total_tokens": 0, "abstained": True}
            generation_metadata["answer_has_citations"] = False
            generation_metadata["answer_status"] = "abstained"
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

        # Retry once with a stricter repair prompt if the model answered but failed to ground its claims.
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

        # Last-resort fallback for grounded answers that lost their citations; pick the citation
        # whose snippet has the strongest token overlap with the answer rather than always citations[0],
        # and abstain from attributing anything if no snippet has meaningful overlap.
        used_safety_net = False
        safety_net_best_score = 0.0
        if (
            context_blocks
            and citations
            and not final_citations
            and _looks_like_grounded_answer(answer)
            and len(answer) >= 100
        ):
            scored = [(c, _score_answer_snippet_overlap(answer, c.snippet)) for c in citations]
            best_citation, safety_net_best_score = max(scored, key=lambda pair: pair[1])
            if safety_net_best_score >= self.chat_safety_net_min_overlap:
                final_citations = [best_citation.model_copy(deep=True)]
                used_safety_net = True
        generation_metadata["answer_has_citations"] = bool(final_citations)
        generation_metadata["retried_for_citations"] = retried_for_citations
        generation_metadata["used_safety_net"] = used_safety_net
        generation_metadata["safety_net_best_score"] = round(safety_net_best_score, 3)
        # Treat abstain-shaped answers with no citations as abstains so the frontend can show the right empty-state copy.
        if not final_citations and not _looks_like_grounded_answer(answer):
            generation_metadata["answer_status"] = "abstained"
        else:
            generation_metadata["answer_status"] = "answered"
        return answer, final_citations, usage, generation_metadata

    # Extract verified citations from the model's answer-plus-QUOTES payload.
    def _extract_grounded_chat_citations(
        self,
        raw_answer: str,
        citations: List[Citation],
    ) -> tuple[str, List[Citation]]:
        answer, quotes = _extract_quotes(raw_answer)
        hydrated_citations = [citation.model_copy(deep=True) for citation in citations]
        verified_quote_indices: List[int] = []
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
                    verified_quote_indices.append(citation_idx + 1)
        inline_indices = _referenced_citation_indices(answer, len(hydrated_citations))
        referenced_indices = inline_indices
        # Fall back to QUOTES indices when inline [n] markers are missing; gated on verified quotes to avoid hallucinated pills.
        used_quotes_fallback = False
        if not referenced_indices and verified_quote_indices:
            referenced_indices = list(dict.fromkeys(verified_quote_indices))
            used_quotes_fallback = True
        final_citations = [hydrated_citations[idx - 1] for idx in referenced_indices]
        logger.info(
            "chat.citation_extract inline=%d quotes_keys=%d verified=%d final=%d quotes_fallback=%s",
            len(inline_indices),
            len(quotes),
            len(verified_quote_indices),
            len(final_citations),
            used_quotes_fallback,
        )
        return answer, final_citations

    # Call the chat model with the provided prompts and optional trace instrumentation.
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
        usage_payload = completion.usage.model_dump() if completion.usage else None
        content = completion.choices[0].message.content
        if not content:
            logger.warning(
                "chat.empty_completion model=%s total_tokens=%s",
                self.chat_model,
                _total_tokens_from_usage(usage_payload),
            )
            return _HUB_ABSTAIN_ANSWER, usage_payload
        return content, usage_payload

    # -------------------------------------------------------------------------
    # Main chat execution and feedback flows
    # -------------------------------------------------------------------------

    # Execute one chat turn, persisting the session/messages and analytics events around the generated answer.
    def chat(self, client: Client, user_id: str, payload: ChatRequest) -> ChatResponse:
        hub_id = str(payload.hub_id)
        requested_source_ids = None if payload.source_ids is None else [str(source_id) for source_id in payload.source_ids]
        persisted_source_ids, retrieval_source_ids = self._normalize_chat_source_ids(
            client,
            hub_id,
            requested_source_ids,
        )
        started_at = time.perf_counter()

        # Detect greetings/thanks early so we can skip history loads and the LLM-generated title for them.
        smalltalk = _smalltalk_intent(payload.question)

        existing_session_id: Optional[str] = None
        session_title: str
        user_message_id: Optional[str] = None
        if payload.session_id is not None:
            existing_session_id = str(payload.session_id)
            session_row = self._get_chat_session_row(client, existing_session_id)
            if str(session_row["hub_id"]) != hub_id:
                raise KeyError("Chat session not found")
            session_title = str(session_row.get("title") or "New Chat")
            if smalltalk:
                history_messages = []
                retrieval_history = []
            else:
                history_messages = self._recent_conversation(client, existing_session_id)
                retrieval_history = self._recent_retrieval_context(client, existing_session_id)
            user_message_row = client.table("messages").insert(
                {"session_id": existing_session_id, "role": "user", "content": payload.question}
            ).execute()
            user_message_id = str(user_message_row.data[0]["id"])
        else:
            if smalltalk:
                session_title = _fallback_chat_session_title(payload.question)
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

        # Finalize persistence differently depending on whether this is a new session or an existing one.
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
                answer_status = generation_metadata.get("answer_status", "answered")
                self._persist_message_answer_status(assistant_message_id, answer_status)
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
                    answer_status=answer_status,
                )

            assistant_row = (
                client.table("messages")
                .insert(
                    {
                        "session_id": existing_session_id,
                        "role": "assistant",
                        "content": answer,
                        "citations": [citation.model_dump() for citation in response_citations],
                        "answer_status": generation_metadata.get("answer_status", "answered"),
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
                answer_status=generation_metadata.get("answer_status", "answered"),
            )

        # Bypass retrieval for greetings and short small-talk so they don't pull a hub source into the prompt.
        if smalltalk:
            smalltalk_metadata = {
                "retrieval_query": payload.question,
                "rewrite_attempted": False,
                "rewrite_used": False,
                "anchored_fallback_used": False,
                "raw_match_count": 0,
                "selected_citation_count": 0,
                "selected_source_ids": [],
                "zero_hit": False,
                "used_web_search": False,
                "no_context_available": False,
                "answer_has_citations": False,
                "answer_status": "greeting",
                "smalltalk_intent": smalltalk,
            }
            return finalize_response(_smalltalk_response(smalltalk), [], None, smalltalk_metadata)

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

    # Return the most recent active chat history for one user in one hub.
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

    # Upsert feedback for one assistant message and log the feedback event.
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
        self.log_activity(
            client,
            str(session_row["hub_id"]),
            user_id,
            "submitted",
            "chat_feedback",
            str(message_id),
            {"rating": payload.rating.value},
        )
        return ChatFeedbackResponse(
            message_id=str(message_id),
            rating=ChatFeedbackRating(str(row.get("rating") or payload.rating.value)),
            reason=row.get("reason") if isinstance(row, dict) else payload.reason,
            updated_at=row.get("updated_at") or datetime.now(timezone.utc),
        )

    # Record citation interaction feedback for one cited source on an assistant message.
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
        self.log_activity(
            client,
            str(session_row["hub_id"]),
            user_id,
            "submitted",
            "citation_feedback",
            str(message_id),
            {
                "source_id": payload.source_id,
                "chunk_index": payload.chunk_index,
                "event_type": payload.event_type.value,
            },
        )
        return CitationFeedbackResponse(
            message_id=str(message_id),
            source_id=str(row.get("source_id") or payload.source_id),
            chunk_index=row.get("chunk_index", payload.chunk_index),
            event_type=CitationFeedbackEventType(str(row.get("event_type") or payload.event_type.value)),
            created_at=row.get("created_at") or datetime.now(timezone.utc),
        )

    # Answer a global-scope question by combining hub context with the web-search tool when available.
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
