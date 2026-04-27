"""Background source suggestion scanning and discovery helpers."""

import json
import ssl
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import redis
from openai import OpenAI
from supabase import Client

from . import common as _common
from . import response_utils as _response_utils
from . import web as _web
from . import youtube as _youtube
from .app import logger, settings


def scan_source_suggestions() -> dict:
    client = _common._get_supabase_client()
    now = datetime.now(timezone.utc)
    eligible_hubs = _list_eligible_source_suggestion_hubs(client, now=now)
    processed = 0
    generated = 0

    for hub in eligible_hubs:
        hub_id = str(hub.get("id") or "")
        if not hub_id:
            continue
        lock = _acquire_source_suggestion_lock(hub_id)
        if lock is None:
            logger.info("worker.source_suggestions.lock_held hub_id=%s", hub_id)
            continue
        try:
            result = _generate_source_suggestions_for_hub(client, hub_id, now=now)
            processed += 1
            generated += int(result.get("inserted", 0) or 0)
        except Exception:
            logger.exception("worker.source_suggestions.failed hub_id=%s", hub_id)
            _mark_source_suggestion_scan(client, hub_id, now=now, generated=False)
        finally:
            _release_source_suggestion_lock(lock)

    return {"eligible_hubs": len(eligible_hubs), "processed_hubs": processed, "generated": generated}


