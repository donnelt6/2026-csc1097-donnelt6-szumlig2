"""File extraction helpers for uploaded source ingestion."""

import io
from pathlib import Path

from pypdf import PdfReader


def _extract_text(raw: bytes, storage_path: str) -> str:
    # Keep extension routing centralized here so the ingestion task stays
    # focused on orchestration rather than file-format details.
    ext = Path(storage_path).suffix.lower()
    if ext == ".pdf":
        return _extract_pdf(raw)
    if ext == ".docx":
        return _extract_docx(raw)
    if ext in {".md", ".txt"}:
        return raw.decode("utf-8", errors="ignore")
    return raw.decode("utf-8", errors="ignore")


def _extract_pdf(raw: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(raw))
    except Exception as exc:
        raise ValueError(f"Could not read PDF: {exc}") from exc
    pages: list[str] = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append("")
    return "\n".join(pages)


def _extract_docx(raw: bytes) -> str:
    # Import lazily so environments that never process DOCX files do not
    # need the dependency loaded during worker startup.
    import docx

    doc = docx.Document(io.BytesIO(raw))
    return "\n".join(paragraph.text for paragraph in doc.paragraphs)


__all__ = ["_extract_docx", "_extract_pdf", "_extract_text"]
