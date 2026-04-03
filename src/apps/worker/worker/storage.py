"""Storage and source-row helpers for the worker package."""

from typing import Optional
from urllib.parse import quote

import httpx
from supabase import Client

from .app import settings


def _download_from_storage(storage_path: str) -> bytes:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase credentials missing for storage download")
    safe_path = quote(storage_path, safe="/")
    storage_url = f"{settings.supabase_url}/storage/v1/object/{settings.storage_bucket}/{safe_path}"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
    }
    with httpx.Client(timeout=60) as client:
        resp = client.get(storage_url, headers=headers)
        resp.raise_for_status()
    return resp.content


def _upload_pseudo_doc(client: Client, storage_path: str, content: str) -> None:
    if not storage_path:
        raise ValueError("Storage path missing for pseudo document")
    payload = content.encode("utf-8")
    try:
        client.storage.from_(settings.storage_bucket).remove([storage_path])
    except Exception:
        pass
    client.storage.from_(settings.storage_bucket).upload(
        storage_path,
        payload,
        {"content-type": "text/markdown"},
    )


def _clear_existing_chunks_before(client: Client, source_id: str, cutoff: str) -> None:
    client.table("source_chunks").delete().eq("source_id", source_id).lt("created_at", cutoff).execute()


def _source_exists(client: Client, source_id: str) -> bool:
    response = client.table("sources").select("id").eq("id", source_id).limit(1).execute()
    return bool(response.data)


def _get_source_metadata(client: Client, source_id: str) -> dict:
    response = (
        client.table("sources")
        .select("ingestion_metadata")
        .eq("id", source_id)
        .limit(1)
        .execute()
    )
    if not response.data:
        return {}
    metadata = response.data[0].get("ingestion_metadata") or {}
    return metadata if isinstance(metadata, dict) else {}


def _update_source(
    client: Client,
    source_id: str,
    status: str,
    failure_reason: Optional[str] = None,
    ingestion_metadata: Optional[dict] = None,
    clear_failure_reason: bool = False,
) -> None:
    payload: dict = {"status": status}
    if failure_reason is not None or clear_failure_reason:
        payload["failure_reason"] = failure_reason
    if ingestion_metadata is not None:
        payload["ingestion_metadata"] = ingestion_metadata
    client.table("sources").update(payload).eq("id", source_id).execute()


__all__ = [
    "_clear_existing_chunks_before",
    "_download_from_storage",
    "_get_source_metadata",
    "_source_exists",
    "_update_source",
    "_upload_pseudo_doc",
]