def _get_redis_client() -> redis.Redis:
    redis_url = settings.redis_url
    client_kwargs: dict = {}

    if redis_url.lower().startswith("rediss://"):
        parsed = urlparse(redis_url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        ssl_cert_reqs_raw = (query.get("ssl_cert_reqs") or [None])[-1]
        if isinstance(ssl_cert_reqs_raw, str):
            mapped = {
                "cert_none": ssl.CERT_NONE,
                "none": ssl.CERT_NONE,
                "0": ssl.CERT_NONE,
                "cert_optional": ssl.CERT_OPTIONAL,
                "optional": ssl.CERT_OPTIONAL,
                "1": ssl.CERT_OPTIONAL,
                "cert_required": ssl.CERT_REQUIRED,
                "required": ssl.CERT_REQUIRED,
                "2": ssl.CERT_REQUIRED,
            }.get(ssl_cert_reqs_raw.strip().lower())
            if mapped is not None:
                client_kwargs["ssl_cert_reqs"] = mapped
                if mapped == ssl.CERT_NONE:
                    client_kwargs["ssl_check_hostname"] = False
                query.pop("ssl_cert_reqs", None)
                redis_url = urlunparse(
                    (
                        parsed.scheme,
                        parsed.netloc,
                        parsed.path,
                        parsed.params,
                        urlencode(query, doseq=True),
                        parsed.fragment,
                    )
                )

    return redis.Redis.from_url(redis_url, **client_kwargs)


def _acquire_source_suggestion_lock(hub_id: str) -> Optional[tuple[redis.Redis, str, str]]:
    client = _get_redis_client()
    key = f"locks:source-suggestions:{hub_id}"
    token = str(uuid.uuid4())
    try:
        acquired = client.set(key, token, nx=True, ex=max(60, settings.suggested_sources_lock_ttl_seconds))
    except Exception:
        client.close()
        raise
    if not acquired:
        client.close()
        return None
    return client, key, token


def _release_source_suggestion_lock(lock: tuple[redis.Redis, str, str]) -> None:
    client, key, token = lock
    try:
        current = client.get(key)
        if current is not None and current.decode("utf-8", errors="ignore") == token:
            client.delete(key)
    finally:
        client.close()


def _list_eligible_source_suggestion_hubs(client: Client, now: Optional[datetime] = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    hubs_response = client.table("hubs").select("id,last_source_suggestion_scan_at").execute()
    hubs = hubs_response.data or []
    if not hubs:
        return []

    complete_counts: dict[str, int] = defaultdict(int)
    for row in client.table("sources").select("hub_id").eq("status", "complete").execute().data or []:
        hub_id = str(row.get("hub_id") or "")
        if hub_id:
            complete_counts[hub_id] += 1

    active_cutoff = now - timedelta(days=max(1, settings.suggested_sources_active_days))
    active_hub_ids = {
        str(row.get("hub_id"))
        for row in (
            client.table("hub_members")
            .select("hub_id")
            .not_.is_("accepted_at", "null")
            .gte("last_accessed_at", active_cutoff.isoformat())
            .execute()
            .data
            or []
        )
        if row.get("hub_id")
    }
    pending_hub_ids = {
        str(row.get("hub_id"))
        for row in client.table("source_suggestions").select("hub_id").eq("status", "pending").execute().data or []
        if row.get("hub_id")
    }
    return _filter_eligible_source_suggestion_hubs(
        hubs,
        complete_source_counts=complete_counts,
        active_hub_ids=active_hub_ids,
        pending_hub_ids=pending_hub_ids,
        now=now,
    )


def _filter_eligible_source_suggestion_hubs(
    hubs: list[dict],
    *,
    complete_source_counts: dict[str, int],
    active_hub_ids: set[str],
    pending_hub_ids: set[str],
    now: datetime,
) -> list[dict]:
    eligible: list[dict] = []
    cooldown = timedelta(minutes=max(1, settings.suggested_sources_hub_cooldown_minutes))
    min_sources = max(1, settings.suggested_sources_min_complete_sources)

    for hub in hubs:
        hub_id = str(hub.get("id") or "")
        if not hub_id:
            continue
        if hub_id in pending_hub_ids:
            continue
        if complete_source_counts.get(hub_id, 0) < min_sources:
            continue
        if hub_id not in active_hub_ids:
            continue
        last_scan = _common._parse_iso(hub.get("last_source_suggestion_scan_at"))
        if last_scan is not None and last_scan > now - cooldown:
            continue
        eligible.append(hub)
    return eligible


def _generate_source_suggestions_for_hub(client: Client, hub_id: str, now: Optional[datetime] = None) -> dict:
    now = now or datetime.now(timezone.utc)
    seed_source_ids, context_text = _build_source_suggestion_context(client, hub_id)
    if len(seed_source_ids) < settings.suggested_sources_min_complete_sources or not context_text.strip():
        _mark_source_suggestion_scan(client, hub_id, now=now, generated=False)
        return {"inserted": 0, "reason": "insufficient_context"}

    discovered, search_metadata = _discover_source_suggestions(context_text)
    normalized = _normalize_source_suggestion_candidates(
        discovered,
        hub_id=hub_id,
        seed_source_ids=seed_source_ids,
        search_metadata=search_metadata,
    )
    existing_suggestion_targets = _load_existing_source_suggestion_targets(client, hub_id)
    existing_source_targets = _load_existing_source_targets(client, hub_id)
    pending_rows = _filter_new_source_suggestions(
        normalized,
        existing_source_targets=existing_source_targets,
        existing_suggestion_targets=existing_suggestion_targets,
        limit=max(1, settings.suggested_sources_batch_limit),
    )
    if pending_rows:
        client.table("source_suggestions").insert(pending_rows).execute()
    _mark_source_suggestion_scan(client, hub_id, now=now, generated=bool(pending_rows))
    return {"inserted": len(pending_rows)}


def _build_source_suggestion_context(client: Client, hub_id: str) -> tuple[list[str], str]:
    source_rows = (
        client.table("sources")
        .select("id,type,original_name,ingestion_metadata,created_at")
        .eq("hub_id", hub_id)
        .eq("status", "complete")
        .order("created_at", desc=True)
        .limit(max(1, settings.suggested_sources_context_limit))
        .execute()
        .data
        or []
    )
    if not source_rows:
        return [], ""

    source_ids = [str(row.get("id")) for row in source_rows if row.get("id")]
    chunk_rows = []
    if source_ids:
        chunk_rows = (
            client.table("source_chunks")
            .select("source_id,chunk_index,text")
            .in_("source_id", source_ids)
            .order("chunk_index")
            .execute()
            .data
            or []
        )

    excerpts: dict[str, list[str]] = defaultdict(list)
    max_chunks = max(1, settings.suggested_sources_chunks_per_source)
    for row in chunk_rows:
        source_id = str(row.get("source_id") or "")
        text = _common._normalize_text(str(row.get("text") or ""))
        if not source_id or not text or len(excerpts[source_id]) >= max_chunks:
            continue
        excerpts[source_id].append(_common._trim_text(text, 500))

    blocks: list[str] = []
    for row in source_rows:
        source_id = str(row.get("id") or "")
        source_type = str(row.get("type") or "file")
        title = str(row.get("original_name") or source_id)
        metadata = row.get("ingestion_metadata") if isinstance(row.get("ingestion_metadata"), dict) else {}
        lines = [f"Source ID: {source_id}", f"Type: {source_type}", f"Title: {title}"]
        if source_type == "web":
            url = metadata.get("final_url") or metadata.get("url")
            if url:
                lines.append(f"URL: {url}")
        if source_type == "youtube":
            channel = metadata.get("channel")
            if channel:
                lines.append(f"Channel: {channel}")
            video_id = metadata.get("video_id")
            if video_id:
                lines.append(f"Video ID: {video_id}")
        for idx, excerpt in enumerate(excerpts.get(source_id, []), start=1):
            lines.append(f"Excerpt {idx}: {excerpt}")
        blocks.append("\n".join(lines))
    return source_ids, "\n\n".join(blocks)


def _discover_source_suggestions(context_text: str) -> tuple[list[dict], dict]:
    if not settings.openai_api_key:
        logger.warning("Skipping source suggestions because OPENAI_API_KEY is missing")
        return [], {"error": "missing_openai_api_key"}

    llm_client = OpenAI(api_key=settings.openai_api_key)
    responses_client = getattr(llm_client, "responses", None)
    if responses_client is None:
        logger.warning("Skipping source suggestions because Responses API is unavailable")
        return [], {"error": "responses_api_unavailable"}

    system_prompt = (
        "You find suggested sources for a study hub. Use web search to find public resources that complement the existing hub material. "
        "Return only a JSON array with up to 6 objects. Each object must include: "
        "type ('web' or 'youtube'), url, title, description, rationale, confidence. "
        "Prefer authoritative pages and relevant YouTube videos. When relevant, include at least 1 YouTube video in the returned set. "
        "Avoid login pages, homepages with no clear relevance, PDFs, and duplicates."
    )
    user_prompt = f"Hub context:\n{context_text}"

    try:
        response = responses_client.create(
            model=settings.suggested_sources_model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            tools=[{"type": "web_search_preview"}],
            temperature=0.2,
        )
        raw_text = _response_utils._extract_response_text(response)
        candidates = _parse_source_suggestion_candidates(raw_text)
        search_results = []
        for item in _response_utils._extract_web_search_results(response)[:10]:
            search_results.append(
                {
                    "title": _response_utils._get_attr(item, "title", "") or "",
                    "url": _response_utils._get_attr(item, "url", "") or _response_utils._get_attr(item, "link", "") or "",
                }
            )
        metadata = {
            "model": settings.suggested_sources_model,
            "usage": _response_utils._extract_usage(response),
            "search_results": search_results,
        }
        return candidates, metadata
    except Exception as exc:
        logger.warning("Source suggestion discovery failed", exc_info=True)
        return [], {"error": str(exc)[:500], "model": settings.suggested_sources_model}


def _normalize_source_suggestion_candidates(
    candidates: list[dict],
    *,
    hub_id: str,
    seed_source_ids: list[str],
    search_metadata: dict,
) -> list[dict]:
    normalized: list[dict] = []
    for candidate in candidates:
        row = _normalize_source_suggestion_candidate(
            candidate,
            hub_id=hub_id,
            seed_source_ids=seed_source_ids,
            search_metadata=search_metadata,
        )
        if row is not None:
            normalized.append(row)
    return normalized


def _normalize_source_suggestion_candidate(
    candidate: dict,
    *,
    hub_id: str,
    seed_source_ids: list[str],
    search_metadata: dict,
) -> Optional[dict]:
    raw_url = str(candidate.get("url") or "").strip()
    if not raw_url:
        return None

    try:
        safe_url = _web._validate_public_url(raw_url)
    except Exception:
        return None

    suggested_type = str(candidate.get("type") or "web").strip().lower()
    video_id = _youtube.extract_youtube_video_id(safe_url)
    if suggested_type == "youtube" or video_id:
        if not video_id:
            return None
        return {
            "hub_id": hub_id,
            "type": "youtube",
            "status": "pending",
            "url": _youtube._canonicalize_youtube_url(video_id),
            "canonical_url": None,
            "video_id": video_id,
            "title": _trim_source_suggestion_text(candidate.get("title"), 255),
            "description": _trim_source_suggestion_text(candidate.get("description"), 1000),
            "rationale": _trim_source_suggestion_text(candidate.get("rationale"), 1000),
            "confidence": _coerce_confidence(candidate.get("confidence")),
            "seed_source_ids": seed_source_ids,
            "search_metadata": search_metadata,
        }

    canonical_url = _web.canonicalize_web_url(safe_url)
    if suggested_type != "web" or not canonical_url:
        return None
    return {
        "hub_id": hub_id,
        "type": "web",
        "status": "pending",
        "url": safe_url,
        "canonical_url": canonical_url,
        "video_id": None,
        "title": _trim_source_suggestion_text(candidate.get("title"), 255),
        "description": _trim_source_suggestion_text(candidate.get("description"), 1000),
        "rationale": _trim_source_suggestion_text(candidate.get("rationale"), 1000),
        "confidence": _coerce_confidence(candidate.get("confidence")),
        "seed_source_ids": seed_source_ids,
        "search_metadata": search_metadata,
    }


def _load_existing_source_suggestion_targets(client: Client, hub_id: str) -> set[tuple[str, str]]:
    rows = client.table("source_suggestions").select("type,canonical_url,video_id").eq("hub_id", hub_id).execute().data or []
    targets: set[tuple[str, str]] = set()
    for row in rows:
        key = _source_suggestion_target_key(row)
        if key is not None:
            targets.add(key)
    return targets


def _load_existing_source_targets(client: Client, hub_id: str) -> set[tuple[str, str]]:
    rows = client.table("sources").select("type,ingestion_metadata").eq("hub_id", hub_id).execute().data or []
    targets: set[tuple[str, str]] = set()
    for row in rows:
        source_type = str(row.get("type") or "")
        metadata = row.get("ingestion_metadata") if isinstance(row.get("ingestion_metadata"), dict) else {}
        if source_type == "youtube":
            video_id = str(metadata.get("video_id") or "")
            if not video_id:
                video_id = _youtube.extract_youtube_video_id(str(metadata.get("url") or ""))
            if video_id:
                targets.add(("youtube", video_id))
        elif source_type == "web":
            canonical_url = _web.canonicalize_web_url(str(metadata.get("final_url") or metadata.get("url") or ""))
            if canonical_url:
                targets.add(("web", canonical_url))
    return targets


def _filter_new_source_suggestions(
    candidates: list[dict],
    *,
    existing_source_targets: set[tuple[str, str]],
    existing_suggestion_targets: set[tuple[str, str]],
    limit: int,
) -> list[dict]:
    deduped: list[dict] = []
    seen_targets = set(existing_source_targets) | set(existing_suggestion_targets)
    for candidate in candidates:
        key = _source_suggestion_target_key(candidate)
        if key is None or key in seen_targets:
            continue
        seen_targets.add(key)
        deduped.append(candidate)

    max_items = max(1, limit)
    accepted = deduped[:max_items]
    if not accepted:
        return []

    if any(str(candidate.get("type") or "").strip().lower() == "youtube" for candidate in accepted):
        return accepted

    youtube_candidate = next(
        (candidate for candidate in deduped[max_items:] if str(candidate.get("type") or "").strip().lower() == "youtube"),
        None,
    )
    if youtube_candidate is None:
        return accepted

    replacement_index = next(
        (index for index in range(len(accepted) - 1, -1, -1) if str(accepted[index].get("type") or "").strip().lower() != "youtube"),
        None,
    )
    if replacement_index is None:
        return accepted

    accepted[replacement_index] = youtube_candidate
    return accepted


def _source_suggestion_target_key(candidate: dict) -> Optional[tuple[str, str]]:
    suggestion_type = str(candidate.get("type") or "").strip().lower()
    if suggestion_type == "youtube":
        video_id = str(candidate.get("video_id") or "").strip()
        if video_id:
            return ("youtube", video_id)
        return None
    if suggestion_type == "web":
        canonical_url = str(candidate.get("canonical_url") or "").strip()
        if canonical_url:
            return ("web", canonical_url)
    return None


def _mark_source_suggestion_scan(client: Client, hub_id: str, *, now: datetime, generated: bool) -> None:
    payload = {"last_source_suggestion_scan_at": now.isoformat()}
    if generated:
        payload["last_source_suggestion_generated_at"] = now.isoformat()
    client.table("hubs").update(payload).eq("id", hub_id).execute()


def _trim_source_suggestion_text(value: object, max_chars: int) -> Optional[str]:
    cleaned = _common._normalize_text(str(value or ""))
    if not cleaned:
        return None
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars].rstrip()}..."


def _coerce_confidence(value: object) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.5
    return max(0.0, min(1.0, confidence))


def _parse_source_suggestion_candidates(raw: str) -> list[dict]:
    text = (raw or "").strip()
    if not text:
        return []
    if text.startswith("```"):
        lines = [line for line in text.splitlines() if not line.startswith("```")]
        text = "\n".join(lines).strip()

    candidates_to_try = [text]
    if "[" in text and "]" in text:
        candidates_to_try.append(text[text.find("[") : text.rfind("]") + 1])

    for candidate_text in candidates_to_try:
        try:
            parsed = json.loads(candidate_text)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            parsed = parsed.get("candidates")
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
    return []


__all__ = [
    "scan_source_suggestions",
]
