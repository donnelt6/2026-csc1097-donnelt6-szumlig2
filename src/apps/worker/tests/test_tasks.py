"""Unit tests for worker task helpers using pure in-memory inputs."""

from worker import tasks


def test_normalize_text_collapses_whitespace() -> None:
    # Normalizes mixed whitespace; expect single-space output.
    raw = "Line one\r\nLine two\n\nLine\tthree"
    assert tasks._normalize_text(raw) == "Line one Line two Line three"


def test_chunk_text_returns_empty_for_blank_input() -> None:
    # Calls chunking on empty input; expect no chunks.
    assert tasks._chunk_text("", chunk_size=4, overlap=2) == []


def test_chunk_text_applies_overlap() -> None:
    # Splits words with overlap; expect sliding window chunks.
    text = " ".join(f"w{i}" for i in range(1, 11))
    chunks = tasks._chunk_text(text, chunk_size=4, overlap=2)
    assert chunks == [
        "w1 w2 w3 w4",
        "w3 w4 w5 w6",
        "w5 w6 w7 w8",
        "w7 w8 w9 w10",
    ]


def test_batch_splits_items() -> None:
    # Batches a list by size; expect final smaller batch.
    items = [1, 2, 3, 4, 5]
    batches = list(tasks._batch(items, size=2))
    assert batches == [[1, 2], [3, 4], [5]]


def test_extract_text_routes_by_extension(monkeypatch) -> None:
    # Mocks extractors; expect extension-based routing and decoded text.
    monkeypatch.setattr(tasks, "_extract_pdf", lambda raw: "pdf-text")
    monkeypatch.setattr(tasks, "_extract_docx", lambda raw: "docx-text")

    assert tasks._extract_text(b"pdf-bytes", "file.pdf") == "pdf-text"
    assert tasks._extract_text(b"docx-bytes", "file.docx") == "docx-text"
    assert tasks._extract_text(b"plain-text", "file.txt") == "plain-text"
    assert tasks._extract_text(b"markdown", "file.md") == "markdown"
