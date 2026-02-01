import re
import uuid
from datetime import datetime
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
        now = datetime.utcnow().isoformat()
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
        metadata["refresh_requested_at"] = datetime.utcnow().isoformat()
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
                "refresh_requested_at": datetime.utcnow().isoformat(),
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
        now = datetime.utcnow().isoformat()
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
            .update({"last_accessed_at": datetime.utcnow().isoformat()})
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

    def chat(self, client: Client, user_id: str, payload: ChatRequest) -> ChatResponse:
        hub_id = str(payload.hub_id)
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
        raw_matches = self._match_chunks(client, hub_id, query_embedding, self.top_k)
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
            "Cite sources inline using [n] that matches the context list."
        )
        user_prompt = f"Question: {payload.question}\n\nContext:\n" + "\n".join(context_blocks)

        if not context_blocks:
            answer = "I couldn't find relevant information in the uploaded sources."
            assistant_row = client.table("messages").insert(
                {"session_id": session_id, "role": "assistant", "content": answer, "citations": []}
            ).execute()
            return ChatResponse(answer=answer, citations=[], message_id=assistant_row.data[0]["id"])

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

        assistant_row = (
            client.table("messages")
            .insert(
                {
                    "session_id": session_id,
                    "role": "assistant",
                    "content": answer,
                    "citations": [c.model_dump() for c in citations],
                    "token_usage": usage,
                }
            )
            .execute()
        )
        return ChatResponse(answer=answer, citations=citations, message_id=assistant_row.data[0]["id"])

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
            "If hub context is relevant, cite it with [n] matching the context list."
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

    def _match_chunks(self, client: Client, hub_id: str, embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        response = client.rpc(
            "match_source_chunks",
            {"query_embedding": embedding, "match_count": top_k, "match_hub": str(hub_id)},
        ).execute()
        return response.data or []


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
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    return f"{hub_id}/{source_id}/web-{stamp}.md"


def _youtube_storage_path(hub_id: str, source_id: str) -> str:
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
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
