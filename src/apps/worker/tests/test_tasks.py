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


def test_validate_public_url_rejects_private_ip() -> None:
    # Private IPs should be blocked for SSRF protection.
    try:
        tasks._validate_public_url("http://127.0.0.1")
    except ValueError as exc:
        assert "private" in str(exc).lower()
    else:
        raise AssertionError("Expected ValueError for private IP")


def test_validate_public_url_accepts_public_ip() -> None:
    # Public IPs should pass URL validation.
    assert tasks._validate_public_url("http://8.8.8.8") == "http://8.8.8.8"


def test_extract_web_text_returns_body_text() -> None:
    # HTML should be converted to readable text.
    html = b"<html><body><h1>Hello</h1><p>World</p></body></html>"
    text, title = tasks._extract_web_text(html, "text/html; charset=utf-8")
    assert "Hello" in text
    assert "World" in text
    assert "<html>" not in text
    assert "<h1>" not in text
    assert title is None or isinstance(title, str)


def test_build_pseudo_doc_includes_metadata() -> None:
    # Pseudo doc should include header fields.
    doc = tasks._build_pseudo_doc("Example", "https://example.com", "2026-01-01T00:00:00Z", "text/html", "Body")
    assert "Example" in doc
    assert "https://example.com" in doc
    assert "Crawled: 2026-01-01T00:00:00Z" in doc


def test_strip_vtt_srt_removes_timestamps_and_tags() -> None:
    # VTT captions should drop metadata and timestamps.
    sample = """WEBVTT

00:00:01.000 --> 00:00:03.000
<c>hello</c> world
"""
    cleaned = tasks._strip_vtt_srt(sample)
    assert "hello world" in cleaned
    assert "WEBVTT" not in cleaned


def test_parse_json3_extracts_segments() -> None:
    # JSON3 captions should merge utf8 segments.
    sample = '{"events":[{"segs":[{"utf8":"Hello "},{"utf8":"world"}]}]}'
    cleaned = tasks._parse_json3(sample)
    assert "Hello" in cleaned
    assert "world" in cleaned


def test_select_caption_track_prefers_manual_then_auto() -> None:
    # Manual captions should be preferred; auto captions only when allowed.
    info = {
        "subtitles": {"en": [{"ext": "vtt", "url": "http://manual.test/en.vtt"}]},
        "automatic_captions": {"en": [{"ext": "vtt", "url": "http://auto.test/en.vtt"}]},
    }
    source, lang, url, ext = tasks._select_caption_track(info, preferred_language="en", allow_auto=True)
    assert source == "manual"
    assert lang == "en"
    assert url == "http://manual.test/en.vtt"
    assert ext == "vtt"

    info = {
        "subtitles": {},
        "automatic_captions": {"en": [{"ext": "vtt", "url": "http://auto.test/en.vtt"}]},
    }
    source, lang, url, ext = tasks._select_caption_track(info, preferred_language="en", allow_auto=True)
    assert source == "auto"
    assert lang == "en"
    assert url == "http://auto.test/en.vtt"
    assert ext == "vtt"


def test_ingest_youtube_source_success(monkeypatch) -> None:
    # Ingest should upload pseudo doc and update source on success.
    updates: list[dict] = []

    monkeypatch.setattr(tasks, "_get_supabase_client", lambda: object())
    monkeypatch.setattr(tasks, "_upload_pseudo_doc", lambda *_args, **_kwargs: None)
    def fake_ingest(_client, source_id, hub_id, text, extra_metadata=None):
        _ = (hub_id, text, extra_metadata)
        tasks._update_source(_client, source_id, status="complete")
        return 3

    monkeypatch.setattr(tasks, "_ingest_text_for_source", fake_ingest)

    def fake_update(_client, _source_id, status, **kwargs):
        updates.append({"status": status, **kwargs})

    monkeypatch.setattr(tasks, "_update_source", fake_update)
    monkeypatch.setattr(
        tasks,
        "_fetch_youtube_transcript",
        lambda *_args, **_kwargs: (
            "hello world",
            {
                "video_id": "abc123def45",
                "title": "Demo",
                "channel": "Test Channel",
                "channel_id": "chan123",
                "published_at": "2025-01-01",
                "duration_seconds": 120,
            },
            {"language": "en", "captions_source": "manual"},
        ),
    )

    result = tasks.ingest_youtube_source.run(
        source_id="src-yt-1",
        hub_id="hub-1",
        url="https://www.youtube.com/watch?v=abc123def45",
        storage_path="hub-1/src-yt-1/youtube.md",
        language="en",
        allow_auto_captions=False,
    )
    assert result["chunks"] == 3
    assert updates[0]["status"] == "processing"
    assert updates[-1]["status"] == "complete"
