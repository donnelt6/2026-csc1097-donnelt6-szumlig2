import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import PurePath
from urllib.parse import parse_qs, urlparse
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI
from supabase import Client, create_client

from ..core.config import get_settings
from ..schemas import (
    ChatRequest,
    ChatResponse,
    Citation,
    FaqEntry,
    FaqGenerateRequest,
    HistoryMessage,
    GuideEntry,
    GuideGenerateRequest,
    GuideStep,
    GuideStepCreateRequest,
    GuideStepProgressUpdate,
    GuideStepWithProgress,
    Hub,
    HubCreate,
    HubInviteRequest,
    HubMember,
    HubScope,
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
    SourceStatus,
    SourceStatusResponse,
    SourceType,
    WebSourceCreate,
    YouTubeSourceCreate,
)


class SupabaseStore:
    """Supabase-backed store for hubs, sources, and chat."""

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
        self.faq_default_count = settings.faq_default_count
        self.faq_context_chunks_per_source = settings.faq_context_chunks_per_source
        self.faq_max_citations = settings.faq_max_citations
        self.faq_min_similarity = settings.faq_min_similarity
        self.guide_default_steps = settings.guide_default_steps
        self.guide_context_chunks_per_source = settings.guide_context_chunks_per_source
        self.guide_max_citations = settings.guide_max_citations
        self.guide_min_similarity = settings.guide_min_similarity
        self.service_client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        self.llm_client = OpenAI(api_key=settings.openai_api_key)

    def list_hubs(self, client: Client, user_id: str) -> List[Hub]:
        response = (
            client.table("hub_members")
            .select("role, last_accessed_at, is_favourite, hubs (id, owner_id, name, description, created_at, members_count, sources_count)")
            .eq("user_id", user_id)
            .not_.is_("accepted_at", "null")
            .order("last_accessed_at", desc=True)
            .execute()
        )
        hubs: List[Hub] = []
        for row in response.data:
            hub_row = row.get("hubs") or {}
            hub_row["role"] = row.get("role")
            hub_row["last_accessed_at"] = row.get("last_accessed_at")
            hub_row["is_favourite"] = row.get("is_favourite")
            hubs.append(Hub(**hub_row))
        return hubs

    def create_hub(self, client: Client, user_id: str, payload: HubCreate) -> Hub:
        response = (
            client.table("hubs")
            .insert({"owner_id": user_id, "name": payload.name, "description": payload.description})
            .execute()
        )
        row = response.data[0]
        now = datetime.now(timezone.utc).isoformat()
        client.table("hub_members").insert(
            {
                "hub_id": row["id"],
                "user_id": user_id,
                "role": MembershipRole.owner.value,
                "accepted_at": now,
                "last_accessed_at": now,
                "is_favourite": True,
            }
        ).execute()
        row["role"] = MembershipRole.owner.value
        row["last_accessed_at"] = now
        row["is_favourite"] = True
        return Hub(**row)

    def create_source(self, client: Client, payload: SourceCreate) -> Tuple[Source, str]:
        source_id = str(uuid.uuid4())
        hub_id = str(payload.hub_id)
        safe_name = _sanitize_filename(payload.original_name)
        # Use a sanitized filename for storage paths to avoid path traversal edge cases.
        storage_path = f"{hub_id}/{source_id}/{safe_name}"
        response = (
            client.table("sources")
            .insert(
                {
                    "id": source_id,
                    "hub_id": hub_id,
                    "original_name": payload.original_name,
                    "storage_path": storage_path,
                    "status": SourceStatus.queued.value,
                    "type": SourceType.file.value,
                }
            )
            .execute()
        )
        row = response.data[0]

        try:
            upload_url = self.create_upload_url(storage_path)
        except Exception:  
            try:
                client.table("sources").delete().eq("id", source_id).execute()
            except Exception:  
                pass
            raise

        return Source(**row), upload_url

    def create_web_source(self, client: Client, payload: WebSourceCreate) -> Source:
        source_id = str(uuid.uuid4())
        hub_id = str(payload.hub_id)
        storage_path = _web_storage_path(hub_id, source_id)
        display_name = _build_web_source_name(payload.url)
        response = (
            client.table("sources")
            .insert(
                {
                    "id": source_id,
                    "hub_id": hub_id,
                    "type": SourceType.web.value,
                    "original_name": display_name,
                    "storage_path": storage_path,
                    "status": SourceStatus.queued.value,
                    "ingestion_metadata": {"url": payload.url},
                }
            )
            .execute()
        )
        row = response.data[0]
        return Source(**row)

    def create_youtube_source(self, client: Client, payload: YouTubeSourceCreate) -> Source:
        source_id = str(uuid.uuid4())
        hub_id = str(payload.hub_id)
        video_id = _extract_youtube_video_id(payload.url)
        if not video_id:
            raise ValueError("Unable to extract YouTube video ID")
        storage_path = _youtube_storage_path(hub_id, source_id)
        display_name = _build_youtube_source_name(payload.url, video_id)
        metadata = {
            "url": payload.url,
            "video_id": video_id,
            "allow_auto_captions": payload.allow_auto_captions,
        }
        if payload.language:
            metadata["language"] = payload.language
        response = (
            client.table("sources")
            .insert(
                {
                    "id": source_id,
                    "hub_id": hub_id,
                    "type": SourceType.youtube.value,
                    "original_name": display_name,
                    "storage_path": storage_path,
                    "status": SourceStatus.queued.value,
                    "ingestion_metadata": metadata,
                }
            )
            .execute()
        )
        row = response.data[0]
        return Source(**row)

    def list_sources(self, client: Client, hub_id: str) -> List[Source]:
        response = (
            client.table("sources")
            .select("*")
            .eq("hub_id", str(hub_id))
            .order("created_at", desc=True)
            .execute()
        )
        return [Source(**row) for row in response.data]

    def get_source(self, client: Client, source_id: str) -> Source:
        response = client.table("sources").select("*").eq("id", str(source_id)).limit(1).execute()
        if not response.data:
            raise KeyError("Source not found")
        return Source(**response.data[0])

    def delete_source(self, client: Client, source_id: str) -> None:
        source = self.get_source(client, source_id)
        response = client.table("sources").delete().eq("id", str(source_id)).execute()
        if not response.data:
            raise KeyError("Source not found")
        if source.storage_path:
            try:
                self.service_client.storage.from_(self.storage_bucket).remove([source.storage_path])
            except Exception:
                # Storage cleanup failure should not block source deletion.
                pass

    def set_source_status(self, client: Client, source_id: str, status: SourceStatus, failure_reason: Optional[str] = None) -> Source:
        response = (
            client.table("sources")
            .update({"status": status.value, "failure_reason": failure_reason})
            .eq("id", str(source_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Source not found")
        row = response.data[0]
        return Source(**row)

    def refresh_source(self, client: Client, source_id: str) -> tuple[Source, dict]:
        source = self.get_source(client, source_id)
        if source.type == SourceType.web:
            refreshed, url = self.refresh_web_source(client, source_id, source)
            return refreshed, {"type": SourceType.web.value, "url": url}
        if source.type == SourceType.youtube:
            refreshed, info = self.refresh_youtube_source(client, source_id, source)
            info["type"] = SourceType.youtube.value
            return refreshed, info
        raise ValueError("Source type does not support refresh")

    def refresh_web_source(self, client: Client, source_id: str, source: Optional[Source] = None) -> tuple[Source, str]:
        if source is None:
            source = self.get_source(client, source_id)
        if source.type != SourceType.web:
            raise ValueError("Source is not a web URL")
        url = None
        if isinstance(source.ingestion_metadata, dict):
            url = source.ingestion_metadata.get("url")
        if not url:
            raise ValueError("Source URL missing")
        new_path = _web_storage_path(source.hub_id, source.id)
        metadata = dict(source.ingestion_metadata or {})
        metadata["url"] = url
        metadata["refresh_requested_at"] = datetime.now(timezone.utc).isoformat()
        response = (
            client.table("sources")
            .update(
                {
                    "storage_path": new_path,
                    "status": SourceStatus.queued.value,
                    "failure_reason": None,
                    "ingestion_metadata": metadata,
                }
            )
            .eq("id", str(source_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Source not found")
        return Source(**response.data[0]), url

    def refresh_youtube_source(self, client: Client, source_id: str, source: Optional[Source] = None) -> tuple[Source, dict]:
        if source is None:
            source = self.get_source(client, source_id)
        if source.type != SourceType.youtube:
            raise ValueError("Source is not a YouTube URL")
        metadata = source.ingestion_metadata if isinstance(source.ingestion_metadata, dict) else {}
        url = metadata.get("url")
        if not url:
            raise ValueError("Source URL missing")
        video_id = metadata.get("video_id") or _extract_youtube_video_id(url)
        if not video_id:
            raise ValueError("Source video ID missing")
        language = metadata.get("language")
        allow_auto_captions = bool(metadata.get("allow_auto_captions", False))
        new_path = _youtube_storage_path(source.hub_id, source.id)
        refreshed_metadata = dict(metadata)
        refreshed_metadata.update(
            {
                "url": url,
                "video_id": video_id,
                "language": language,
                "allow_auto_captions": allow_auto_captions,
                "refresh_requested_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        response = (
            client.table("sources")
            .update(
                {
                    "storage_path": new_path,
                    "status": SourceStatus.queued.value,
                    "failure_reason": None,
                    "ingestion_metadata": refreshed_metadata,
                }
            )
            .eq("id", str(source_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Source not found")
        return Source(**response.data[0]), {
            "url": url,
            "video_id": video_id,
            "language": language,
            "allow_auto_captions": allow_auto_captions,
        }

    def get_source_status(self, client: Client, source_id: str) -> SourceStatusResponse:
        response = client.table("sources").select("id,status,failure_reason").eq("id", str(source_id)).execute()
        if not response.data:
            raise KeyError("Source not found")
        row = response.data[0]
        return SourceStatusResponse(id=row["id"], status=row["status"], failure_reason=row.get("failure_reason"))

    def create_upload_url(self, storage_path: str) -> str:
        upload = self.service_client.storage.from_(self.storage_bucket).create_signed_upload_url(storage_path)
        upload_url = upload.get("signedURL") or upload.get("signedUrl") or upload.get("signed_url")
        if not upload_url:
            raise RuntimeError("Failed to create signed upload URL")
        return upload_url

    def get_member_role(self, client: Client, hub_id: str, user_id: str) -> HubMember:
        response = (
            client.table("hub_members")
            .select("hub_id,user_id,role,invited_at,accepted_at")
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
        if not response.data:
            raise KeyError("Membership not found")
        return HubMember(**response.data[0])

    def list_members(self, client: Client, hub_id: str, include_pending: bool) -> List[HubMember]:
        query = (
            client.table("hub_members")
            .select("hub_id,user_id,role,invited_at,accepted_at")
            .eq("hub_id", str(hub_id))
        )
        if not include_pending:
            query = query.not_.is_("accepted_at", "null")
        response = query.order("invited_at", desc=True).execute()
        return [HubMember(**row) for row in response.data]

    def list_pending_invites(self, client: Client, user_id: str) -> List[dict[str, Any]]:
        response = (
            client.table("hub_members")
            .select("hub_id,role,invited_at, hubs (id, owner_id, name, description, created_at)")
            .eq("user_id", str(user_id))
            .is_("accepted_at", "null")
            .order("invited_at", desc=True)
            .execute()
        )
        invites: List[dict[str, Any]] = []
        for row in response.data:
            hub_row = row.get("hubs") or {}
            invites.append(
                {
                    "hub": Hub(**hub_row),
                    "role": row.get("role"),
                    "invited_at": row.get("invited_at"),
                }
            )
        return invites

    def invite_member(self, client: Client, hub_id: str, payload: HubInviteRequest) -> HubMember:
        users = self.service_client.auth.admin.list_users()
        target = next((user for user in users if (user.email or "").lower() == payload.email.lower()), None)
        if not target or not target.id:
            raise ValueError("User not found. They must already have an account.")
        response = (
            client.table("hub_members")
            .insert(
                {
                    "hub_id": str(hub_id),
                    "user_id": target.id,
                    "role": payload.role.value,
                }
            )
            .execute()
        )
        row = response.data[0]
        row["email"] = target.email
        return HubMember(**row)

    def accept_invite(self, client: Client, hub_id: str, user_id: str) -> HubMember:
        now = datetime.now(timezone.utc).isoformat()
        response = (
            client.table("hub_members")
            .update({"accepted_at": now, "last_accessed_at": now})
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .is_("accepted_at", "null")
            .execute()
        )
        if not response.data:
            raise KeyError("Invite not found")
        return HubMember(**response.data[0])

    def update_member_role(self, client: Client, hub_id: str, user_id: str, role: MembershipRole) -> HubMember:
        response = (
            client.table("hub_members")
            .update({"role": role.value})
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Member not found")
        return HubMember(**response.data[0])

    def remove_member(self, client: Client, hub_id: str, user_id: str) -> None:
        response = (
            client.table("hub_members")
            .delete()
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Member not found")

    def update_hub_access(self, client: Client, hub_id: str, user_id: str) -> None:
        response = (
            client.table("hub_members")
            .update({"last_accessed_at": datetime.now(timezone.utc).isoformat()})
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Hub membership not found")

    def toggle_hub_favourite(self, client: Client, hub_id: str, user_id: str, is_favourite: bool) -> None:
        response = (
            client.table("hub_members")
            .update({"is_favourite": is_favourite})
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Hub membership not found")

    def _fetch_recent_messages(
        self, client: Client, user_id: str, hub_id: str, limit: int, fields: str
    ) -> List[Dict[str, Any]]:
        sessions_resp = (
            client.table("chat_sessions")
            .select("id")
            .eq("hub_id", hub_id)
            .eq("created_by", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        if not sessions_resp.data:
            return []
        session_ids = [s["id"] for s in sessions_resp.data]
        messages_resp = (
            client.table("messages")
            .select(fields)
            .in_("session_id", session_ids)
            .order("created_at", desc=False)
            .execute()
        )
        return messages_resp.data or []

    def _recent_conversation(self, client: Client, user_id: str, hub_id: str) -> List[Dict[str, str]]:
        try:
            rows = self._fetch_recent_messages(client, user_id, hub_id, 5, "role, content")
            return [{"role": m["role"], "content": m["content"]} for m in rows]
        except Exception:
            return []

    def chat(self, client: Client, user_id: str, payload: ChatRequest) -> ChatResponse:
        hub_id = str(payload.hub_id)

        # Fetch conversation history before creating the new session
        history_messages = self._recent_conversation(client, user_id, hub_id)

        session_row = (
            client.table("chat_sessions")
            .insert({"hub_id": hub_id, "scope": payload.scope.value, "created_by": user_id})
            .execute()
        )
        session_id = session_row.data[0]["id"]

        client.table("messages").insert(
            {"session_id": session_id, "role": "user", "content": payload.question}
        ).execute()

        query_embedding = self._embed_query(payload.question)
        source_ids = None if payload.source_ids is None else [str(source_id) for source_id in payload.source_ids]
        raw_matches = self._match_chunks(client, hub_id, query_embedding, self.top_k, source_ids)
        matches = [m for m in raw_matches if (m.get("similarity") or 0) >= self.min_similarity]
        matches = matches[: self.max_citations]
        if not matches and raw_matches:
            matches = raw_matches[:1]

        citations: List[Citation] = []
        context_blocks: List[str] = []
        for idx, match in enumerate(matches, start=1):
            snippet = match.get("text") or ""
            citations.append(
                Citation(source_id=match["source_id"], snippet=snippet, chunk_index=match["chunk_index"])
            )
            context_blocks.append(f"[{idx}] {snippet}")

        if payload.scope == HubScope.global_scope:
            answer, web_citations, usage = self._answer_with_web_search(payload.question, context_blocks)
            all_citations = citations + web_citations
            has_citation = _answer_has_citation(answer, len(all_citations))
            if not has_citation:
                all_citations = []
            assistant_row = (
                client.table("messages")
                .insert(
                    {
                        "session_id": session_id,
                        "role": "assistant",
                        "content": answer,
                        "citations": [c.model_dump() for c in all_citations],
                        "token_usage": usage,
                    }
                )
                .execute()
            )
            return ChatResponse(answer=answer, citations=all_citations, message_id=assistant_row.data[0]["id"])

        system_prompt = (
            "You are Caddie, an onboarding assistant. Answer using the provided context only. "
            "If the context is insufficient, say you don't have enough information. "
            "Cite sources inline using [n] that matches the context list, and only include citations when you are "
            "directly using the cited content. "
            "If the user sends small talk or a greeting, respond politely and ask how you can help."
        )
        user_prompt = f"Question: {payload.question}\n\nContext:\n" + "\n".join(context_blocks)

        if not context_blocks:
            system_prompt = (
                "You are Caddie, a helpful assistant. The user is chatting or asking something that is not tied to the "
                "hub's sources. Respond naturally and helpfully. Do not cite sources."
            )
            completion = self.llm_client.chat.completions.create(
                model=self.chat_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    *history_messages,
                    {"role": "user", "content": payload.question},
                ],
                temperature=0.2,
            )
            answer = completion.choices[0].message.content or ""
            usage = completion.usage.model_dump() if completion.usage else None
            assistant_row = client.table("messages").insert(
                {
                    "session_id": session_id,
                    "role": "assistant",
                    "content": answer,
                    "citations": [],
                    "token_usage": usage,
                }
            ).execute()
            return ChatResponse(answer=answer, citations=[], message_id=assistant_row.data[0]["id"])

        completion = self.llm_client.chat.completions.create(
            model=self.chat_model,
            messages=[
                {"role": "system", "content": system_prompt},
                *history_messages,
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
        answer = completion.choices[0].message.content or ""
        usage = completion.usage.model_dump() if completion.usage else None

        has_citation = _answer_has_citation(answer, len(context_blocks))
        final_citations = citations if has_citation else []

        assistant_row = (
            client.table("messages")
            .insert(
                {
                    "session_id": session_id,
                    "role": "assistant",
                    "content": answer,
                    "citations": [c.model_dump() for c in final_citations],
                    "token_usage": usage,
                }
            )
            .execute()
        )
        return ChatResponse(answer=answer, citations=final_citations, message_id=assistant_row.data[0]["id"])

    def chat_history(self, client: Client, user_id: str, hub_id: str) -> List[HistoryMessage]:
        rows = self._fetch_recent_messages(client, user_id, hub_id, 5, "role, content, citations, created_at")
        return [
            HistoryMessage(
                role=m["role"],
                content=m["content"],
                citations=[Citation(**c) for c in (m.get("citations") or [])],
                created_at=m["created_at"],
            )
            for m in rows
        ]

    def list_faqs(self, client: Client, hub_id: str) -> List[FaqEntry]:
        response = (
            client.table("faq_entries")
            .select("*")
            .eq("hub_id", str(hub_id))
            .is_("archived_at", "null")
            .order("is_pinned", desc=True)
            .order("created_at", desc=True)
            .execute()
        )
        return [FaqEntry(**row) for row in response.data]

    def get_faq(self, client: Client, faq_id: str) -> FaqEntry:
        response = client.table("faq_entries").select("*").eq("id", str(faq_id)).limit(1).execute()
        if not response.data:
            raise KeyError("FAQ entry not found")
        return FaqEntry(**response.data[0])

    def generate_faqs(self, client: Client, user_id: str, payload: FaqGenerateRequest) -> List[FaqEntry]:
        hub_id = str(payload.hub_id)
        source_ids = [str(source_id) for source_id in payload.source_ids]
        if not source_ids:
            raise ValueError("Select at least one source to generate FAQs.")

        count = payload.count or self.faq_default_count
        count = max(1, min(int(count), 20))

        context_chunks: List[dict] = []
        for source_id in source_ids:
            context_chunks.extend(
                self._fetch_source_context(client, hub_id, source_id, self.faq_context_chunks_per_source)
            )

        if not context_chunks:
            return []

        context_blocks: List[str] = []
        for chunk in context_chunks:
            text = chunk.get("text") or ""
            snippet = _trim_text(text, 900)
            context_blocks.append(
                f"Source {chunk.get('source_id')} [chunk {chunk.get('chunk_index')}]: {snippet}"
            )

        questions = self._generate_faq_questions(context_blocks, count)
        if not questions:
            return []

        entries_payload: List[dict] = []
        now = datetime.now(timezone.utc).isoformat()
        batch_id = str(uuid.uuid4())

        for question in questions:
            query_embedding = self._embed_query(question)
            raw_matches = self._match_chunks(client, hub_id, query_embedding, self.top_k, source_ids)
            matches = [match for match in raw_matches if (match.get("similarity") or 0) >= self.faq_min_similarity]
            matches = matches[: self.faq_max_citations]
            if not matches:
                continue

            citations: List[Citation] = []
            answer_context: List[str] = []
            for idx, match in enumerate(matches, start=1):
                snippet = match.get("text") or ""
                trimmed = _trim_text(snippet, 600)
                citations.append(
                    Citation(source_id=match["source_id"], snippet=trimmed, chunk_index=match.get("chunk_index"))
                )
                answer_context.append(f"[{idx}] {trimmed}")

            answer = self._generate_faq_answer(question, answer_context)
            if not _answer_has_citation(answer, len(answer_context)):
                continue

            confidence = _average_similarity(matches)

            entries_payload.append(
                {
                    "hub_id": hub_id,
                    "question": question,
                    "answer": answer,
                    "citations": [citation.model_dump() for citation in citations],
                    "source_ids": source_ids,
                    "confidence": confidence,
                    "is_pinned": False,
                    "created_by": user_id,
                    "updated_by": user_id,
                    "updated_at": now,
                    "generation_batch_id": batch_id,
                }
            )

        if not entries_payload:
            return []

        (
            client.table("faq_entries")
            .eq("hub_id", hub_id)
            .is_("archived_at", "null")
            .eq("is_pinned", False)
            .update({"archived_at": now, "updated_at": now, "updated_by": user_id})
            .execute()
        )

        response = client.table("faq_entries").insert(entries_payload).execute()
        return [FaqEntry(**row) for row in response.data]

    def update_faq(self, client: Client, faq_id: str, payload: dict) -> FaqEntry:
        response = client.table("faq_entries").update(payload).eq("id", str(faq_id)).execute()
        if not response.data:
            raise KeyError("FAQ entry not found")
        return FaqEntry(**response.data[0])

    def archive_faq(self, client: Client, faq_id: str, user_id: str) -> FaqEntry:
        now = datetime.now(timezone.utc).isoformat()
        response = (
            client.table("faq_entries")
            .update({"archived_at": now, "updated_at": now, "updated_by": user_id})
            .eq("id", str(faq_id))
            .execute()
        )
        if not response.data:
            raise KeyError("FAQ entry not found")
        return FaqEntry(**response.data[0])

    def list_guides(self, client: Client, user_id: str, hub_id: str) -> List[GuideEntry]:
        response = (
            client.table("guide_entries")
            .select("*")
            .eq("hub_id", str(hub_id))
            .is_("archived_at", "null")
            .order("created_at", desc=True)
            .execute()
        )
        guide_rows = response.data or []
        if not guide_rows:
            return []

        guide_ids = [row.get("id") for row in guide_rows if row.get("id")]
        steps_by_guide: dict[str, list[dict]] = {guide_id: [] for guide_id in guide_ids}
        progress_by_guide: dict[str, dict[str, dict]] = {guide_id: {} for guide_id in guide_ids}

        steps_response = (
            client.table("guide_steps")
            .select("*")
            .in_("guide_id", guide_ids)
            .execute()
        )
        for step_row in steps_response.data or []:
            guide_id = step_row.get("guide_id")
            if guide_id in steps_by_guide:
                steps_by_guide[guide_id].append(step_row)

        progress_response = (
            client.table("guide_step_progress")
            .select("guide_id, guide_step_id, is_complete, completed_at")
            .in_("guide_id", guide_ids)
            .eq("user_id", user_id)
            .execute()
        )
        for progress_row in progress_response.data or []:
            guide_id = progress_row.get("guide_id")
            step_id = progress_row.get("guide_step_id")
            if guide_id in progress_by_guide and step_id:
                progress_by_guide[guide_id][step_id] = progress_row

        guides: List[GuideEntry] = []
        for row in guide_rows:
            guide_id = row.get("id")
            step_rows = sorted(
                steps_by_guide.get(guide_id, []),
                key=lambda step: step.get("step_index") or 0,
            )
            progress_map = progress_by_guide.get(guide_id, {})
            steps: List[GuideStepWithProgress] = []
            for step_row in step_rows:
                progress = progress_map.get(step_row.get("id"), {})
                steps.append(
                    GuideStepWithProgress(
                        **step_row,
                        is_complete=bool(progress.get("is_complete", False)),
                        completed_at=progress.get("completed_at"),
                    )
                )
            guides.append(GuideEntry(**row, steps=steps))
        return guides

    def get_guide(self, client: Client, guide_id: str) -> GuideEntry:
        response = client.table("guide_entries").select("*").eq("id", str(guide_id)).limit(1).execute()
        if not response.data:
            raise KeyError("Guide entry not found")
        return GuideEntry(**response.data[0], steps=[])

    def get_guide_step(self, client: Client, step_id: str) -> GuideStep:
        response = client.table("guide_steps").select("*").eq("id", str(step_id)).limit(1).execute()
        if not response.data:
            raise KeyError("Guide step not found")
        return GuideStep(**response.data[0])

    def generate_guide(self, client: Client, user_id: str, payload: GuideGenerateRequest) -> Optional[GuideEntry]:
        hub_id = str(payload.hub_id)
        source_ids = [str(source_id) for source_id in payload.source_ids]
        if not source_ids:
            raise ValueError("Select at least one source to generate a guide.")

        step_count = payload.step_count or self.guide_default_steps
        step_count = max(1, min(int(step_count), 20))

        context_chunks: List[dict] = []
        for source_id in source_ids:
            context_chunks.extend(
                self._fetch_source_context(client, hub_id, source_id, self.guide_context_chunks_per_source)
            )

        if not context_chunks:
            return None

        context_blocks: List[str] = []
        for chunk in context_chunks:
            text = chunk.get("text") or ""
            snippet = _trim_text(text, 900)
            context_blocks.append(
                f"Source {chunk.get('source_id')} [chunk {chunk.get('chunk_index')}]: {snippet}"
            )

        steps = self._generate_guide_steps(context_blocks, payload.topic, step_count)
        if not steps:
            return None

        now = datetime.now(timezone.utc).isoformat()
        batch_id = str(uuid.uuid4())
        topic = (payload.topic or "").strip() or None
        title = topic or "Onboarding Guide"

        steps_payload: List[dict] = []
        kept_index = 1
        for step in steps:
            instruction = (step.get("instruction") or "").strip()
            if not instruction:
                continue
            step_title = (step.get("title") or "").strip() or None
            query_text = f"{step_title}. {instruction}" if step_title else instruction
            query_embedding = self._embed_query(query_text)
            raw_matches = self._match_chunks(client, hub_id, query_embedding, self.top_k, source_ids)
            matches = [match for match in raw_matches if (match.get("similarity") or 0) >= self.guide_min_similarity]
            matches = matches[: self.guide_max_citations]
            if not matches and raw_matches:
                matches = raw_matches[: self.guide_max_citations]
            if not matches:
                continue

            citations: List[Citation] = []
            for match in matches:
                snippet = match.get("text") or ""
                trimmed = _trim_text(snippet, 600)
                citations.append(
                    Citation(source_id=match["source_id"], snippet=trimmed, chunk_index=match.get("chunk_index"))
                )

            confidence = _average_similarity(matches)
            steps_payload.append(
                {
                    "step_index": kept_index,
                    "title": step_title,
                    "instruction": instruction,
                    "citations": [citation.model_dump() for citation in citations],
                    "confidence": confidence,
                    "updated_at": now,
                }
            )
            kept_index += 1

        if not steps_payload:
            return None

        guide_row = (
            client.table("guide_entries")
            .insert(
                {
                    "hub_id": hub_id,
                    "title": title,
                    "topic": topic,
                    "summary": None,
                    "source_ids": source_ids,
                    "created_by": user_id,
                    "updated_by": user_id,
                    "updated_at": now,
                    "generation_batch_id": batch_id,
                }
            )
            .execute()
        )
        if not guide_row.data:
            return None
        guide_id = guide_row.data[0]["id"]

        for step in steps_payload:
            step["guide_id"] = guide_id

        steps_response = client.table("guide_steps").insert(steps_payload).execute()
        steps_out = [GuideStepWithProgress(**row, is_complete=False, completed_at=None) for row in steps_response.data]
        return GuideEntry(**guide_row.data[0], steps=steps_out)

    def update_guide(self, client: Client, guide_id: str, payload: dict) -> GuideEntry:
        response = client.table("guide_entries").update(payload).eq("id", str(guide_id)).execute()
        if not response.data:
            raise KeyError("Guide entry not found")
        return GuideEntry(**response.data[0], steps=[])

    def archive_guide(self, client: Client, guide_id: str, user_id: str) -> GuideEntry:
        now = datetime.now(timezone.utc).isoformat()
        response = (
            client.table("guide_entries")
            .update({"archived_at": now, "updated_at": now, "updated_by": user_id})
            .eq("id", str(guide_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Guide entry not found")
        return GuideEntry(**response.data[0], steps=[])

    def create_guide_step(self, client: Client, guide_id: str, payload: GuideStepCreateRequest) -> GuideStep:
        last_step = (
            client.table("guide_steps")
            .select("step_index")
            .eq("guide_id", str(guide_id))
            .order("step_index", desc=True)
            .limit(1)
            .execute()
        )
        next_index = 1
        if last_step.data:
            next_index = int(last_step.data[0].get("step_index") or 0) + 1

        row = (
            client.table("guide_steps")
            .insert(
                {
                    "guide_id": str(guide_id),
                    "step_index": next_index,
                    "title": payload.title,
                    "instruction": payload.instruction,
                    "citations": [],
                    "confidence": 0,
                }
            )
            .execute()
        )
        if not row.data:
            raise KeyError("Guide step not found")
        return GuideStep(**row.data[0])

    def update_guide_step(self, client: Client, step_id: str, payload: dict) -> GuideStep:
        response = client.table("guide_steps").update(payload).eq("id", str(step_id)).execute()
        if not response.data:
            raise KeyError("Guide step not found")
        return GuideStep(**response.data[0])

    def reorder_guide_steps(self, client: Client, guide_id: str, ordered_step_ids: List[str]) -> List[GuideStep]:
        steps_response = (
            client.table("guide_steps")
            .select("id")
            .eq("guide_id", str(guide_id))
            .execute()
        )
        step_ids = [row.get("id") for row in steps_response.data]
        if set(step_ids) != set(ordered_step_ids):
            raise ValueError("Step list does not match current guide steps.")

        now = datetime.now(timezone.utc).isoformat()
        for index, step_id in enumerate(ordered_step_ids, start=1):
            client.table("guide_steps").update({"step_index": index, "updated_at": now}).eq("id", step_id).execute()

        updated = (
            client.table("guide_steps")
            .select("*")
            .eq("guide_id", str(guide_id))
            .order("step_index")
            .execute()
        )
        return [GuideStep(**row) for row in updated.data]

    def upsert_guide_step_progress(
        self,
        client: Client,
        user_id: str,
        guide_id: str,
        step_id: str,
        payload: GuideStepProgressUpdate,
    ) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        completed_at = now if payload.is_complete else None
        progress_payload = {
            "guide_step_id": step_id,
            "guide_id": guide_id,
            "user_id": user_id,
            "is_complete": payload.is_complete,
            "completed_at": completed_at,
            "updated_at": now,
        }
        progress_payload["created_at"] = now
        response = client.table("guide_step_progress").upsert(
            progress_payload, on_conflict="guide_step_id,user_id"
        ).execute()
        if not response.data:
            raise KeyError("Guide step progress not found")
        return response.data[0]

    def list_reminders(
        self,
        client: Client,
        user_id: str,
        hub_id: Optional[str] = None,
        status: Optional[str] = None,
        due_from: Optional[str] = None,
        due_to: Optional[str] = None,
        source_id: Optional[str] = None,
    ) -> List[Reminder]:
        query = client.table("reminders").select("*").eq("user_id", user_id)
        if hub_id:
            query = query.eq("hub_id", hub_id)
        if status:
            query = query.eq("status", status)
        if source_id:
            query = query.eq("source_id", source_id)
        if due_from:
            query = query.gte("due_at", due_from)
        if due_to:
            query = query.lte("due_at", due_to)
        response = query.order("due_at").execute()
        return [Reminder(**row) for row in response.data]

    def create_reminder(self, client: Client, user_id: str, payload: ReminderCreate) -> Reminder:
        response = (
            client.table("reminders")
            .insert(
                {
                    "user_id": user_id,
                    "hub_id": str(payload.hub_id),
                    "source_id": str(payload.source_id) if payload.source_id else None,
                    "due_at": payload.due_at.isoformat(),
                    "timezone": payload.timezone,
                    "message": payload.message,
                    "status": ReminderStatus.scheduled.value,
                }
            )
            .execute()
        )
        return Reminder(**response.data[0])

    def update_reminder(self, client: Client, reminder_id: str, payload: dict) -> Reminder:
        response = client.table("reminders").update(payload).eq("id", reminder_id).execute()
        if not response.data:
            raise KeyError("Reminder not found")
        return Reminder(**response.data[0])

    def delete_reminder(self, client: Client, reminder_id: str) -> None:
        response = client.table("reminders").delete().eq("id", reminder_id).execute()
        if not response.data:
            raise KeyError("Reminder not found")

    def list_candidates(
        self,
        client: Client,
        hub_id: Optional[str] = None,
        source_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[ReminderCandidate]:
        query = client.table("reminder_candidates").select("*")
        if hub_id:
            query = query.eq("hub_id", hub_id)
        if source_id:
            query = query.eq("source_id", source_id)
        if status:
            query = query.eq("status", status)
        response = query.order("created_at", desc=True).execute()
        return [ReminderCandidate(**row) for row in response.data]

    def get_candidate(self, client: Client, candidate_id: str) -> ReminderCandidate:
        response = client.table("reminder_candidates").select("*").eq("id", candidate_id).limit(1).execute()
        if not response.data:
            raise KeyError("Candidate not found")
        return ReminderCandidate(**response.data[0])

    def update_candidate(self, client: Client, candidate_id: str, payload: dict) -> ReminderCandidate:
        response = client.table("reminder_candidates").update(payload).eq("id", candidate_id).execute()
        if not response.data:
            raise KeyError("Candidate not found")
        return ReminderCandidate(**response.data[0])

    def create_candidate_feedback(
        self,
        client: Client,
        candidate_id: str,
        user_id: str,
        decision: ReminderCandidateDecision,
    ) -> None:
        client.table("reminder_feedback").insert(
            {
                "candidate_id": candidate_id,
                "user_id": user_id,
                "action": decision.action.value,
                "edited_due_at": decision.edited_due_at.isoformat() if decision.edited_due_at else None,
                "edited_message": decision.edited_message,
            }
        ).execute()

    def list_notifications(self, client: Client, user_id: str, reminder_id: Optional[str] = None) -> List[NotificationEvent]:
        select = "id, reminder_id, channel, status, scheduled_for, sent_at, reminders (id, hub_id, source_id, due_at, message, status)"
        query = client.table("notifications").select(select).eq("user_id", user_id)
        if reminder_id:
            query = query.eq("reminder_id", reminder_id)
        response = query.order("scheduled_for", desc=True).execute()
        events: List[NotificationEvent] = []
        for row in response.data:
            reminder_row = row.get("reminders") or {}
            if isinstance(reminder_row, list):
                reminder_row = reminder_row[0] if reminder_row else {}
            if not reminder_row:
                continue
            if row.get("channel") != "in_app":
                continue
            reminder = ReminderSummary(**reminder_row)
            events.append(
                NotificationEvent(
                    id=row["id"],
                    reminder_id=row["reminder_id"],
                    channel=row["channel"],
                    status=row["status"],
                    scheduled_for=row["scheduled_for"],
                    sent_at=row.get("sent_at"),
                    reminder=reminder,
                )
            )
        return events

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

    def _generate_faq_questions(self, context_blocks: List[str], count: int) -> List[str]:
        system_prompt = (
            "You are Caddie, an onboarding assistant. Generate distinct FAQ questions "
            "grounded strictly in the provided context. Return a JSON array of strings only."
        )
        context = "\n".join(context_blocks)
        user_prompt = (
            f"Context:\n{context}\n\n"
            f"Generate {count} concise FAQ questions that an onboarding user would ask."
        )
        completion = self.llm_client.chat.completions.create(
            model=self.chat_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
        raw = completion.choices[0].message.content or ""
        return _parse_questions_from_text(raw, count)

    def _generate_faq_answer(self, question: str, context_blocks: List[str]) -> str:
        system_prompt = (
            "You are Caddie, an onboarding assistant. Answer using only the provided context. "
            "Cite sources inline using [n] that match the context list."
        )
        user_prompt = f"Question: {question}\n\nContext:\n" + "\n".join(context_blocks)
        completion = self.llm_client.chat.completions.create(
            model=self.chat_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
        return completion.choices[0].message.content or ""

    def _generate_guide_steps(
        self, context_blocks: List[str], topic: Optional[str], step_count: int
    ) -> List[Dict[str, str]]:
        system_prompt = (
            "You are Caddie, an onboarding assistant. Generate a concise, ordered checklist from the context. "
            "Return a JSON array of objects with keys: title (optional) and instruction. "
            "Use only information grounded in the provided context."
        )
        context = "\n".join(context_blocks)
        topic_text = f"Topic: {topic}\n" if topic else ""
        user_prompt = (
            f"{topic_text}Context:\n{context}\n\n"
            f"Generate {step_count} checklist steps. Each step should be a clear instruction."
        )
        completion = self.llm_client.chat.completions.create(
            model=self.chat_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
        raw = completion.choices[0].message.content or ""
        return _parse_steps_from_text(raw, step_count)


store = SupabaseStore()


_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._ -]")


def _sanitize_filename(name: str) -> str:
    base = PurePath(name).name.strip()
    base = _FILENAME_SAFE_RE.sub("_", base)
    base = base.strip(" ._-")
    if not base:
        raise ValueError("Invalid file name.")
    if len(base) > 255:
        base = base[:255]
    return base


def _web_storage_path(hub_id: str, source_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{hub_id}/{source_id}/web-{stamp}.md"


def _youtube_storage_path(hub_id: str, source_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{hub_id}/{source_id}/youtube-{stamp}.md"


def _build_web_source_name(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc or parsed.path or url
    display = host.strip()
    if parsed.path and parsed.path not in {"/", ""}:
        display = f"{display}{parsed.path}"
    if parsed.query:
        display = f"{display}?{parsed.query}"
    return display[:255]


def _build_youtube_source_name(url: str, video_id: str) -> str:
    parsed = urlparse(url)
    host = (parsed.netloc or "youtube.com").lower()
    if host.startswith("www."):
        host = host[4:]
    display = f"{host}/{video_id}"
    return display[:255]


_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")



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


def _normalize_youtube_id(value: str) -> Optional[str]:
    if not value:
        return None
    candidate = value.strip()
    if not _YOUTUBE_ID_RE.fullmatch(candidate):
        return None
    return candidate




def _trim_text(text: str, max_chars: int) -> str:
    cleaned = " ".join((text or "").split()).strip()
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars].rstrip()}..."


def _parse_questions_from_text(raw: str, max_count: int) -> List[str]:
    if not raw:
        return []
    text = raw.strip()
    candidates: List[str] = []
    seen: set[str] = set()

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


def _parse_steps_from_text(raw: str, max_count: int) -> List[Dict[str, str]]:
    if not raw:
        return []
    text = raw.strip()
    steps: List[Dict[str, str]] = []

    def _clean(value: str) -> str:
        cleaned = re.sub(r"^[\-\*\d\.\)\s]+", "", value or "").strip()
        return cleaned

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


def _average_similarity(matches: List[Dict[str, Any]]) -> float:
    if not matches:
        return 0.0
    values = [float(match.get("similarity") or 0) for match in matches]
    return sum(values) / len(values)


def _get_attr(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


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


def _format_web_snippet(title: str, snippet: str, url: str) -> str:
    parts = []
    if title:
        parts.append(title)
    if snippet:
        parts.append(snippet)
    if url:
        parts.append(f"source: {url}")
    return " - ".join(parts)


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
