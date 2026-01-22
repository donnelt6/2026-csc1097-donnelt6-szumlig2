import io
import logging
from pathlib import Path
from typing import Iterable, List, Optional
from urllib.parse import quote

import httpx
from celery import Celery
from openai import OpenAI
from pypdf import PdfReader
from supabase import Client, create_client

from .config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

celery_app = Celery("caddie-worker", broker=settings.redis_url, backend=settings.redis_url)


@celery_app.task(bind=True, name="ingest_source", max_retries=3, default_retry_delay=15)
def ingest_source(self, source_id: str, hub_id: str, storage_path: str) -> dict:
    """
    Ingestion flow:
    - Download from Supabase Storage
    - Extract text (PDF/DOCX/TXT/MD)
    - Chunk + embed
    - Persist chunks to pgvector
    - Update source status
    """
    logger.info("Starting ingestion for source %s", source_id)
    client = _get_supabase_client()
    _update_source(client, source_id, status="processing")

    try:
        raw = _download_from_storage(storage_path)
    except Exception as exc:
        logger.warning("Download failed for %s, retrying: %s", storage_path, exc)
        raise self.retry(exc=exc)

    try:
        text = _extract_text(raw, storage_path)
        text = _normalize_text(text)
        if not text:
            raise ValueError("No text extracted from source")

        chunks = _chunk_text(text, settings.chunk_size, settings.chunk_overlap)
        if not chunks:
            raise ValueError("No chunks produced from extracted text")

        embeddings = _embed_chunks(chunks)
        _insert_chunks(client, source_id, hub_id, chunks, embeddings)

        metadata = {
            "chunk_count": len(chunks),
            "embedding_model": settings.embedding_model,
            "chunk_size": settings.chunk_size,
            "chunk_overlap": settings.chunk_overlap,
        }
        _update_source(client, source_id, status="complete", ingestion_metadata=metadata)
        logger.info("Completed ingestion for source %s", source_id)
        return {"source_id": source_id, "hub_id": hub_id, "chunks": len(chunks)}
    except Exception as exc:
        logger.exception("Ingestion failed for source %s", source_id)
        _update_source(client, source_id, status="failed", failure_reason=str(exc)[:500])
        raise


def _get_supabase_client() -> Client:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase credentials missing in worker environment")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


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


def _extract_text(raw: bytes, storage_path: str) -> str:
    ext = Path(storage_path).suffix.lower()
    if ext == ".pdf":
        return _extract_pdf(raw)
    if ext == ".docx":
        return _extract_docx(raw)
    if ext in {".md", ".txt"}:
        return raw.decode("utf-8", errors="ignore")
    return raw.decode("utf-8", errors="ignore")


def _extract_pdf(raw: bytes) -> str:
    reader = PdfReader(io.BytesIO(raw))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages)


def _extract_docx(raw: bytes) -> str:
    import docx  # local import to avoid unused dependency warnings if not used

    doc = docx.Document(io.BytesIO(raw))
    return "\n".join(paragraph.text for paragraph in doc.paragraphs)


def _normalize_text(text: str) -> str:
    return " ".join(text.replace("\r", "\n").split())


def _chunk_text(text: str, chunk_size: int, overlap: int) -> List[str]:
    words = text.split()
    if not words:
        return []
    chunks: List[str] = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk_words = words[start:end]
        chunks.append(" ".join(chunk_words))
        if end == len(words):
            break
        start = max(end - overlap, 0)
    return chunks


def _embed_chunks(chunks: List[str]) -> List[List[float]]:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY missing in worker environment")
    client = OpenAI(api_key=settings.openai_api_key)
    embeddings: List[List[float]] = []
    for batch in _batch(chunks, 64):
        response = client.embeddings.create(model=settings.embedding_model, input=batch)
        embeddings.extend([item.embedding for item in response.data])
    return embeddings


def _insert_chunks(client: Client, source_id: str, hub_id: str, chunks: List[str], embeddings: List[List[float]]) -> None:
    rows = []
    for idx, (text, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
        rows.append(
            {
                "source_id": source_id,
                "hub_id": hub_id,
                "chunk_index": idx,
                "text": text,
                "embedding": embedding,
                "token_count": len(text.split()),
                "metadata": {"word_count": len(text.split())},
            }
        )
    for batch in _batch(rows, 100):
        client.table("source_chunks").insert(batch).execute()


def _update_source(
    client: Client,
    source_id: str,
    status: str,
    failure_reason: Optional[str] = None,
    ingestion_metadata: Optional[dict] = None,
) -> None:
    payload: dict = {"status": status}
    if failure_reason is not None:
        payload["failure_reason"] = failure_reason
    if ingestion_metadata is not None:
        payload["ingestion_metadata"] = ingestion_metadata
    client.table("sources").update(payload).eq("id", source_id).execute()


def _batch(items: List, size: int) -> Iterable[List]:
    for i in range(0, len(items), size):
        yield items[i : i + size]
