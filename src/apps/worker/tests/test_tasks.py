"""test_tasks.py: Exercises worker task flows plus helpers from their owning modules."""

from worker import common, content, media, tasks, web, youtube


# Text cleanup helpers.

# Verifies that text normalization collapses line breaks, tabs, and repeated spaces.
def test_normalize_text_collapses_whitespace() -> None:
    # Normalizes mixed whitespace; expect single-space output.
    raw = "Line one\r\nLine two\n\nLine\tthree"
    assert common._normalize_text(raw) == "Line one Line two Line three"


# Verifies that long text is trimmed and suffixed once it exceeds the limit.
def test_trim_text_truncates_long_content() -> None:
    assert common._trim_text("alpha beta gamma", 10) == "alpha beta..."


# Verifies that chunking blank text returns no output chunks.
def test_chunk_text_returns_empty_for_blank_input() -> None:
    # Calls chunking on empty input; expect no chunks.
    assert tasks._chunk_text("", chunk_size=4, overlap=2) == []


# Verifies that chunking uses an overlapping sliding window across words.
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


# Ingestion flow helpers.

# Verifies that ingestion exits early when the source record has been deleted.
def test_ingest_text_skips_when_source_deleted(monkeypatch) -> None:
    # If the source is gone, ingestion should skip without embedding or inserts.
    monkeypatch.setattr(tasks._storage, "_source_exists", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(
        tasks,
        "_embed_chunks",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Embeddings should not run")),
    )

    result = tasks._ingest_text_for_source(
        client=object(),
        source_id="src-missing",
        hub_id="hub-1",
        text="hello world",
        extra_metadata=None,
    )
    assert result == 0


# Verifies that batching keeps the configured size and leaves a smaller final batch when needed.
def test_batch_splits_items() -> None:
    # Batches a list by size; expect final smaller batch.
    items = [1, 2, 3, 4, 5]
    batches = list(common._batch(items, size=2))
    assert batches == [[1, 2], [3, 4], [5]]


# Extraction and URL validation helpers.

# Verifies that file extraction dispatches to the correct parser for each supported extension.
def test_extract_text_routes_by_extension(monkeypatch) -> None:
    # Mocks extractors; expect extension-based routing and decoded text.
    monkeypatch.setattr(content, "_extract_pdf", lambda raw: "pdf-text")
    monkeypatch.setattr(content, "_extract_docx", lambda raw: "docx-text")

    assert content._extract_text(b"pdf-bytes", "file.pdf") == "pdf-text"
    assert content._extract_text(b"docx-bytes", "file.docx") == "docx-text"
    assert content._extract_text(b"plain-text", "file.txt") == "plain-text"
    assert content._extract_text(b"markdown", "file.md") == "markdown"


# Verifies that SSRF protection rejects loopback and private-network targets.
def test_validate_public_url_rejects_private_ip() -> None:
    # Private IPs should be blocked for SSRF protection.
    try:
        web._validate_public_url("http://127.0.0.1")
    except ValueError as exc:
        assert "private" in str(exc).lower()
    else:
        raise AssertionError("Expected ValueError for private IP")


# Verifies that a public internet IP passes URL validation unchanged.
def test_validate_public_url_accepts_public_ip() -> None:
    # Public IPs should pass URL validation.
    assert web._validate_public_url("http://8.8.8.8") == "http://8.8.8.8"


# Verifies that HTML extraction strips tags and keeps readable body text.
def test_extract_web_text_returns_body_text() -> None:
    # HTML should be converted to readable text.
    html = b"<html><body><h1>Hello</h1><p>World</p></body></html>"
    text, title = web._extract_web_text(html, "text/html; charset=utf-8")
    assert "Hello" in text
    assert "World" in text
    assert "<html>" not in text
    assert "<h1>" not in text
    assert title is None or isinstance(title, str)


# Verifies that pseudo documents include the metadata header used for web ingestion.
def test_build_pseudo_doc_includes_metadata() -> None:
    # Pseudo doc should include header fields.
    doc = web._build_pseudo_doc("Example", "https://example.com", "2026-01-01T00:00:00Z", "text/html", "Body")
    assert "Example" in doc
    assert "https://example.com" in doc
    assert "Crawled: 2026-01-01T00:00:00Z" in doc


# Caption parsing helpers.

# Verifies that timestamped VTT or SRT caption text is cleaned into plain transcript text.
def test_strip_vtt_srt_removes_timestamps_and_tags() -> None:
    # VTT captions should drop metadata and timestamps.
    sample = """WEBVTT

00:00:01.000 --> 00:00:03.000
<c>hello</c> world
"""
    cleaned = youtube._strip_vtt_srt(sample)
    assert "hello world" in cleaned
    assert "WEBVTT" not in cleaned


# Verifies that YouTube JSON3 caption events are merged into readable text segments.
def test_parse_json3_extracts_segments() -> None:
    # JSON3 captions should merge utf8 segments.
    sample = '{"events":[{"segs":[{"utf8":"Hello "},{"utf8":"world"}]}]}'
    cleaned = youtube._parse_json3(sample)
    assert "Hello" in cleaned
    assert "world" in cleaned


# Verifies that deployment-provided YouTube cookies are passed to yt-dlp.
def test_build_youtube_ydl_opts_includes_cookiefile() -> None:
    opts = youtube._build_youtube_ydl_opts("cookies.txt")
    assert opts["skip_download"] is True
    assert opts["cookiefile"] == "cookies.txt"


# Verifies that hosted YouTube metadata extraction has bounded retries and avoids video manifests.
def test_build_youtube_ydl_opts_bounds_metadata_requests(monkeypatch) -> None:
    monkeypatch.setattr(youtube.settings, "youtube_request_timeout_seconds", 12)
    monkeypatch.setattr(youtube.settings, "youtube_metadata_retries", 1)

    opts = youtube._build_youtube_ydl_opts()

    assert opts["socket_timeout"] == 12
    assert opts["retries"] == 1
    assert opts["extractor_retries"] == 1
    assert opts["file_access_retries"] == 1
    assert opts["fragment_retries"] == 1
    assert opts["ignore_no_formats_error"] is True
    assert opts["extractor_args"]["youtube"]["skip"] == ["dash", "hls", "translated_subs"]


# Verifies that base64 cookie secrets are decoded before temporary file handoff.
def test_decode_configured_youtube_cookies_prefers_base64(monkeypatch) -> None:
    monkeypatch.setattr(youtube.settings, "youtube_cookies_b64", "I05ldHNjYXBlIGNvb2tpZXM=")
    monkeypatch.setattr(youtube.settings, "youtube_cookies_raw", "raw cookies")
    assert youtube._decode_configured_youtube_cookies() == b"#Netscape cookies"


# Verifies that caption selection prefers manual subtitles before automatic captions.
def test_select_caption_track_prefers_manual_then_auto() -> None:
    # Manual captions should be preferred; auto captions only when allowed.
    info = {
        "subtitles": {"en": [{"ext": "vtt", "url": "http://manual.test/en.vtt"}]},
        "automatic_captions": {"en": [{"ext": "vtt", "url": "http://auto.test/en.vtt"}]},
    }
    source, lang, url, ext = youtube._select_caption_track(info, preferred_language="en", allow_auto=True)
    assert source == "manual"
    assert lang == "en"
    assert url == "http://manual.test/en.vtt"
    assert ext == "vtt"

    info = {
        "subtitles": {},
        "automatic_captions": {"en": [{"ext": "vtt", "url": "http://auto.test/en.vtt"}]},
    }
    source, lang, url, ext = youtube._select_caption_track(info, preferred_language="en", allow_auto=True)
    assert source == "auto"
    assert lang == "en"
    assert url == "http://auto.test/en.vtt"
    assert ext == "vtt"


# YouTube ingestion helpers.

# Verifies that successful YouTube ingestion updates source state and records the chunk count.
def test_ingest_youtube_source_success(monkeypatch) -> None:
    # Ingest should upload pseudo doc and update source on success.
    updates: list[dict] = []

    monkeypatch.setattr(tasks._common, "_get_supabase_client", lambda: object())
    monkeypatch.setattr(tasks._storage, "_upload_pseudo_doc", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(tasks._storage, "_get_source_metadata", lambda *_args, **_kwargs: {})

    # Simulate the inner ingestion step completing and marking the source as done.
    def fake_ingest(_client, source_id, hub_id, text, extra_metadata=None):
        _ = (hub_id, text, extra_metadata)
        tasks._update_source(_client, source_id, status="complete")
        return 3

    monkeypatch.setattr(tasks, "_ingest_text_for_source", fake_ingest)

    def fake_update(_client, _source_id, status, **kwargs):
        updates.append({"status": status, **kwargs})

    monkeypatch.setattr(tasks, "_update_source", fake_update)
    monkeypatch.setattr(
        tasks._youtube,
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


# Verifies that a Celery soft timeout leaves the source failed instead of stuck in processing.
def test_ingest_youtube_source_timeout_marks_failed(monkeypatch) -> None:
    updates: list[dict] = []

    monkeypatch.setattr(tasks._common, "_get_supabase_client", lambda: object())
    monkeypatch.setattr(tasks._storage, "_get_source_metadata", lambda *_args, **_kwargs: {})

    def fake_fetch(*_args, **_kwargs):
        raise tasks.SoftTimeLimitExceeded()

    def fake_update(_client, _source_id, status, **kwargs):
        updates.append({"status": status, **kwargs})

    monkeypatch.setattr(tasks._youtube, "_fetch_youtube_transcript", fake_fetch)
    monkeypatch.setattr(tasks, "_update_source", fake_update)

    try:
        tasks.ingest_youtube_source.run(
            source_id="src-yt-timeout",
            hub_id="hub-1",
            url="https://www.youtube.com/watch?v=abc123def45",
            storage_path="hub-1/src-yt-timeout/youtube.md",
        )
    except tasks.SoftTimeLimitExceeded:
        pass
    else:
        raise AssertionError("Expected SoftTimeLimitExceeded")

    assert updates[0]["status"] == "processing"
    assert updates[-1]["status"] == "failed"
    assert "timed out" in updates[-1]["failure_reason"].lower()


# Verifies that YouTube failures are classified into stable fallback codes.
def test_classify_youtube_failure_marks_recoverable_cases() -> None:
    code, allowed, _message = tasks._classify_youtube_failure("No captions available for this YouTube video")
    assert code == "youtube_no_captions"
    assert allowed is True

    code, allowed, _message = tasks._classify_youtube_failure("yt-dlp is required for YouTube ingestion")
    assert code == "youtube_dependency_error"
    assert allowed is False


# Verifies that media fallback uploads are transcribed instead of document extraction.
def test_ingest_source_transcribes_media_fallback(monkeypatch) -> None:
    updates: list[dict] = []

    monkeypatch.setattr(tasks._common, "_get_supabase_client", lambda: object())
    monkeypatch.setattr(tasks._storage, "_get_source_metadata", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(tasks._storage, "_download_from_storage", lambda _path: b"media-bytes")
    monkeypatch.setattr(tasks._storage, "_get_source_metadata", lambda *_args, **_kwargs: {"file_kind": "media", "source_origin": "youtube_fallback"})
    monkeypatch.setattr(tasks._media, "_transcribe_media_bytes", lambda raw, path: ("hello from media", {"media_extension": "mp4"}))
    monkeypatch.setattr(tasks, "_ingest_text_for_source", lambda *_args, **kwargs: 2)
    monkeypatch.setattr(tasks, "_update_source", lambda _client, _source_id, status, **kwargs: updates.append({"status": status, **kwargs}))

    result = tasks.ingest_source.run("src-media-1", "hub-1", "hub-1/src-media-1/clip.mp4")

    assert result["chunks"] == 2
    assert updates[0]["status"] == "processing"


# Verifies that unsupported media uploads fail before OpenAI transcription.
def test_transcribe_media_bytes_rejects_unsupported_extension(monkeypatch) -> None:
    monkeypatch.setattr(media.settings, "transcription_max_bytes", 25_000_000)
    monkeypatch.setattr(media.settings, "media_upload_max_bytes", 100 * 1024 * 1024)
    try:
        media._transcribe_media_bytes(b"data", "upload.avi")
    except ValueError as exc:
        assert "unsupported media format" in str(exc).lower()
    else:
        raise AssertionError("Expected ValueError for unsupported media format")


# Verifies that media transcription fails fast when the configured model is not an audio transcription model.
def test_validate_transcription_model_rejects_chat_model() -> None:
    try:
        media._validate_transcription_model("gpt-4o-mini")
    except RuntimeError as exc:
        assert "invalid for audio transcription" in str(exc).lower()
    else:
        raise AssertionError("Expected RuntimeError for non-transcription model")


# Verifies that smaller media uploads go straight to transcription without preprocessing.
def test_prepare_transcription_input_keeps_direct_media_under_limit(monkeypatch) -> None:
    monkeypatch.setattr(media.settings, "transcription_max_bytes", 25)

    name, payload, metadata = media._prepare_transcription_input(b"small-media", "upload.mp4")

    assert name == "upload.mp4"
    assert payload == b"small-media"
    assert metadata["transcription_input_mode"] == "direct"
    assert metadata["transcription_input_extension"] == "mp4"
    assert metadata["transcription_input_bytes"] == len(b"small-media")


# Verifies that larger but accepted media uploads use ffmpeg preprocessing first.
def test_prepare_transcription_input_preprocesses_large_media(monkeypatch) -> None:
    monkeypatch.setattr(media.settings, "transcription_max_bytes", 10)
    monkeypatch.setattr(media, "_compress_media_for_transcription", lambda raw, path: ("upload-transcription.mp3", b"small"))

    name, payload, metadata = media._prepare_transcription_input(b"this is larger than ten bytes", "upload.mp4")

    assert name == "upload-transcription.mp3"
    assert payload == b"small"
    assert metadata["transcription_input_mode"] == "ffmpeg_preprocessed"
    assert metadata["transcription_input_extension"] == "mp3"
    assert metadata["original_media_bytes"] == len(b"this is larger than ten bytes")
    assert metadata["transcription_input_bytes"] == len(b"small")


# Verifies that uploads above the worker acceptance cap fail before preprocessing or transcription.
def test_transcribe_media_bytes_rejects_media_above_upload_limit(monkeypatch) -> None:
    monkeypatch.setattr(media.settings, "media_upload_max_bytes", 10)
    monkeypatch.setattr(media.settings, "transcription_max_bytes", 5)

    try:
        media._transcribe_media_bytes(b"01234567890", "upload.mp4")
    except ValueError as exc:
        assert "upload size limit" in str(exc).lower()
    else:
        raise AssertionError("Expected ValueError for oversized media upload")


# Verifies that failed media ingestion records runtime metadata for intermittent-worker debugging.
def test_ingest_source_persists_media_failure_metadata(monkeypatch) -> None:
    updates: list[dict] = []

    monkeypatch.setattr(tasks._common, "_get_supabase_client", lambda: object())
    monkeypatch.setattr(tasks._storage, "_download_from_storage", lambda _path: b"media-bytes")
    monkeypatch.setattr(tasks._storage, "_get_source_metadata", lambda *_args, **_kwargs: {"file_kind": "media"})
    monkeypatch.setattr(
        tasks._media,
        "_transcribe_media_bytes",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("bad transcription model")),
    )
    monkeypatch.setattr(tasks.socket, "gethostname", lambda: "worker-a")
    monkeypatch.setattr(tasks.os, "getpid", lambda: 4242)
    monkeypatch.setattr(tasks.settings, "transcription_model", "gpt-4o-mini")
    monkeypatch.setattr(tasks, "_update_source", lambda _client, _source_id, status, **kwargs: updates.append({"status": status, **kwargs}))

    try:
        tasks.ingest_source.run("src-media-2", "hub-1", "hub-1/src-media-2/clip.mp4")
    except RuntimeError as exc:
        assert "bad transcription model" in str(exc).lower()
    else:
        raise AssertionError("Expected RuntimeError for failed media transcription")

    assert updates[0]["status"] == "processing"
    assert updates[-1]["status"] == "failed"
    assert updates[-1]["ingestion_metadata"]["transcription_runtime_host"] == "worker-a"
    assert updates[-1]["ingestion_metadata"]["transcription_runtime_pid"] == 4242
    assert updates[-1]["ingestion_metadata"]["transcription_model"] == "gpt-4o-mini"
    assert updates[-1]["ingestion_metadata"]["transcription_input_extension"] == "mp4"


# Verifies that missing ffmpeg produces a clear dependency error when preprocessing is required.
def test_compress_media_for_transcription_requires_ffmpeg(monkeypatch) -> None:
    monkeypatch.setattr(media.settings, "ffmpeg_binary", "ffmpeg")
    monkeypatch.setattr(media.shutil, "which", lambda _binary: None)

    try:
        media._compress_media_for_transcription(b"01234567890", "upload.mp4")
    except RuntimeError as exc:
        assert "ffmpeg is required" in str(exc).lower()
    else:
        raise AssertionError("Expected RuntimeError when ffmpeg is missing")


# Verifies that linked fallback child status updates are mirrored onto the failed YouTube parent.
def test_update_source_mirrors_youtube_fallback_status(monkeypatch) -> None:
    updates: list[tuple[str, dict]] = []

    def fake_get_metadata(_client, source_id):
        if source_id == "src-child-1":
            return {
                "source_origin": "youtube_fallback",
                "youtube_fallback_parent_source_id": "src-parent-1",
            }
        return {"youtube_failure_code": "youtube_no_captions"}

    def fake_storage_update(_client, source_id, status, **kwargs):
        updates.append((source_id, {"status": status, **kwargs}))

    monkeypatch.setattr(tasks._storage, "_get_source_metadata", fake_get_metadata)
    monkeypatch.setattr(tasks._storage, "_update_source", fake_storage_update)

    tasks._update_source(object(), "src-child-1", status="processing", source_might_be_youtube_fallback=True)

    assert updates[0][0] == "src-child-1"
    assert updates[1][0] == "src-parent-1"
    assert updates[1][1]["ingestion_metadata"]["youtube_fallback_source_status"] == "processing"


# Verifies that non-fallback status updates do not fetch metadata just to discover they have no parent to mirror.
def test_update_source_skips_metadata_fetch_for_non_fallback_sources(monkeypatch) -> None:
    updates: list[tuple[str, dict]] = []

    def fail_get_metadata(_client, _source_id):
        raise AssertionError("metadata lookup should be skipped")

    def fake_storage_update(_client, source_id, status, **kwargs):
        updates.append((source_id, {"status": status, **kwargs}))

    monkeypatch.setattr(tasks._storage, "_get_source_metadata", fail_get_metadata)
    monkeypatch.setattr(tasks._storage, "_update_source", fake_storage_update)

    tasks._update_source(object(), "src-web-1", status="processing")

    assert updates == [("src-web-1", {"status": "processing", "failure_reason": None, "ingestion_metadata": None, "clear_failure_reason": False})]


# Suggested source selection helpers.

# Verifies that hub eligibility excludes pending, inactive, cooling-down, and underpopulated hubs.
def test_filter_eligible_source_suggestion_hubs_applies_pending_activity_and_cooldown(monkeypatch) -> None:
    monkeypatch.setattr(tasks.settings, "suggested_sources_hub_cooldown_minutes", 60)
    monkeypatch.setattr(tasks.settings, "suggested_sources_min_complete_sources", 2)
    now = tasks.datetime(2026, 3, 17, 12, 0, tzinfo=tasks.timezone.utc)
    hubs = [
        {"id": "hub-active", "last_source_suggestion_scan_at": None},
        {"id": "hub-pending", "last_source_suggestion_scan_at": None},
        {"id": "hub-cooldown", "last_source_suggestion_scan_at": "2026-03-17T11:30:00+00:00"},
        {"id": "hub-inactive", "last_source_suggestion_scan_at": None},
        {"id": "hub-few-sources", "last_source_suggestion_scan_at": None},
    ]

    eligible = tasks._filter_eligible_source_suggestion_hubs(
        hubs,
        complete_source_counts={
            "hub-active": 3,
            "hub-pending": 3,
            "hub-cooldown": 3,
            "hub-inactive": 3,
            "hub-few-sources": 1,
        },
        active_hub_ids={"hub-active", "hub-pending", "hub-cooldown", "hub-few-sources"},
        pending_hub_ids={"hub-pending"},
        now=now,
    )

    assert [hub["id"] for hub in eligible] == ["hub-active"]


# Verifies that candidate filtering deduplicates repeated targets and respects the batch limit.
def test_filter_new_source_suggestions_dedupes_and_caps_batch() -> None:
    candidates = [
        {"type": "web", "canonical_url": "https://example.com/a"},
        {"type": "web", "canonical_url": "https://example.com/b"},
        {"type": "youtube", "video_id": "abc123def45"},
        {"type": "web", "canonical_url": "https://example.com/a"},
        {"type": "youtube", "video_id": "zyx987uvw65"},
    ]

    accepted = tasks._filter_new_source_suggestions(
        candidates,
        existing_source_targets={("web", "https://example.com/b")},
        existing_suggestion_targets={("youtube", "abc123def45")},
        limit=3,
    )

    assert accepted == [
        {"type": "web", "canonical_url": "https://example.com/a"},
        {"type": "youtube", "video_id": "zyx987uvw65"},
    ]


# Verifies that batching keeps room for at least one YouTube result when available.
def test_filter_new_source_suggestions_reserves_one_youtube_slot() -> None:
    candidates = [
        {"type": "web", "canonical_url": "https://example.com/a"},
        {"type": "web", "canonical_url": "https://example.com/b"},
        {"type": "web", "canonical_url": "https://example.com/c"},
        {"type": "youtube", "video_id": "abc123def45"},
    ]

    accepted = tasks._filter_new_source_suggestions(
        candidates,
        existing_source_targets=set(),
        existing_suggestion_targets=set(),
        limit=3,
    )

    assert accepted == [
        {"type": "web", "canonical_url": "https://example.com/a"},
        {"type": "web", "canonical_url": "https://example.com/b"},
        {"type": "youtube", "video_id": "abc123def45"},
    ]


# Verifies that normalization converts YouTube URLs to video suggestions and canonicalizes web URLs.
def test_normalize_source_suggestion_candidate_coerces_youtube_and_web(monkeypatch) -> None:
    monkeypatch.setattr(tasks._web, "_validate_public_url", lambda url: url)

    youtube = tasks._normalize_source_suggestion_candidate(
        {
            "type": "web",
            "url": "https://www.youtube.com/watch?v=abc123def45",
            "title": "Demo",
            "confidence": 0.9,
        },
        hub_id="hub-1",
        seed_source_ids=["src-1"],
        search_metadata={"model": "test"},
    )
    web = tasks._normalize_source_suggestion_candidate(
        {
            "type": "web",
            "url": "https://www.example.com/docs/?utm_source=test",
            "title": "Docs",
            "confidence": 0.8,
        },
        hub_id="hub-1",
        seed_source_ids=["src-1"],
        search_metadata={"model": "test"},
    )

    assert youtube is not None
    assert youtube["type"] == "youtube"
    assert youtube["video_id"] == "abc123def45"
    assert web is not None
    assert web["canonical_url"] == "https://example.com/docs"
    assert web["canonical_url"] == tasks._web.canonicalize_web_url("https://www.example.com/docs/?utm_source=test")


# OpenAI discovery helpers.

# Verifies that discovery failures return an empty result set with the captured error metadata.
def test_discover_source_suggestions_returns_empty_on_failure(monkeypatch) -> None:
    monkeypatch.setattr(tasks.settings, "openai_api_key", "test-key")

    class FakeResponses:
        def create(self, **_kwargs):
            raise RuntimeError("boom")

    class FakeOpenAI:
        def __init__(self, api_key: str):
            self.responses = FakeResponses()

    monkeypatch.setattr(tasks, "OpenAI", FakeOpenAI)

    candidates, metadata = tasks._discover_source_suggestions("Hub context")
    assert candidates == []
    assert metadata["error"] == "boom"


# Verifies that the discovery prompt explicitly asks for a YouTube result when generating suggestions.
def test_discover_source_suggestions_requests_youtube_when_relevant(monkeypatch) -> None:
    monkeypatch.setattr(tasks.settings, "openai_api_key", "test-key")
    captured: dict[str, object] = {}

    class FakeResponses:
        def create(self, **kwargs):
            captured.update(kwargs)
            return type("Response", (), {"output": [], "usage": None})()

    class FakeOpenAI:
        def __init__(self, api_key: str):
            self.responses = FakeResponses()

    monkeypatch.setattr(tasks, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(tasks._response_utils, "_extract_response_text", lambda _response: "[]")
    monkeypatch.setattr(tasks, "_parse_source_suggestion_candidates", lambda _raw: [])
    monkeypatch.setattr(tasks._response_utils, "_extract_web_search_results", lambda _response: [])

    candidates, metadata = tasks._discover_source_suggestions("Hub context")

    assert candidates == []
    assert metadata["model"] == tasks.settings.suggested_sources_model
    messages = captured["input"]
    system_prompt = messages[0]["content"]
    assert "include at least 1 YouTube video" in system_prompt


# Redis helpers.

# Verifies that `rediss` URLs with string SSL flags are converted into Redis client options.
def test_get_redis_client_normalizes_rediss_ssl_flags(monkeypatch) -> None:
    captured = {}

    def fake_from_url(url: str, **kwargs):
        captured["url"] = url
        captured["kwargs"] = kwargs
        return object()

    monkeypatch.setattr(tasks.settings, "redis_url", "rediss://user:pass@example.upstash.io:6379/0?ssl_cert_reqs=CERT_NONE")
    monkeypatch.setattr(tasks.redis.Redis, "from_url", fake_from_url)

    tasks._get_redis_client()

    assert captured["url"] == "rediss://user:pass@example.upstash.io:6379/0"
    assert captured["kwargs"]["ssl_cert_reqs"] == tasks.ssl.CERT_NONE
    assert captured["kwargs"]["ssl_check_hostname"] is False
