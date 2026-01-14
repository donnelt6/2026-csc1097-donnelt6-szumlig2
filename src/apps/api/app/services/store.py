import uuid
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
    Source,
    SourceCreate,
    SourceStatus,
    SourceStatusResponse,
)


class SupabaseStore:
    """Supabase-backed store for hubs/sources. Uses a dev user until auth is wired in."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Supabase credentials missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
        if not settings.dev_user_id:
            raise RuntimeError("DEV_USER_ID is missing. Add a Supabase user id to apps/api/.env.")
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is missing. Add it to apps/api/.env.")
        self.dev_user_id = settings.dev_user_id
        self.storage_bucket = settings.supabase_storage_bucket
        self.embedding_model = settings.embedding_model
        self.chat_model = settings.chat_model
        self.top_k = settings.top_k
        self.min_similarity = settings.min_similarity
        self.max_citations = settings.max_citations
        self.client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        self.llm_client = OpenAI(api_key=settings.openai_api_key)

    def list_hubs(self) -> List[Hub]:
        response = (
            self.client.table("hubs")
            .select("*")
            .eq("owner_id", self.dev_user_id)
            .order("created_at", desc=True)
            .execute()
        )
        return [Hub(**row) for row in response.data]

    def create_hub(self, payload: HubCreate) -> Hub:
        # TODO: replace dev_user_id with auth user id once JWT-based auth is wired.
        response = (
            self.client.table("hubs")
            .insert({"owner_id": self.dev_user_id, "name": payload.name, "description": payload.description})
            .execute()
        )
        row = response.data[0]
        return Hub(**row)

    def create_source(self, payload: SourceCreate) -> Tuple[Source, str]:
        hub_response = (
            self.client.table("hubs")
            .select("id")
            .eq("id", payload.hub_id)
            .eq("owner_id", self.dev_user_id)
            .execute()
        )
        if not hub_response.data:
            raise ValueError("Hub does not exist or is not owned by the dev user")

        source_id = str(uuid.uuid4())
        storage_path = f"{payload.hub_id}/{source_id}/{payload.original_name}"
        response = (
            self.client.table("sources")
            .insert(
                {
                    "id": source_id,
                    "hub_id": payload.hub_id,
                    "original_name": payload.original_name,
                    "storage_path": storage_path,
                    "status": SourceStatus.queued.value,
                }
            )
            .execute()
        )
        row = response.data[0]

        upload = self.client.storage.from_(self.storage_bucket).create_signed_upload_url(storage_path)
        upload_url = upload.get("signedURL") or upload.get("signedUrl") or upload.get("signed_url")
        if not upload_url:
            raise RuntimeError("Failed to create signed upload URL")

        return Source(**row), upload_url

    def list_sources(self, hub_id: str) -> List[Source]:
        response = self.client.table("sources").select("*").eq("hub_id", hub_id).order("created_at", desc=True).execute()
        return [Source(**row) for row in response.data]

    def get_source(self, source_id: str) -> Source:
        response = self.client.table("sources").select("*").eq("id", source_id).limit(1).execute()
        if not response.data:
            raise KeyError("Source not found")
        return Source(**response.data[0])

    def set_source_status(self, source_id: str, status: SourceStatus, failure_reason: Optional[str] = None) -> Source:
        response = (
            self.client.table("sources")
            .update({"status": status.value, "failure_reason": failure_reason})
            .eq("id", source_id)
            .execute()
        )
        row = response.data[0]
        return Source(**row)

    def get_source_status(self, source_id: str) -> SourceStatusResponse:
        response = self.client.table("sources").select("id,status,failure_reason").eq("id", source_id).execute()
        if not response.data:
            raise KeyError("Source not found")
        row = response.data[0]
        return SourceStatusResponse(id=row["id"], status=row["status"], failure_reason=row.get("failure_reason"))

    def chat(self, payload: ChatRequest) -> ChatResponse:
        message_id = str(uuid.uuid4())
        # TODO: Replace dev_user_id with JWT-derived user id when full auth is implemented.
        session_row = (
            self.client.table("chat_sessions")
            .insert({"hub_id": payload.hub_id, "scope": payload.scope.value, "created_by": self.dev_user_id})
            .execute()
        )
        session_id = session_row.data[0]["id"]

        self.client.table("messages").insert(
            {"session_id": session_id, "role": "user", "content": payload.question}
        ).execute()

        query_embedding = self._embed_query(payload.question)
        raw_matches = self._match_chunks(payload.hub_id, query_embedding, self.top_k)
        # Filter low-similarity chunks to keep citations relevant; tune MIN_SIMILARITY as needed.
        matches = [m for m in raw_matches if (m.get("similarity") or 0) >= self.min_similarity]
        matches = matches[: self.max_citations]
        # If filtering removes everything, fall back to the top raw match to avoid empty answers.
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

        # TODO: Enhance system prompt to include more detailed instructions and context.
        system_prompt = (
            "You are Caddie, an onboarding assistant. Answer using the provided context only. "
            "If the context is insufficient, say you don't have enough information. "
            "Cite sources inline using [n] that matches the context list."
        )
        user_prompt = f"Question: {payload.question}\n\nContext:\n" + "\n".join(context_blocks)

        if not context_blocks:
            answer = "I couldn't find relevant information in the uploaded sources."
            assistant_row = self.client.table("messages").insert(
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
            self.client.table("messages")
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

    def _match_chunks(self, hub_id: str, embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        response = self.client.rpc(
            "match_source_chunks",
            {"query_embedding": embedding, "match_count": top_k, "match_hub": hub_id},
        ).execute()
        return response.data or []


store = SupabaseStore()
