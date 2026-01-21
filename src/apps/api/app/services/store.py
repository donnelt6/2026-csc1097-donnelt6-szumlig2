import re
import uuid
from datetime import datetime
from pathlib import PurePath
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
    MembershipRole,
    Source,
    SourceCreate,
    SourceStatus,
    SourceStatusResponse,
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
            .select("role, hubs (id, owner_id, name, description, created_at)")
            .eq("user_id", user_id)
            .not_.is_("accepted_at", "null")
            .order("created_at", desc=True, foreign_table="hubs")
            .execute()
        )
        hubs: List[Hub] = []
        for row in response.data:
            hub_row = row.get("hubs") or {}
            hub_row["role"] = row.get("role")
            hubs.append(Hub(**hub_row))
        return hubs

    def create_hub(self, client: Client, user_id: str, payload: HubCreate) -> Hub:
        response = (
            client.table("hubs")
            .insert({"owner_id": user_id, "name": payload.name, "description": payload.description})
            .execute()
        )
        row = response.data[0]
        client.table("hub_members").insert(
            {
                "hub_id": row["id"],
                "user_id": user_id,
                "role": MembershipRole.owner.value,
                "accepted_at": datetime.utcnow().isoformat(),
            }
        ).execute()
        row["role"] = MembershipRole.owner.value
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
                }
            )
            .execute()
        )
        row = response.data[0]

        upload = self.service_client.storage.from_(self.storage_bucket).create_signed_upload_url(storage_path)
        upload_url = upload.get("signedURL") or upload.get("signedUrl") or upload.get("signed_url")
        if not upload_url:
            raise RuntimeError("Failed to create signed upload URL")

        return Source(**row), upload_url

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

    def set_source_status(self, client: Client, source_id: str, status: SourceStatus, failure_reason: Optional[str] = None) -> Source:
        response = (
            client.table("sources")
            .update({"status": status.value, "failure_reason": failure_reason})
            .eq("id", str(source_id))
            .execute()
        )
        row = response.data[0]
        return Source(**row)

    def get_source_status(self, client: Client, source_id: str) -> SourceStatusResponse:
        response = client.table("sources").select("id,status,failure_reason").eq("id", str(source_id)).execute()
        if not response.data:
            raise KeyError("Source not found")
        row = response.data[0]
        return SourceStatusResponse(id=row["id"], status=row["status"], failure_reason=row.get("failure_reason"))

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
        response = (
            client.table("hub_members")
            .update({"accepted_at": datetime.utcnow().isoformat()})
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
