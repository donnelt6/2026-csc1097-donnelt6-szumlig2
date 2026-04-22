"""Regression tests for shared URL normalization helpers."""

from shared_schemas.url_utils import canonicalize_web_url, extract_youtube_video_id, normalize_youtube_id


def test_canonicalize_web_url_strips_tracking_and_fragment() -> None:
    assert (
        canonicalize_web_url("https://www.Example.com/docs/?utm_source=test&topic=1#intro")
        == "https://example.com/docs?topic=1"
    )


def test_canonicalize_web_url_removes_default_ports_and_preserves_meaningful_query() -> None:
    assert canonicalize_web_url("https://example.com:443/a//b/?b=2&a=1") == "https://example.com/a/b?a=1&b=2"
    assert canonicalize_web_url("http://www.example.com:80/docs/") == "http://example.com/docs"


def test_canonicalize_web_url_rejects_empty_or_unsupported_urls() -> None:
    assert canonicalize_web_url("") is None
    assert canonicalize_web_url("ftp://example.com/docs") is None
    assert canonicalize_web_url("https:///docs") is None


def test_extract_youtube_video_id_accepts_common_url_shapes() -> None:
    video_id = "abc123def45"
    assert extract_youtube_video_id(f"https://www.youtube.com/watch?v={video_id}") == video_id
    assert extract_youtube_video_id(f"https://youtu.be/{video_id}?si=share") == video_id
    assert extract_youtube_video_id(f"https://youtube.com/embed/{video_id}") == video_id
    assert extract_youtube_video_id(f"https://youtube.com/shorts/{video_id}") == video_id
    assert extract_youtube_video_id(f"https://youtube.com/live/{video_id}") == video_id


def test_normalize_youtube_id_rejects_invalid_values() -> None:
    assert normalize_youtube_id("abc123def45") == "abc123def45"
    assert normalize_youtube_id("too-short") is None
    assert normalize_youtube_id("abc123def45!") is None
    assert extract_youtube_video_id("https://example.com/watch?v=abc123def45") is None
