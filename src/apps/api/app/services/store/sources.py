"""SourceStoreMixin: manages source creation, lookup, refresh, and source suggestion workflows."""

from datetime import datetime, timezone
import random
from typing import List, Optional, Tuple
import uuid

from supabase import Client

from ...schemas import (
    Source,
    SourceCreate,
    SourceStatus,
    SourceStatusResponse,
    SourceSuggestion,
    SourceSuggestionStatus,
    SourceSuggestionType,
    SourceType,
    WebSourceCreate,
    YouTubeSourceCreate,
)
from .base import ConflictError
from .source_helpers import (
    _build_web_source_name,
    _build_youtube_source_name,
    _canonicalize_web_url,
    _extract_youtube_video_id,
    _sanitize_filename,
    _web_storage_path,
    _youtube_storage_path,
)


class SourceStoreMixin:
    # Create a file-backed source row and return it with a signed upload URL.
    def create_source(self, client: Client, payload: SourceCreate) -> Tuple[Source, str]:
        source_id = str(uuid.uuid4())
        hub_id = str(payload.hub_id)
        safe_name = _sanitize_filename(payload.original_name)
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

    # Create a queued web source that will later be ingested from the stored URL.
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
        return Source(**response.data[0])

    # Create a queued YouTube source after validating and extracting its video id.
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
        return Source(**response.data[0])

    # List all sources in a hub, newest first.
    def list_sources(self, client: Client, hub_id: str) -> List[Source]:
        response = client.table("sources").select("*").eq("hub_id", str(hub_id)).order("created_at", desc=True).execute()
        return [Source(**row) for row in response.data]

    # Generate one suggested chat prompt based on the hub and the currently selected complete sources.
    def suggest_chat_prompt(self, client: Client, hub_id: str, source_ids: Optional[List[str]] = None) -> str:
        hub_response = client.table("hubs").select("id, name, description, sources_count").eq("id", str(hub_id)).limit(1).execute()
        if not hub_response.data:
            raise KeyError("Hub not found")
        hub_row = hub_response.data[0]
        hub_name = str(hub_row.get("name") or "Hub")
        hub_description = str(hub_row.get("description") or "")
        all_sources = self.list_sources(client, str(hub_id))
        complete_sources_in_order = [source for source in all_sources if source.status == SourceStatus.complete]
        complete_source_ids = [source.id for source in complete_sources_in_order]
        normalized_source_ids = self._normalize_source_ids_to_complete_order(source_ids, complete_source_ids)
        allowed_source_ids = set(normalized_source_ids)
        complete_sources = complete_sources_in_order if source_ids is None else [source for source in complete_sources_in_order if source.id in allowed_source_ids]
        source_names = [source.original_name for source in complete_sources[:6]]
        source_types = sorted({source.type.value for source in complete_sources})
        has_multiple_sources = len(complete_sources) > 1
        all_sources_selected = len(complete_source_ids) > 1 and len(normalized_source_ids) == len(complete_source_ids)
        random_focus = None
        random_source_anchor = None
        if all_sources_selected:
            # Add a little variability only when the user is looking across the full hub.
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
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
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

    # Fetch one source by id.
    def get_source(self, client: Client, source_id: str) -> Source:
        response = client.table("sources").select("*").eq("id", str(source_id)).limit(1).execute()
        if not response.data:
            raise KeyError("Source not found")
        return Source(**response.data[0])

    # Return the stored chunk text for a source in chunk order.
    def list_source_chunks(self, client: Client, source_id: str) -> List[dict]:
        response = client.table("source_chunks").select("chunk_index, text").eq("source_id", str(source_id)).order("chunk_index").execute()
        return response.data or []

    # Delete a source row and best-effort remove its stored file, if any.
    def delete_source(self, client: Client, source_id: str) -> None:
        source = self.get_source(client, source_id)
        response = client.table("sources").delete().eq("id", str(source_id)).execute()
        if not response.data:
            raise KeyError("Source not found")
        if source.storage_path:
            try:
                self.service_client.storage.from_(self.storage_bucket).remove([source.storage_path])
            except Exception:
                pass

    # Set the ingestion status and optional failure reason for a source.
    def set_source_status(self, client: Client, source_id: str, status: SourceStatus, failure_reason: Optional[str] = None) -> Source:
        response = client.table("sources").update({"status": status.value, "failure_reason": failure_reason}).eq("id", str(source_id)).execute()
        if not response.data:
            raise KeyError("Source not found")
        return Source(**response.data[0])

    # Dispatch refresh handling based on the source type and return refresh metadata for the caller.
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

    # Queue a fresh web ingestion by updating the storage path and refresh metadata.
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
            .update({"storage_path": new_path, "status": SourceStatus.queued.value, "failure_reason": None, "ingestion_metadata": metadata})
            .eq("id", str(source_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Source not found")
        return Source(**response.data[0]), url

    # Queue a fresh YouTube ingestion while preserving the existing ingestion metadata.
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
            .update({"storage_path": new_path, "status": SourceStatus.queued.value, "failure_reason": None, "ingestion_metadata": refreshed_metadata})
            .eq("id", str(source_id))
            .execute()
        )
        if not response.data:
            raise KeyError("Source not found")
        return Source(**response.data[0]), {"url": url, "video_id": video_id, "language": language, "allow_auto_captions": allow_auto_captions}

    # Return the current ingestion status payload for one source.
    def get_source_status(self, client: Client, source_id: str) -> SourceStatusResponse:
        response = client.table("sources").select("id,status,failure_reason").eq("id", str(source_id)).execute()
        if not response.data:
            raise KeyError("Source not found")
        row = response.data[0]
        return SourceStatusResponse(id=row["id"], status=row["status"], failure_reason=row.get("failure_reason"))

    # Create a signed upload URL for the caller to send a file directly to storage.
    def create_upload_url(self, storage_path: str) -> str:
        upload = self.service_client.storage.from_(self.storage_bucket).create_signed_upload_url(storage_path)
        upload_url = upload.get("signedURL") or upload.get("signedUrl") or upload.get("signed_url")
        if not upload_url:
            raise RuntimeError("Failed to create signed upload URL")
        return upload_url

    # List source suggestions with optional hub and status filters.
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

    # Fetch one source suggestion by id.
    def get_source_suggestion(self, client: Client, suggestion_id: str) -> SourceSuggestion:
        response = client.table("source_suggestions").select("*").eq("id", str(suggestion_id)).limit(1).execute()
        if not response.data:
            raise KeyError("Source suggestion not found")
        return SourceSuggestion(**response.data[0])

    # Update a suggestion and optionally enforce its current state for optimistic concurrency.
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
                existing = client.table("source_suggestions").select("id").eq("id", str(suggestion_id)).limit(1).execute()
                if existing.data:
                    raise ConflictError("Source suggestion no longer in expected state")
            raise KeyError("Source suggestion not found")
        return SourceSuggestion(**response.data[0])

    # Check whether a suggestion already maps to an existing source in the same hub.
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

    # Map source ids to display names for analytics and moderation surfaces.
    def _source_name_map(self, source_ids: List[str]) -> dict[str, str]:
        if not source_ids:
            return {}
        response = self.service_client.table("sources").select("id, original_name").in_("id", source_ids).execute()
        return {str(row["id"]): str(row.get("original_name") or "") for row in (response.data or []) if row.get("id")}
