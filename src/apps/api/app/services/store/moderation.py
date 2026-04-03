"""ModerationStoreMixin: manages flagged messages, revision review, and moderation queue views."""

import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from ...schemas import (
    Citation,
    CreateRevisionRequest,
    FlagCase,
    FlagCaseStatus,
    FlagMessageRequest,
    FlagMessageResponse,
    FlaggedChatDetail,
    FlaggedChatQueueItem,
    HubScope,
    MembershipRole,
    MessageFlagStatus,
    MessageRevision,
    MessageRevisionType,
)
from .base import logger
from .chat_helpers import _preview_text


class ModerationStoreMixin:
    # Map each flagged assistant message to the user question that immediately preceded it.
    def _flagged_question_rows(
        self,
        session_ids: List[str],
        flagged_message_ids: set[str],
    ) -> Dict[str, Dict[str, Any]]:
        question_rows: Dict[str, Dict[str, Any]] = {}
        for session_id in session_ids:
            rows = self._list_session_messages(
                self.service_client,
                session_id,
                fields="id, role, content, citations, created_at",
            )
            previous: Optional[Dict[str, Any]] = None
            for row in rows:
                message_id = str(row["id"])
                if message_id in flagged_message_ids:
                    if previous is not None and str(previous.get("role") or "") == "user":
                        question_rows[message_id] = previous
                    previous = row
                    continue
                previous = row
        return question_rows

    # Convert one raw flag-case row into the API schema object.
    def _serialize_flag_case(self, row: Dict[str, Any]) -> FlagCase:
        return FlagCase(**row)

    # Convert one raw revision row and hydrate its nested citations.
    def _serialize_message_revision(self, row: Dict[str, Any]) -> MessageRevision:
        payload = dict(row)
        payload["citations"] = [Citation(**citation) for citation in (row.get("citations") or [])]
        return MessageRevision(**payload)

    # Return the latest moderation metadata for each assistant message id.
    def _message_flag_metadata(self, message_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        if not message_ids:
            return {}
        response = (
            self.service_client.table("message_flag_cases")
            .select("id,message_id,status,created_at")
            .in_("message_id", message_ids)
            .order("created_at", desc=True)
            .execute()
        )
        metadata: Dict[str, Dict[str, Any]] = {}
        for row in response.data or []:
            message_id = str(row["message_id"])
            if message_id in metadata:
                continue
            status_value = str(row.get("status") or FlagCaseStatus.open.value)
            active_flag_id = row["id"] if status_value in {FlagCaseStatus.open.value, FlagCaseStatus.in_review.value} else None
            metadata[message_id] = {"active_flag_id": active_flag_id, "flag_status": status_value}
        return metadata

    # Fetch one flag case row by id.
    def _get_flag_case_row(self, flag_case_id: str) -> Dict[str, Any]:
        response = self.service_client.table("message_flag_cases").select("*").eq("id", str(flag_case_id)).limit(1).execute()
        if not response.data:
            raise KeyError("Flag case not found")
        return response.data[0]

    # Return the currently active open or in-review flag case for a message, if any.
    def _get_active_flag_case_for_message(self, message_id: str) -> Optional[Dict[str, Any]]:
        response = (
            self.service_client.table("message_flag_cases")
            .select("*")
            .eq("message_id", str(message_id))
            .in_("status", [FlagCaseStatus.open.value, FlagCaseStatus.in_review.value])
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if not response.data:
            return None
        return response.data[0]

    # Fetch one saved revision row by id.
    def _get_revision_row(self, revision_id: str) -> Dict[str, Any]:
        response = self.service_client.table("message_revisions").select("*").eq("id", str(revision_id)).limit(1).execute()
        if not response.data:
            raise KeyError("Revision not found")
        return response.data[0]

    # Return the hub ids this user can moderate.
    def _moderated_hub_ids_for_user(self, user_id: str) -> List[str]:
        response = (
            self.service_client.table("hub_members")
            .select("hub_id")
            .eq("user_id", str(user_id))
            .not_.is_("accepted_at", "null")
            .in_("role", [MembershipRole.owner.value, MembershipRole.admin.value])
            .execute()
        )
        hub_ids: List[str] = []
        for row in response.data or []:
            hub_id = str(row.get("hub_id") or "")
            if hub_id and hub_id not in hub_ids:
                hub_ids.append(hub_id)
        return hub_ids

    # Enforce owner/admin moderation access for the target hub.
    def _require_moderation_access(self, user_id: str, hub_id: str) -> None:
        if str(hub_id) not in self._moderated_hub_ids_for_user(user_id):
            raise PermissionError("Owner or admin role required.")

    # Fetch the user question directly associated with a flagged assistant answer.
    def _question_for_flagged_message(self, session_id: str, message_id: str) -> Dict[str, Any]:
        rows = self._list_session_messages(
            self.service_client,
            session_id,
            fields="id, role, content, citations, created_at",
        )
        previous: Optional[Dict[str, Any]] = None
        for row in rows:
            if str(row["id"]) == str(message_id):
                break
            previous = row
        if previous is None or str(previous.get("role") or "") != "user":
            raise KeyError("Flagged question not found")
        return previous

    # Create a new flag case for an assistant message, or reuse the active one if it already exists.
    def flag_message(
        self,
        client: Any,
        user_id: str,
        message_id: str,
        payload: FlagMessageRequest,
    ) -> FlagMessageResponse:
        message_row = self._visible_message_for_user(client, message_id)
        if str(message_row.get("role") or "") != "assistant":
            raise ValueError("Only assistant messages can be flagged.")
        session_row = self._get_chat_session_row(client, str(message_row["session_id"]))
        self._require_hub_access(user_id, str(session_row["hub_id"]))
        active_case = self._get_active_flag_case_for_message(message_id)
        if active_case is not None:
            return FlagMessageResponse(
                flag_case=self._serialize_flag_case(active_case),
                created=False,
            )
        try:
            created = self.service_client.rpc(
                "create_message_flag_case_with_original_revision",
                {
                    "p_message_id": str(message_row["id"]),
                    "p_created_by": str(user_id),
                    "p_reason": payload.reason.value,
                    "p_notes": payload.notes,
                },
            ).execute()
        except Exception as exc:
            message = (getattr(exc, "message", "") or str(exc)).lower()
            code = str(getattr(exc, "code", "") or "")
            if code == "23505" or "duplicate key" in message or "unique" in message:
                existing_case = self._get_active_flag_case_for_message(message_id)
                if existing_case is not None:
                    return FlagMessageResponse(
                        flag_case=self._serialize_flag_case(existing_case),
                        created=False,
                    )
            raise
        data = created.data or []
        if isinstance(data, dict):
            case_row = data
        elif data:
            case_row = data[0]
        else:
            raise RuntimeError("Failed to create flag case.")
        return FlagMessageResponse(
            flag_case=self._serialize_flag_case(case_row),
            created=True,
        )

    # Return all revisions attached to a moderation case in creation order.
    def _list_flag_case_revisions(self, flag_case_id: str) -> List[MessageRevision]:
        response = (
            self.service_client.table("message_revisions")
            .select("*")
            .eq("flag_case_id", str(flag_case_id))
            .order("created_at", desc=False)
            .execute()
        )
        return [self._serialize_message_revision(row) for row in (response.data or [])]

    # Retry a small number of transient service-role reads before surfacing the error.
    def _execute_service_query_with_retry(self, query_fn, *, attempts: int = 3, delay_seconds: float = 0.2):
        last_error: Optional[Exception] = None
        for attempt in range(attempts):
            try:
                return query_fn()
            except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ReadTimeout) as exc:
                last_error = exc
                if attempt == attempts - 1:
                    raise
                time.sleep(delay_seconds * (attempt + 1))
        if last_error is not None:
            raise last_error
        raise RuntimeError("Retry helper exited without a result.")

    # Reject edits to already resolved moderation cases.
    def _ensure_flag_case_open(self, case_row: Dict[str, Any]) -> None:
        if str(case_row.get("status") or "") not in {FlagCaseStatus.open.value, FlagCaseStatus.in_review.value}:
            raise ValueError("Closed flag cases cannot be edited.")

    # Gather the session, question, history, and source context needed to regenerate a flagged answer.
    def _flag_case_generation_context(
        self,
        flag_case_row: Dict[str, Any],
    ) -> tuple[Dict[str, Any], Dict[str, Any], List[Dict[str, str]], List[Dict[str, Any]], Optional[List[str]]]:
        session_row = self._get_chat_session_row(self.service_client, str(flag_case_row["session_id"]), include_deleted=True)
        self._service_message_row(str(flag_case_row["message_id"]))
        question_row = self._question_for_flagged_message(str(flag_case_row["session_id"]), str(flag_case_row["message_id"]))
        session_rows = self._list_session_messages(
            self.service_client,
            str(flag_case_row["session_id"]),
            fields="id, role, content, citations, created_at",
        )
        prior_rows: List[Dict[str, Any]] = []
        for row in session_rows:
            if str(row["id"]) == str(question_row["id"]):
                break
            prior_rows.append(row)
        history_messages = self._conversation_from_message_rows(prior_rows)
        retrieval_history = self._retrieval_context_from_message_rows(prior_rows)
        source_ids = [str(source_id) for source_id in (session_row.get("source_ids") or [])]
        return session_row, question_row, history_messages, retrieval_history, source_ids

    # Return the moderation queue view for one hub.
    def list_flagged_chat_queue(
        self,
        user_id: str,
        hub_id: str,
        *,
        status_filter: Optional[FlagCaseStatus] = None,
    ) -> List[FlaggedChatQueueItem]:
        self._require_moderation_access(user_id, hub_id)
        query = self.service_client.table("message_flag_cases").select("*").eq("hub_id", str(hub_id))
        if status_filter is not None:
            query = query.eq("status", status_filter.value)
        response = query.order("created_at", desc=True).execute()
        hubs_response = self.service_client.table("hubs").select("id,name").eq("id", str(hub_id)).limit(1).execute()
        hub_name = str((hubs_response.data or [{}])[0].get("name") or "Hub")
        flag_rows = response.data or []
        session_rows = self._service_chat_session_rows([str(row["session_id"]) for row in flag_rows])
        message_rows = self._service_message_rows([str(row["message_id"]) for row in flag_rows])
        question_rows = self._flagged_question_rows(list({str(row["session_id"]) for row in flag_rows}), {str(row["message_id"]) for row in flag_rows})

        # Only include items where the supporting session, flagged answer, and triggering question can all be resolved.
        items: List[FlaggedChatQueueItem] = []
        for row in flag_rows:
            session_row = session_rows.get(str(row["session_id"]))
            message_row = message_rows.get(str(row["message_id"]))
            question_row = question_rows.get(str(row["message_id"]))
            if session_row is None or message_row is None or question_row is None:
                continue
            items.append(
                FlaggedChatQueueItem(
                    id=str(row["id"]),
                    hub_id=str(row["hub_id"]),
                    hub_name=hub_name,
                    session_id=str(row["session_id"]),
                    session_title=str(session_row.get("title") or "New Chat"),
                    message_id=str(row["message_id"]),
                    question_preview=_preview_text(question_row.get("content")),
                    answer_preview=_preview_text(message_row.get("content")),
                    reason=row["reason"],
                    status=row["status"],
                    flagged_at=row["created_at"],
                    reviewed_at=row.get("reviewed_at"),
                )
            )
        return items

    def _get_flag_case_for_hub(self, user_id: str, hub_id: str, flag_case_id: str) -> Dict[str, Any]:
        self._require_moderation_access(user_id, hub_id)
        case_row = self._get_flag_case_row(flag_case_id)
        if str(case_row.get("hub_id") or "") != str(hub_id):
            raise KeyError("Flag case not found")
        return case_row

    def get_flagged_chat_detail(self, user_id: str, hub_id: str, flag_case_id: str) -> FlaggedChatDetail:
        case_row = self._get_flag_case_for_hub(user_id, hub_id, flag_case_id)
        hub_response = self.service_client.table("hubs").select("id,name").eq("id", str(case_row["hub_id"])).limit(1).execute()
        hub_name = str((hub_response.data or [{}])[0].get("name") or "Hub")
        session_row = self._get_chat_session_row(self.service_client, str(case_row["session_id"]), include_deleted=True)
        question_row = self._question_for_flagged_message(str(case_row["session_id"]), str(case_row["message_id"]))
        message_row = self._service_message_row(str(case_row["message_id"]))
        flag_metadata = self._message_flag_metadata([str(case_row["message_id"])])
        return FlaggedChatDetail(
            case=self._serialize_flag_case(case_row),
            hub_name=hub_name,
            session_title=str(session_row.get("title") or "New Chat"),
            question_message=self._serialize_session_message(question_row),
            flagged_message=self._serialize_session_message(message_row, flag_metadata),
            revisions=self._list_flag_case_revisions(str(flag_case_id)),
        )

    def regenerate_flagged_chat_revision(self, user_id: str, hub_id: str, flag_case_id: str) -> MessageRevision:
        case_row = self._get_flag_case_for_hub(user_id, hub_id, flag_case_id)
        self._ensure_flag_case_open(case_row)
        session_row, question_row, history_messages, retrieval_history, source_ids = self._flag_case_generation_context(case_row)
        answer, citations, _usage, _generation_metadata = self._generate_chat_answer(
            self.service_client,
            hub_id=str(case_row["hub_id"]),
            question=str(question_row["content"]),
            scope=HubScope(session_row.get("scope") or HubScope.hub.value),
            retrieval_source_ids=source_ids,
            history_messages=history_messages,
            retrieval_history=retrieval_history,
        )
        inserted = (
            self.service_client.table("message_revisions")
            .insert(
                {
                    "message_id": case_row["message_id"],
                    "flag_case_id": case_row["id"],
                    "revision_type": MessageRevisionType.regenerated.value,
                    "content": answer,
                    "citations": [citation.model_dump() for citation in citations],
                    "created_by": str(user_id),
                }
            )
            .execute()
        )
        if not inserted.data:
            raise RuntimeError("Failed to create regenerated revision.")
        if str(case_row.get("status") or "") == FlagCaseStatus.open.value:
            self.service_client.table("message_flag_cases").update({"status": FlagCaseStatus.in_review.value}).eq("id", str(flag_case_id)).execute()
        return self._serialize_message_revision(inserted.data[0])

    def create_flagged_chat_revision(
        self,
        user_id: str,
        hub_id: str,
        flag_case_id: str,
        payload: CreateRevisionRequest,
    ) -> MessageRevision:
        case_row = self._get_flag_case_for_hub(user_id, hub_id, flag_case_id)
        self._ensure_flag_case_open(case_row)
        inserted = (
            self.service_client.table("message_revisions")
            .insert(
                {
                    "message_id": case_row["message_id"],
                    "flag_case_id": case_row["id"],
                    "revision_type": MessageRevisionType.manual_edit.value,
                    "content": payload.content,
                    "citations": [citation.model_dump() for citation in payload.citations],
                    "created_by": str(user_id),
                }
            )
            .execute()
        )
        if not inserted.data:
            raise RuntimeError("Failed to create manual revision.")
        if str(case_row.get("status") or "") == FlagCaseStatus.open.value:
            self.service_client.table("message_flag_cases").update({"status": FlagCaseStatus.in_review.value}).eq("id", str(flag_case_id)).execute()
        return self._serialize_message_revision(inserted.data[0])

    def apply_flagged_chat_revision(self, user_id: str, hub_id: str, flag_case_id: str, revision_id: str) -> FlagCase:
        case_row = self._get_flag_case_for_hub(user_id, hub_id, flag_case_id)
        self._ensure_flag_case_open(case_row)
        revision_row = self._get_revision_row(revision_id)
        if str(revision_row["flag_case_id"]) != str(flag_case_id):
            raise ValueError("Revision does not belong to this flag case.")
        if str(revision_row.get("revision_type") or "") == MessageRevisionType.original.value:
            raise ValueError("Original snapshots cannot be applied.")
        updated = self.service_client.rpc(
            "apply_message_revision_and_resolve_flag_case",
            {
                "p_flag_case_id": str(flag_case_id),
                "p_revision_id": str(revision_id),
                "p_reviewed_by": str(user_id),
            },
        ).execute()
        data = updated.data or []
        if isinstance(data, dict):
            return self._serialize_flag_case(data)
        if not data:
            raise RuntimeError("Failed to resolve flag case.")
        return self._serialize_flag_case(data[0])

    def dismiss_flagged_chat(self, user_id: str, hub_id: str, flag_case_id: str) -> FlagCase:
        case_row = self._get_flag_case_for_hub(user_id, hub_id, flag_case_id)
        self._ensure_flag_case_open(case_row)
        now = datetime.now(timezone.utc).isoformat()
        updated = (
            self.service_client.table("message_flag_cases")
            .update({"status": FlagCaseStatus.dismissed.value, "reviewed_by": str(user_id), "reviewed_at": now})
            .eq("id", str(flag_case_id))
            .execute()
        )
        if not updated.data:
            raise RuntimeError("Failed to dismiss flag case.")
        return self._serialize_flag_case(updated.data[0])
