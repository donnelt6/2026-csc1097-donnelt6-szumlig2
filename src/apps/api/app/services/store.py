import json
import math
import random
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import PurePath
from urllib.parse import parse_qs, urlparse, urlunparse
from typing import Any, Dict, List, Optional, Tuple

import httpx
from openai import OpenAI
from postgrest.exceptions import APIError
from supabase import Client, create_client

from ..core.config import get_settings
from ..schemas import (
    ApplyRevisionRequest,
    AssignableMembershipRole,
    ChatRequest,
    ChatResponse,
    ChatSearchResult,
    ChatSessionDetail,
    ChatSessionSummary,
    Citation,
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


class ConflictError(RuntimeError):
    """Raised when a conditional update loses a concurrency race."""


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
        self.chat_rewrite_enabled = settings.chat_rewrite_enabled
        self.chat_rewrite_history_messages = settings.chat_rewrite_history_messages
        self.retrieval_candidate_pool = max(settings.top_k, settings.retrieval_candidate_pool)
        self.retrieval_mmr_lambda = settings.retrieval_mmr_lambda
        self.retrieval_same_source_penalty = settings.retrieval_same_source_penalty
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
        select_with_appearance = (
            "role, last_accessed_at, is_favourite, "
            "hubs (id, owner_id, name, description, icon_key, color_key, created_at, archived_at, members_count, sources_count)"
        )
        select_without_appearance = (
            "role, last_accessed_at, is_favourite, "
            "hubs (id, owner_id, name, description, created_at, archived_at, members_count, sources_count)"
        )
        select_without_archival = (
            "role, last_accessed_at, is_favourite, "
            "hubs (id, owner_id, name, description, icon_key, color_key, created_at, members_count, sources_count)"
        )
        select_without_appearance_or_archival = (
            "role, last_accessed_at, is_favourite, "
            "hubs (id, owner_id, name, description, created_at, members_count, sources_count)"
        )
        select_candidates = [
            select_with_appearance,
            select_without_appearance,
            select_without_archival,
            select_without_appearance_or_archival,
        ]
        response = None
        for select_fields in select_candidates:
            try:
                response = (
                    client.table("hub_members")
                    .select(select_fields)
                    .eq("user_id", user_id)
                    .not_.is_("accepted_at", "null")
                    .order("last_accessed_at", desc=True)
                    .execute()
                )
                break
            except APIError as exc:
                if not _is_missing_hub_optional_column_error(exc):
                    raise
        if response is None:
            raise RuntimeError("Failed to list hubs.")
        hubs: List[Hub] = []
        hub_ids: List[str] = []
        for row in response.data:
            hub_row = row.get("hubs") or {}
            hub_row.setdefault("icon_key", DEFAULT_HUB_ICON_KEY)
            hub_row.setdefault("color_key", DEFAULT_HUB_COLOR_KEY)
            hub_row["role"] = row.get("role")
            hub_row["last_accessed_at"] = row.get("last_accessed_at")
            hub_row["is_favourite"] = row.get("is_favourite")
            hubs.append(Hub(**hub_row))
            hub_ids.append(hub_row["id"])

        if hub_ids:
            try:
                members_response = (
                    client.table("hub_members")
                    .select("hub_id, user_id")
                    .in_("hub_id", hub_ids)
                    .not_.is_("accepted_at", "null")
                    .execute()
                )
                user_ids = {
                    str(member.get("user_id") or "")
                    for member in (members_response.data or [])
                    if member.get("user_id")
                }
                profile_lookup = self.resolve_user_profiles_by_ids(user_ids)
                emails_by_hub: dict[str, List[str]] = {}
                profiles_by_hub: dict[str, List[UserProfileSummary]] = {}
                for m in members_response.data:
                    hid = m.get("hub_id")
                    uid = str(m.get("user_id") or "")
                    profile = profile_lookup.get(uid)
                    if not hid or not profile:
                        continue
                    if profile.email:
                        emails_by_hub.setdefault(hid, []).append(profile.email)
                    profiles_by_hub.setdefault(hid, []).append(profile)
                for hub in hubs:
                    hub.member_emails = emails_by_hub.get(hub.id, [])
                    hub.member_profiles = profiles_by_hub.get(hub.id, [])
            except Exception:
                for hub in hubs:
                    hub.member_emails = []
                    hub.member_profiles = []

        return hubs

    def create_hub(self, client: Client, user_id: str, payload: HubCreate) -> Hub:
        _ = client
        self._validate_hub_appearance(payload.icon_key, payload.color_key)
        response = self.service_client.rpc(
            "create_hub_with_owner_membership",
            {
                "p_owner_id": str(user_id),
                "p_name": payload.name,
                "p_description": payload.description,
                "p_icon_key": payload.icon_key,
                "p_color_key": payload.color_key,
            },
        ).execute()
        data = response.data or []
        if isinstance(data, dict):
            return Hub(**data)
        if not data:
            raise RuntimeError("Failed to create hub.")
        return Hub(**data[0])

    def update_hub(self, client: Client, hub_id: str, payload: HubUpdate) -> Hub:
        update_payload = payload.model_dump(exclude_none=True)
        if not update_payload:
            raise ValueError("No hub changes provided.")
        self._validate_hub_appearance(payload.icon_key, payload.color_key)

        update_response = (
            client.table("hubs")
            .update(update_payload)
            .eq("id", str(hub_id))
            .execute()
        )
        if not update_response.data:
            raise KeyError("Hub not found")
        response = (
            client.table("hubs")
            .select("id, owner_id, name, description, icon_key, color_key, created_at, archived_at, members_count, sources_count")
            .eq("id", str(hub_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Hub not found")
        return Hub(**response.data[0])

    def archive_hub(self, client: Client, hub_id: str) -> Hub:
        existing = client.table("hubs").select("id").eq("id", str(hub_id)).execute()
        if not existing.data:
            raise KeyError("Hub not found")
        now = datetime.now(timezone.utc).isoformat()
        client.table("hubs").update({"archived_at": now}).eq("id", str(hub_id)).execute()
        response = (
            client.table("hubs")
            .select("id, owner_id, name, description, icon_key, color_key, created_at, archived_at, members_count, sources_count")
            .eq("id", str(hub_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Hub not found")
        return Hub(**response.data[0])

    def unarchive_hub(self, client: Client, hub_id: str) -> Hub:
        existing = client.table("hubs").select("id").eq("id", str(hub_id)).execute()
        if not existing.data:
            raise KeyError("Hub not found")
        client.table("hubs").update({"archived_at": None}).eq("id", str(hub_id)).execute()
        response = (
            client.table("hubs")
            .select("id, owner_id, name, description, icon_key, color_key, created_at, archived_at, members_count, sources_count")
            .eq("id", str(hub_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Hub not found")
        return Hub(**response.data[0])

    def _validate_hub_appearance(self, icon_key: Optional[str], color_key: Optional[str]) -> None:
        if icon_key is not None and icon_key not in HUB_ICON_KEYS:
            raise ValueError("Invalid hub icon.")
        if color_key is not None and color_key not in HUB_COLOR_KEYS:
            raise ValueError("Invalid hub color.")

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

    def suggest_chat_prompt(self, client: Client, hub_id: str, source_ids: Optional[List[str]] = None) -> str:
        hub_response = (
            client.table("hubs")
            .select("id, name, description, sources_count")
            .eq("id", str(hub_id))
            .limit(1)
            .execute()
        )
        if not hub_response.data:
            raise KeyError("Hub not found")

        hub_row = hub_response.data[0]
        hub_name = str(hub_row.get("name") or "Hub")
        hub_description = str(hub_row.get("description") or "")
        all_sources = self.list_sources(client, str(hub_id))
        complete_sources_in_order = [
            source for source in all_sources
            if source.status == SourceStatus.complete
        ]
        complete_source_ids = [source.id for source in complete_sources_in_order]
        normalized_source_ids = self._normalize_source_ids_to_complete_order(source_ids, complete_source_ids)
        allowed_source_ids = set(normalized_source_ids)
        complete_sources = (
            complete_sources_in_order
            if source_ids is None
            else [source for source in complete_sources_in_order if source.id in allowed_source_ids]
        )

        source_names = [source.original_name for source in complete_sources[:6]]
        source_types = sorted({source.type.value for source in complete_sources})
        has_multiple_sources = len(complete_sources) > 1
        all_sources_selected = (
            len(complete_source_ids) > 1
            and len(normalized_source_ids) == len(complete_source_ids)
        )
        random_focus = None
        random_source_anchor = None
        if all_sources_selected:
            random_focus = random.choice([
                "action items, deadlines, and responsibilities",
                "key risks, blockers, and unresolved issues",
                "important themes and takeaways",
                "contradictions, overlaps, or differences between sources",
                "decisions already made and what still needs clarification",
            ])
            if complete_sources:
                if random_focus == "contradictions, overlaps, or differences between sources" and len(complete_sources) > 1:
                    anchor_sources = random.sample(complete_sources, 2)
                    random_source_anchor = ", ".join(source.original_name for source in anchor_sources)
                else:
                    random_source_anchor = random.choice(complete_sources).original_name

        system_prompt = (
            "You create one useful suggested user question for Caddie, a hub-based knowledge chat. "
            "Return exactly one plain-text question. No quotes, no bullets, no explanation. "
            "Keep it under 14 words when possible. Tailor it to the hub context and source list. "
            "The question must be answerable from the hub's uploaded sources. "
            "Prefer concrete prompts about action items, deadlines, risks, decisions, concepts, comparisons, or summaries. "
            "Do not mention recency, latest documents, dates ordering, or web search unless explicitly supported. "
            "When a preferred source anchor is provided, bias the suggestion toward that source or pair of sources."
        )
        user_prompt = (
            f"Hub name: {hub_name}\n"
            f"Hub description: {hub_description or 'None'}\n"
            f"Complete source count: {len(complete_sources)}\n"
            f"Complete source types: {', '.join(source_types) if source_types else 'None'}\n"
            f"Complete source names: {', '.join(source_names) if source_names else 'None'}\n"
            f"Multiple sources available: {'yes' if has_multiple_sources else 'no'}\n"
            f"All complete sources selected: {'yes' if all_sources_selected else 'no'}\n"
            f"Preferred focus for this suggestion: {random_focus or 'tailor naturally to the selected sources'}\n"
            f"Preferred source anchor: {random_source_anchor or 'none'}"
        )

        completion = self.llm_client.chat.completions.create(
            model=self.chat_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.8 if all_sources_selected else 0.4,
            max_tokens=60,
        )
        suggestion = (completion.choices[0].message.content or "").strip()
        suggestion = suggestion.splitlines()[0].strip().strip('"').strip("'")

        if not suggestion:
            if has_multiple_sources:
                return "Compare the selected sources"
            if complete_sources:
                return "Summarise the selected sources"
            return "What should this hub focus on?"
        return suggestion

    def get_source(self, client: Client, source_id: str) -> Source:
        response = client.table("sources").select("*").eq("id", str(source_id)).limit(1).execute()
        if not response.data:
            raise KeyError("Source not found")
        return Source(**response.data[0])

    def list_source_chunks(self, client: Client, source_id: str) -> List[dict]:
        response = (
            client.table("source_chunks")
            .select("chunk_index, text")
            .eq("source_id", str(source_id))
            .order("chunk_index")
            .execute()
        )
        return response.data or []

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

    def list_source_suggestions(
        self,
        client: Client,
        hub_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[SourceSuggestion]:
        query = client.table("source_suggestions").select("*")
        if hub_id:
            query = query.eq("hub_id", str(hub_id))
        if status:
            query = query.eq("status", status)
        response = query.order("created_at", desc=True).execute()
        return [SourceSuggestion(**row) for row in response.data]

    def get_source_suggestion(self, client: Client, suggestion_id: str) -> SourceSuggestion:
        response = client.table("source_suggestions").select("*").eq("id", str(suggestion_id)).limit(1).execute()
        if not response.data:
            raise KeyError("Source suggestion not found")
        return SourceSuggestion(**response.data[0])

    def update_source_suggestion(
        self,
        client: Client,
        suggestion_id: str,
        payload: dict,
        *,
        expected_status: Optional[SourceSuggestionStatus | str] = None,
    ) -> SourceSuggestion:
        query = client.table("source_suggestions").update(payload).eq("id", str(suggestion_id))
        if expected_status is not None:
            status_value = expected_status.value if isinstance(expected_status, SourceSuggestionStatus) else str(expected_status)
            query = query.eq("status", status_value)
        response = query.execute()
        if not response.data:
            if expected_status is not None:
                existing = (
                    client.table("source_suggestions")
                    .select("id")
                    .eq("id", str(suggestion_id))
                    .limit(1)
                    .execute()
                )
                if existing.data:
                    raise ConflictError("Source suggestion no longer in expected state")
            raise KeyError("Source suggestion not found")
        return SourceSuggestion(**response.data[0])

    def find_existing_source_for_suggestion(self, client: Client, suggestion: SourceSuggestion) -> Optional[Source]:
        sources = self.list_sources(client, suggestion.hub_id)
        if suggestion.type == SourceSuggestionType.web:
            if not suggestion.canonical_url:
                return None
            for source in sources:
                if source.type != SourceType.web:
                    continue
                metadata = source.ingestion_metadata if isinstance(source.ingestion_metadata, dict) else {}
                source_url = metadata.get("final_url") or metadata.get("url")
                if _canonicalize_web_url(str(source_url or "")) == suggestion.canonical_url:
                    return source
            return None
        if suggestion.type == SourceSuggestionType.youtube:
            if not suggestion.video_id:
                return None
            for source in sources:
                if source.type != SourceType.youtube:
                    continue
                metadata = source.ingestion_metadata if isinstance(source.ingestion_metadata, dict) else {}
                source_video_id = metadata.get("video_id") or _extract_youtube_video_id(str(metadata.get("url") or ""))
                if source_video_id == suggestion.video_id:
                    return source
        return None

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

    def list_invite_notifications(self, client: Client, user_id: str) -> List[dict[str, Any]]:
        response = (
            client.table("hub_members")
            .select("hub_id,role,invited_at, hubs (id, owner_id, name, description, created_at)")
            .eq("user_id", str(user_id))
            .is_("accepted_at", "null")
            .is_("invite_notification_dismissed_at", "null")
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

    def dismiss_invite_notification(self, client: Client, hub_id: str, user_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        response = (
            client.table("hub_members")
            .update({"invite_notification_dismissed_at": now})
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .is_("accepted_at", "null")
            .is_("invite_notification_dismissed_at", "null")
            .execute()
        )
        if not response.data:
            raise KeyError("Invite notification not found")

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
                    "invite_notification_dismissed_at": None,
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

    def update_member_role(
        self,
        client: Client,
        hub_id: str,
        user_id: str,
        role: AssignableMembershipRole,
    ) -> HubMember:
        target_member = self.get_member_role(client, hub_id, user_id)
        if target_member.role == MembershipRole.owner:
            raise ValueError("Transfer ownership before removing or changing the owner.")
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

    def transfer_hub_ownership(self, hub_id: str, current_owner_id: str, target_user_id: str) -> HubMember:
        response = self.service_client.rpc(
            "transfer_hub_ownership",
            {
                "p_hub_id": str(hub_id),
                "p_current_owner_id": str(current_owner_id),
                "p_target_user_id": str(target_user_id),
            },
        ).execute()
        data = response.data or []
        if not data:
            raise RuntimeError("Ownership transfer failed.")
        member_response = (
            self.service_client.table("hub_members")
            .select("hub_id,user_id,role,invited_at,accepted_at")
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(target_user_id))
            .limit(1)
            .execute()
        )
        if not member_response.data:
            raise KeyError("Transferred owner not found")
        return HubMember(**member_response.data[0])

    def remove_member(self, client: Client, hub_id: str, user_id: str) -> None:
        target_member = self.get_member_role(client, hub_id, user_id)
        if target_member.role == MembershipRole.owner:
            raise ValueError("Transfer ownership before removing or changing the owner.")
        response = (
            client.table("hub_members")
            .delete()
            .eq("hub_id", str(hub_id))
            .eq("user_id", str(user_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Member not found")

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

    def _service_message_rows(self, message_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        if not message_ids:
            return {}
        response = (
            self.service_client.table("messages")
            .select("id,session_id,role,content,citations,created_at")
            .in_("id", message_ids)
            .execute()
        )
        return {str(row["id"]): row for row in (response.data or [])}

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

    def update_hub_access(self, client: Client, hub_id: str, user_id: str) -> None:
        response = (
            self.service_client.table("hub_members")
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

    def _complete_source_ids_for_hub(self, client: Client, hub_id: str) -> List[str]:
        response = (
            client.table("sources")
            .select("id")
            .eq("hub_id", str(hub_id))
            .eq("status", SourceStatus.complete.value)
            .order("created_at", desc=True)
            .execute()
        )
        return [str(row["id"]) for row in (response.data or [])]

    def _normalize_source_ids_to_complete_order(
        self,
        requested_source_ids: Optional[List[str]],
        complete_source_ids: List[str],
    ) -> List[str]:
        if requested_source_ids is None:
            return []
        requested = {str(source_id) for source_id in requested_source_ids if str(source_id)}
        return [source_id for source_id in complete_source_ids if source_id in requested]

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

    def _list_session_messages(
        self,
        client: Client,
        session_id: str,
        fields: str = "id, role, content, citations, created_at",
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

    def _conversation_from_message_rows(self, rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
        return [
            {"role": row["role"], "content": row["content"]}
            for row in rows[-self.chat_rewrite_history_messages :]
        ]

    def _retrieval_context_from_message_rows(self, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [
            {
                "role": row["role"],
                "content": row["content"],
                "citations": row.get("citations") or [],
            }
            for row in rows[-self.chat_rewrite_history_messages :]
        ]

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

    def _serialize_flag_case(self, row: Dict[str, Any]) -> FlagCase:
        return FlagCase(**row)

    def _serialize_message_revision(self, row: Dict[str, Any]) -> MessageRevision:
        payload = dict(row)
        payload["citations"] = [Citation(**citation) for citation in (row.get("citations") or [])]
        return MessageRevision(**payload)

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
            metadata[message_id] = {
                "active_flag_id": active_flag_id,
                "flag_status": status_value,
            }
        return metadata

    def _serialize_session_message(
        self,
        message: Dict[str, Any],
        flag_metadata: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> SessionMessage:
        message_id = str(message["id"])
        metadata = (flag_metadata or {}).get(message_id, {})
        return SessionMessage(
            id=message_id,
            role=message["role"],
            content=message["content"],
            citations=[Citation(**citation) for citation in (message.get("citations") or [])],
            created_at=message["created_at"],
            active_flag_id=metadata.get("active_flag_id"),
            flag_status=metadata.get("flag_status", MessageFlagStatus.none.value),
        )

    def _visible_message_for_user(self, client: Client, message_id: str) -> Dict[str, Any]:
        response = (
            client.table("messages")
            .select("id,session_id,role,content,citations,created_at")
            .eq("id", str(message_id))
            .limit(1)
            .execute()
        )
        if not response.data:
            raise KeyError("Message not found")
        return response.data[0]

    def _service_message_row(self, message_id: str) -> Dict[str, Any]:
        response = (
            self.service_client.table("messages")
            .select("id,session_id,role,content,citations,created_at")
            .eq("id", str(message_id))
            .limit(1)
            .execute()
        )
        if not response.data:
            raise KeyError("Message not found")
        return response.data[0]

    def _get_flag_case_row(self, flag_case_id: str) -> Dict[str, Any]:
        response = (
            self.service_client.table("message_flag_cases")
            .select("*")
            .eq("id", str(flag_case_id))
            .limit(1)
            .execute()
        )
        if not response.data:
            raise KeyError("Flag case not found")
        return response.data[0]

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

    def _get_revision_row(self, revision_id: str) -> Dict[str, Any]:
        response = (
            self.service_client.table("message_revisions")
            .select("*")
            .eq("id", str(revision_id))
            .limit(1)
            .execute()
        )
        if not response.data:
            raise KeyError("Revision not found")
        return response.data[0]

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

    def _require_moderation_access(self, user_id: str, hub_id: str) -> None:
        if str(hub_id) not in self._moderated_hub_ids_for_user(user_id):
            raise PermissionError("Owner or admin role required.")

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
        flag_metadata = self._message_flag_metadata([str(message["id"]) for message in messages if message.get("role") == "assistant"])
        return ChatSessionDetail(
            session=session,
            messages=[self._serialize_session_message(message, flag_metadata) for message in messages],
        )

    def rename_chat_session(self, client: Client, user_id: str, session_id: str, title: str) -> None:
        self._require_chat_session_owner(client, user_id, session_id)
        self.service_client.table("chat_sessions").update(
            {"title": title}
        ).eq("id", str(session_id)).is_("deleted_at", "null").execute()

    def delete_chat_session(self, client: Client, user_id: str, session_id: str) -> None:
        row = self._require_chat_session_owner(client, user_id, session_id, include_deleted=True)
        if str(row.get("deleted_at") or "").strip():
            return
        self.service_client.table("chat_sessions").update(
            {"deleted_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", str(session_id)).is_("deleted_at", "null").execute()

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

    def flag_message(
        self,
        client: Client,
        user_id: str,
        message_id: str,
        payload: FlagMessageRequest,
    ) -> FlagMessageResponse:
        message_row = self._visible_message_for_user(client, message_id)
        if str(message_row.get("role") or "") != "assistant":
            raise ValueError("Only assistant messages can be flagged.")

        session_row = self._get_chat_session_row(client, str(message_row["session_id"]))
        self._require_hub_access(user_id, str(session_row["hub_id"]))
        existing = self._get_active_flag_case_for_message(message_id)
        if existing is not None:
            return FlagMessageResponse(
                flag_case=self._serialize_flag_case(existing),
                created=False,
            )

        try:
            inserted = self.service_client.rpc(
                "create_message_flag_case_with_original_revision",
                {
                    "p_message_id": str(message_row["id"]),
                    "p_created_by": str(user_id),
                    "p_reason": payload.reason.value,
                    "p_notes": payload.notes,
                },
            ).execute()
        except Exception as exc:
            if getattr(exc, "code", None) == "23505":
                existing = self._get_active_flag_case_for_message(message_id)
                if existing is not None:
                    return FlagMessageResponse(
                        flag_case=self._serialize_flag_case(existing),
                        created=False,
                    )
            raise
        data = inserted.data or []
        if isinstance(data, dict):
            return FlagMessageResponse(flag_case=self._serialize_flag_case(data), created=True)
        if not data:
            raise RuntimeError("Failed to create flag case.")
        return FlagMessageResponse(flag_case=self._serialize_flag_case(data[0]), created=True)

    def _list_flag_case_revisions(self, flag_case_id: str) -> List[MessageRevision]:
        response = self._execute_service_query_with_retry(
            lambda: (
                self.service_client.table("message_revisions")
                .select("*")
                .eq("flag_case_id", str(flag_case_id))
                .order("created_at", desc=False)
                .execute()
            )
        )
        return [self._serialize_message_revision(row) for row in (response.data or [])]

    def _execute_service_query_with_retry(self, query_fn, *, attempts: int = 3, delay_seconds: float = 0.2):
        last_error: Exception | None = None
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

    def _ensure_flag_case_open(self, case_row: Dict[str, Any]) -> None:
        if str(case_row.get("status") or "") not in {FlagCaseStatus.open.value, FlagCaseStatus.in_review.value}:
            raise ValueError("Closed flag cases cannot be edited.")

    def _flag_case_generation_context(
        self,
        flag_case_row: Dict[str, Any],
    ) -> tuple[Dict[str, Any], Dict[str, Any], List[Dict[str, str]], List[Dict[str, Any]], Optional[List[str]]]:
        session_row = self._get_chat_session_row(
            self.service_client,
            str(flag_case_row["session_id"]),
            include_deleted=True,
        )
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
        question_rows = self._flagged_question_rows(
            list({str(row["session_id"]) for row in flag_rows}),
            {str(row["message_id"]) for row in flag_rows},
        )

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

        hub_response = (
            self.service_client.table("hubs")
            .select("id,name")
            .eq("id", str(case_row["hub_id"]))
            .limit(1)
            .execute()
        )
        hub_name = str((hub_response.data or [{}])[0].get("name") or "Hub")
        session_row = self._get_chat_session_row(
            self.service_client,
            str(case_row["session_id"]),
            include_deleted=True,
        )
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
        answer, citations, _usage = self._generate_chat_answer(
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
            self.service_client.table("message_flag_cases").update(
                {"status": FlagCaseStatus.in_review.value}
            ).eq("id", str(flag_case_id)).execute()
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
            self.service_client.table("message_flag_cases").update(
                {"status": FlagCaseStatus.in_review.value}
            ).eq("id", str(flag_case_id)).execute()
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
            .update(
                {
                    "status": FlagCaseStatus.dismissed.value,
                    "reviewed_by": str(user_id),
                    "reviewed_at": now,
                }
            )
            .eq("id", str(flag_case_id))
            .execute()
        )
        if not updated.data:
            raise RuntimeError("Failed to dismiss flag case.")
        return self._serialize_flag_case(updated.data[0])

    def _select_matches(
        self,
        raw_matches: List[Dict[str, Any]],
        query_embedding: List[float],
        min_similarity: float,
        max_citations: int,
        fallback_mode: str,
    ) -> List[Dict[str, Any]]:
        filtered_matches = [match for match in raw_matches if float(match.get("similarity") or 0) >= min_similarity]
        if filtered_matches:
            return self._rerank_matches(filtered_matches, query_embedding, max_citations)
        if fallback_mode == "chat" and raw_matches:
            return raw_matches[:1]
        if fallback_mode == "guide" and raw_matches:
            return raw_matches[:max_citations]
        return []

    def _rerank_matches(
        self,
        matches: List[Dict[str, Any]],
        query_embedding: List[float],
        max_citations: int,
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

        if len(distinct_sources) >= 2:
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

        cleaned: List[Dict[str, Any]] = []
        for candidate in selected:
            row = dict(candidate)
            row.pop("_rank", None)
            row.pop("_normalized_embedding", None)
            row.pop("_query_similarity", None)
            cleaned.append(row)
        return cleaned

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
    ) -> tuple[str, List[Citation], Optional[Dict[str, Any]]]:
        retrieval_query = question
        rewrite_attempted = False
        is_vague_follow_up = _is_vague_follow_up(question)
        if self.chat_rewrite_enabled and retrieval_history and is_vague_follow_up:
            retrieval_query = self._rewrite_query_for_retrieval(question, retrieval_history)
            rewrite_attempted = True

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
                raw_matches, citations, context_blocks = self._retrieve_chat_context(
                    client,
                    hub_id,
                    rewritten_query,
                    retrieval_source_ids,
                )

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

        if scope == HubScope.global_scope:
            answer, web_citations, usage = self._answer_with_web_search(question, context_blocks)
            all_citations = citations + web_citations
            if not _answer_has_citation(answer, len(all_citations)):
                all_citations = []
            return answer, all_citations, usage

        system_prompt = (
            "You are Caddie, an onboarding assistant. Answer using the provided context only. "
            "If the context is insufficient, say you don't have enough information. "
            "Cite sources inline using [n] that matches the context list, and only include citations when you are "
            "directly using the cited content. "
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
        user_prompt = f"Question: {question}\n\nContext:\n" + "\n".join(context_blocks)

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
                    {"role": "user", "content": question},
                ],
                temperature=0.2,
            )
            answer = completion.choices[0].message.content or ""
            usage = completion.usage.model_dump() if completion.usage else None
            return answer, [], usage

        completion = self.llm_client.chat.completions.create(
            model=self.chat_model,
            messages=[
                {"role": "system", "content": system_prompt},
                *history_messages,
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
        raw_answer = completion.choices[0].message.content or ""
        usage = completion.usage.model_dump() if completion.usage else None

        answer, quotes = _extract_quotes(raw_answer)
        for idx_str, pairs in quotes.items():
            try:
                citation_idx = int(str(idx_str).strip()) - 1
            except (TypeError, ValueError):
                continue
            if 0 <= citation_idx < len(citations):
                snippet = citations[citation_idx].snippet
                verified = _match_quote_pairs_to_snippet(pairs, snippet)
                if verified:
                    citations[citation_idx].relevant_quotes = [v[0] for v in verified]
                    citations[citation_idx].paraphrased_quotes = [v[1] for v in verified]

        has_citations = _answer_has_citation(answer, len(context_blocks)) or bool(quotes)
        final_citations = citations if has_citations else []
        return answer, final_citations, usage

    def chat(self, client: Client, user_id: str, payload: ChatRequest) -> ChatResponse:
        hub_id = str(payload.hub_id)
        requested_source_ids = None if payload.source_ids is None else [str(source_id) for source_id in payload.source_ids]
        persisted_source_ids, retrieval_source_ids = self._normalize_chat_source_ids(
            client,
            hub_id,
            requested_source_ids,
        )

        existing_session_id: Optional[str] = None
        session_title: str
        if payload.session_id is not None:
            existing_session_id = str(payload.session_id)
            session_row = self._get_chat_session_row(client, existing_session_id)
            if str(session_row["hub_id"]) != hub_id:
                raise KeyError("Chat session not found")
            session_title = str(session_row.get("title") or "New Chat")
            history_messages = self._recent_conversation(client, existing_session_id)
            retrieval_history = self._recent_retrieval_context(client, existing_session_id)
            client.table("messages").insert(
                {"session_id": existing_session_id, "role": "user", "content": payload.question}
            ).execute()
        else:
            session_title = self._generate_chat_session_title(payload.question)
            history_messages = []
            retrieval_history = []
        def finalize_response(
            answer: str,
            response_citations: List[Citation],
            usage: Optional[Dict[str, Any]],
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
                return ChatResponse(
                    answer=answer,
                    citations=response_citations,
                    message_id=str(persisted["assistant_message_id"]),
                    session_id=str(persisted["session_id"]),
                    session_title=str(persisted.get("session_title") or session_title or "New Chat"),
                    flag_status=MessageFlagStatus.none.value,
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
            return ChatResponse(
                answer=answer,
                citations=response_citations,
                message_id=assistant_row.data[0]["id"],
                session_id=existing_session_id,
                session_title=session_title,
                flag_status=MessageFlagStatus.none.value,
            )

        answer, citations, usage = self._generate_chat_answer(
            client,
            hub_id=hub_id,
            question=payload.question,
            scope=payload.scope,
            retrieval_source_ids=retrieval_source_ids,
            history_messages=history_messages,
            retrieval_history=retrieval_history,
        )
        return finalize_response(answer, citations, usage)

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
            raw_matches = self._match_chunks(client, hub_id, query_embedding, self.retrieval_candidate_pool, source_ids)
            matches = self._select_matches(
                raw_matches,
                query_embedding,
                self.faq_min_similarity,
                self.faq_max_citations,
                fallback_mode="faq",
            )
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
            .update({"archived_at": now, "updated_at": now, "updated_by": user_id})
            .eq("hub_id", hub_id)
            .is_("archived_at", "null")
            .eq("is_pinned", False)
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
            raw_matches = self._match_chunks(client, hub_id, query_embedding, self.retrieval_candidate_pool, source_ids)
            matches = self._select_matches(
                raw_matches,
                query_embedding,
                self.guide_min_similarity,
                self.guide_max_citations,
                fallback_mode="guide",
            )
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

    def get_reminder(self, client: Client, reminder_id: str) -> Reminder:
        response = client.table("reminders").select("*").eq("id", reminder_id).execute()
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
        select = "id, reminder_id, channel, status, scheduled_for, sent_at, dismissed_at, reminders (id, hub_id, source_id, due_at, message, status, hubs (name))"
        query = (
            client.table("notifications")
            .select(select)
            .eq("user_id", user_id)
            .is_("dismissed_at", "null")
            .not_.in_("reminders.status", [ReminderStatus.completed.value, ReminderStatus.cancelled.value])
        )
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
            hub_row = reminder_row.get("hubs") or {}
            if isinstance(hub_row, list):
                hub_row = hub_row[0] if hub_row else {}
            reminder_row = {**reminder_row, "hub_name": hub_row.get("name")}
            reminder = ReminderSummary(**reminder_row)
            events.append(
                NotificationEvent(
                    id=row["id"],
                    reminder_id=row["reminder_id"],
                    channel=row["channel"],
                    status=row["status"],
                    scheduled_for=row["scheduled_for"],
                    sent_at=row.get("sent_at"),
                    dismissed_at=row.get("dismissed_at"),
                    reminder=reminder,
                )
            )
        return events

    def dismiss_notification(self, client: Client, user_id: str, notification_id: str) -> NotificationEvent:
        now = datetime.now(timezone.utc).isoformat()
        response = (
            client.table("notifications")
            .update({"dismissed_at": now})
            .eq("id", notification_id)
            .eq("user_id", user_id)
            .is_("dismissed_at", "null")
            .execute()
        )
        if not response.data:
            raise KeyError("Notification not found")
        row = response.data[0]
        reminder_response = (
            client.table("notifications")
            .select("id, reminder_id, channel, status, scheduled_for, sent_at, dismissed_at, reminders (id, hub_id, source_id, due_at, message, status, hubs (name))")
            .eq("id", notification_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not reminder_response.data:
            raise KeyError("Notification not found")
        row = reminder_response.data[0]
        reminder_row = row.get("reminders") or {}
        if isinstance(reminder_row, list):
            reminder_row = reminder_row[0] if reminder_row else {}
        if not reminder_row:
            raise KeyError("Notification reminder not found")
        hub_row = reminder_row.get("hubs") or {}
        if isinstance(hub_row, list):
            hub_row = hub_row[0] if hub_row else {}
        return NotificationEvent(
            id=row["id"],
            reminder_id=row["reminder_id"],
            channel=row["channel"],
            status=row["status"],
            scheduled_for=row["scheduled_for"],
            sent_at=row.get("sent_at"),
            dismissed_at=row.get("dismissed_at"),
            reminder=ReminderSummary(**{**reminder_row, "hub_name": hub_row.get("name")}),
        )

    def log_activity(
        self,
        client: Client,
        hub_id: str,
        user_id: str,
        action: str,
        resource_type: str,
        resource_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        row: Dict[str, Any] = {
            "hub_id": hub_id,
            "user_id": user_id,
            "action": action,
            "resource_type": resource_type,
        }
        if resource_id is not None:
            row["resource_id"] = resource_id
        if metadata:
            row["metadata"] = metadata
        try:
            client.table("activity_events").insert(row).execute()
        except Exception:
            pass

    def list_activity(
        self,
        client: Client,
        user_id: str,
        hub_id: Optional[str] = None,
        hub_ids: Optional[List[str]] = None,
        limit: int = 50,
    ) -> List[ActivityEvent]:
        query = client.table("activity_events").select("*")
        if hub_id:
            query = query.eq("hub_id", hub_id)
        elif hub_ids is not None:
            if not hub_ids:
                return []
            query = query.in_("hub_id", hub_ids)
        response = (
            query
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )

        rows = [dict(row) for row in (response.data or [])]
        actor_ids = {
            str(row.get("user_id") or "")
            for row in rows
            if row.get("user_id") and str(row.get("user_id")) != str(user_id)
        }
        actor_lookup = self._resolve_user_labels_by_ids(actor_ids)

        events: List[ActivityEvent] = []
        for row in rows:
            metadata = dict(row.get("metadata") or {})
            actor_id = str(row.get("user_id") or "")
            metadata["actor_label"] = "You" if actor_id == str(user_id) else actor_lookup.get(actor_id, "Someone")
            row["metadata"] = metadata
            events.append(ActivityEvent(**row))
        return events

    def _resolve_user_labels_by_ids(self, user_ids: set[str]) -> Dict[str, str]:
        if not user_ids:
            return {}

        profile_lookup = self.resolve_user_profiles_by_ids(user_ids)
        return {
            user_id: profile.display_name or profile.email or user_id
            for user_id, profile in profile_lookup.items()
        }

    def resolve_user_profiles_by_ids(self, user_ids: set[str]) -> Dict[str, UserProfileSummary]:
        if not user_ids:
            return {}

        profile_lookup: Dict[str, UserProfileSummary] = {}
        remaining = set(user_ids)
        page = 1
        per_page = 100

        try:
            while remaining:
                try:
                    response = self.service_client.auth.admin.list_users(page=page, per_page=per_page)
                except TypeError:
                    response = self.service_client.auth.admin.list_users()
                    users = self._extract_admin_users(response)
                    for user in users:
                        user_id = str(getattr(user, "id", "") or "")
                        if user_id not in remaining:
                            continue
                        profile_lookup[user_id] = self._profile_summary_for_user(user, user_id)
                        remaining.discard(user_id)
                    break

                users = self._extract_admin_users(response)
                if not users:
                    break
                for user in users:
                    user_id = str(getattr(user, "id", "") or "")
                    if user_id not in remaining:
                        continue
                    profile_lookup[user_id] = self._profile_summary_for_user(user, user_id)
                    remaining.discard(user_id)
                if len(users) < per_page:
                    break
                page += 1
        except Exception:
            return {}

        return profile_lookup

    @staticmethod
    def _extract_admin_users(response: Any) -> List[Any]:
        if isinstance(response, list):
            return response
        if hasattr(response, "users"):
            return list(getattr(response, "users") or [])
        data = getattr(response, "data", None)
        if isinstance(data, list):
            return data
        if hasattr(data, "users"):
            return list(getattr(data, "users") or [])
        if isinstance(data, dict):
            users = data.get("users")
            if isinstance(users, list):
                return users
        return []

    @staticmethod
    def _display_label_for_user(user: Any, fallback: str) -> str:
        profile = SupabaseStore._profile_summary_for_user(user, fallback)
        return profile.display_name or profile.email or fallback

    @staticmethod
    def _profile_summary_for_user(user: Any, fallback: str) -> UserProfileSummary:
        metadata = getattr(user, "user_metadata", None) or {}
        full_name = (metadata.get("full_name") or "").strip() if isinstance(metadata, dict) else ""
        email = getattr(user, "email", None) or ""
        avatar_mode = (metadata.get("avatar_mode") or "").strip() if isinstance(metadata, dict) else ""
        avatar_key = (metadata.get("avatar_key") or "").strip() if isinstance(metadata, dict) else ""
        avatar_color = (metadata.get("avatar_color") or "").strip() if isinstance(metadata, dict) else ""
        return UserProfileSummary(
            user_id=str(getattr(user, "id", "") or fallback),
            email=email or None,
            display_name=full_name or email or fallback,
            avatar_mode=avatar_mode or None,
            avatar_key=avatar_key or None,
            avatar_color=avatar_color or None,
        )

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




def _trim_text(text: str, max_chars: int) -> str:
    cleaned = " ".join((text or "").split()).strip()
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars].rstrip()}..."


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


def _fallback_chat_session_title(text: str) -> str:
    collapsed = " ".join((text or "").split()).strip()
    if not collapsed:
        return "New Chat"
    words = collapsed.split()[:5]
    normalized = " ".join(words)
    return normalized[:80].strip() or "New Chat"


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


class _QuotePair:
    """A paraphrase + approximate direct quote pair from the LLM."""

    __slots__ = ("paraphrase", "quote")

    def __init__(self, paraphrase: str, quote: str) -> None:
        self.paraphrase = paraphrase
        self.quote = quote


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


def _most_recent_informative_user_turn(history: List[Dict[str, Any]]) -> Optional[str]:
    for message in reversed(history):
        if str(message.get("role") or "") != "user":
            continue
        content = str(message.get("content") or "").strip()
        if content and not _is_vague_follow_up(content):
            return content
    return None


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


def _has_context_reference(tokens: List[str]) -> bool:
    for index, token in enumerate(tokens):
        if token in {"that", "it", "those", "these"}:
            return True
        if token in {"there", "here"} and index == len(tokens) - 1:
            return True
        if token == "this" and index == len(tokens) - 1:
            return True
    return False


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


def _preview_text(value: Any, limit: int = 140) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 1)].rstrip()}..."


def _escape_ilike_pattern(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


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


def _chat_search_score(session_title: str, snippet: str, matched_text: str, matched_role: str) -> int:
    haystack = f"{session_title} {snippet}".lower()
    needle = (matched_text or "").lower()
    if not haystack or not needle:
        return 0
    occurrences = haystack.count(needle)
    starts_sentence = 1 if needle and needle in haystack[: max(len(needle) + 16, 24)] else 0
    title_boost = 100 if matched_role == "title" else 0
    return title_boost + occurrences * 10 + starts_sentence


def _average_similarity(matches: List[Dict[str, Any]]) -> float:
    if not matches:
        return 0.0
    values = [float(match.get("similarity") or 0) for match in matches]
    return sum(values) / len(values)


def _normalize_embedding_value(value: Any) -> Optional[List[float]]:
    vector = _coerce_embedding_value(value)
    if vector is None:
        return None
    return _normalize_vector(vector)


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


def _normalize_vector(vector: Optional[List[float]]) -> Optional[List[float]]:
    if not vector:
        return None
    magnitude = math.sqrt(sum(value * value for value in vector))
    if magnitude <= 0:
        return None
    return [value / magnitude for value in vector]


def _cosine_similarity(left: Optional[List[float]], right: Optional[List[float]]) -> float:
    if left is None or right is None or len(left) != len(right):
        return 0.0
    return sum(left_value * right_value for left_value, right_value in zip(left, right))


def _get_attr(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _is_missing_hub_optional_column_error(exc: APIError) -> bool:
    message = (getattr(exc, "message", "") or str(exc)).lower()
    if "column" not in message or "does not exist" not in message:
        return False
    return "icon_key" in message or "archived_at" in message


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
