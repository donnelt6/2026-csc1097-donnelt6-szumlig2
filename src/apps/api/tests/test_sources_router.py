"""Router tests for sources endpoints with mocked rate limits and store calls."""

from app.dependencies import get_rate_limiter
from app.main import app
from app.routers import sources as sources_router
from app.schemas import Source, SourceStatus, SourceType
from app.services import rate_limit as rate_limit_module
from app.services import store as store_module


class FixedRateLimiter:
    def __init__(self, result: rate_limit_module.RateLimitResult) -> None:
        self.result = result

    def check(self, key: str, limit: int, window_seconds: int = 60) -> rate_limit_module.RateLimitResult:
        return self.result


def test_list_sources_returns_sources(client, monkeypatch) -> None:
    # Mocks list_sources; expect /sources/{hub_id} to return sources.
    source = Source(
        id="src-1",
        hub_id="11111111-1111-1111-1111-111111111111",
        original_name="doc.txt",
        status=SourceStatus.queued,
    )
    monkeypatch.setattr(store_module.store, "list_sources", lambda _client, hub_id: [source])

    resp = client.get("/sources/11111111-1111-1111-1111-111111111111")
    assert resp.status_code == 200
    assert resp.json()[0]["id"] == "src-1"


def test_create_source_rate_limited(client, monkeypatch) -> None:
    # Forces rate limit failure; expect 429 response.
    rl = rate_limit_module.RateLimitResult(allowed=False, remaining=0, reset_in_seconds=10)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    resp = client.post(
        "/sources",
        json={"hub_id": "11111111-1111-1111-1111-111111111111", "original_name": "doc.txt"},
    )
    assert resp.status_code == 429


def test_create_source_success(client, monkeypatch) -> None:
    # Mocks create_source; expect 201 with upload URL and source payload.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    source = Source(
        id="src-2",
        hub_id="11111111-1111-1111-1111-111111111111",
        original_name="doc.txt",
        status=SourceStatus.queued,
    )
    monkeypatch.setattr(store_module.store, "create_source", lambda _client, payload: (source, "http://upload"))

    resp = client.post(
        "/sources",
        json={"hub_id": "11111111-1111-1111-1111-111111111111", "original_name": "doc.txt"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["source"]["id"] == "src-2"
    assert data["upload_url"] == "http://upload"


def test_get_source_status_not_found(client, monkeypatch) -> None:
    # Mocks missing source; expect 404 response.
    def raise_not_found(_client, source_id):
        raise KeyError("Source not found")

    monkeypatch.setattr(store_module.store, "get_source_status", raise_not_found)
    resp = client.get("/sources/22222222-2222-2222-2222-222222222222/status")
    assert resp.status_code == 404


def test_enqueue_source_missing_storage_path(client, monkeypatch) -> None:
    # Mocks source without storage path; expect 400 response.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    source = Source(
        id="src-3",
        hub_id="11111111-1111-1111-1111-111111111111",
        original_name="doc.txt",
        status=SourceStatus.queued,
    )
    monkeypatch.setattr(store_module.store, "get_source", lambda _client, source_id: source)

    resp = client.post("/sources/33333333-3333-3333-3333-333333333333/enqueue")
    assert resp.status_code == 400


def test_enqueue_source_success(client, monkeypatch) -> None:
    # Mocks enqueue path; expect task dispatch and queued status.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    source = Source(
        id="src-4",
        hub_id="11111111-1111-1111-1111-111111111111",
        original_name="doc.txt",
        status=SourceStatus.queued,
        storage_path="11111111-1111-1111-1111-111111111111/src-4/doc.txt",
    )
    monkeypatch.setattr(store_module.store, "get_source", lambda _client, source_id: source)
    monkeypatch.setattr(
        store_module.store,
        "set_source_status",
        lambda _client, source_id, status, failure_reason=None: source,
    )

    sent = {}

    def fake_send_task(name, args):
        sent["name"] = name
        sent["args"] = args

    monkeypatch.setattr(sources_router.celery_app, "send_task", fake_send_task)

    resp = client.post("/sources/44444444-4444-4444-4444-444444444444/enqueue")
    assert resp.status_code == 200
    assert resp.json()["status"] == "queued"


def test_create_upload_url_success(client, monkeypatch) -> None:
    # Mocks upload URL creation; expect 200 with upload URL payload.
    source = Source(
        id="src-5",
        hub_id="11111111-1111-1111-1111-111111111111",
        original_name="doc.txt",
        status=SourceStatus.queued,
        storage_path="11111111-1111-1111-1111-111111111111/src-5/doc.txt",
    )
    monkeypatch.setattr(store_module.store, "get_source", lambda _client, source_id: source)
    monkeypatch.setattr(store_module.store, "create_upload_url", lambda _path: "http://upload.retry")

    resp = client.post("/sources/55555555-5555-5555-5555-555555555555/upload-url")
    assert resp.status_code == 200
    assert resp.json()["upload_url"] == "http://upload.retry"


def test_create_upload_url_missing_storage_path(client, monkeypatch) -> None:
    # Mocks source without storage path; expect 400 response.
    source = Source(
        id="src-6",
        hub_id="11111111-1111-1111-1111-111111111111",
        original_name="doc.txt",
        status=SourceStatus.queued,
    )
    monkeypatch.setattr(store_module.store, "get_source", lambda _client, source_id: source)

    resp = client.post("/sources/66666666-6666-6666-6666-666666666666/upload-url")
    assert resp.status_code == 400


def test_fail_source_success(client, monkeypatch) -> None:
    # Mocks status update; expect 200 with failed status.
    source = Source(
        id="src-7",
        hub_id="11111111-1111-1111-1111-111111111111",
        original_name="doc.txt",
        status=SourceStatus.failed,
        failure_reason="upload failed",
    )
    monkeypatch.setattr(
        store_module.store,
        "set_source_status",
        lambda _client, source_id, status, failure_reason=None: source,
    )

    resp = client.post(
        "/sources/77777777-7777-7777-7777-777777777777/fail",
        json={"failure_reason": "upload failed"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == SourceStatus.failed.value
    assert data["failure_reason"] == "upload failed"


def test_create_web_source_success(client, monkeypatch) -> None:
    # Mocks web source creation; expect ingest_web_source task enqueued.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    source = Source(
        id="src-web-1",
        hub_id="11111111-1111-1111-1111-111111111111",
        original_name="example.com/docs",
        status=SourceStatus.queued,
        storage_path="11111111-1111-1111-1111-111111111111/src-web-1/web.md",
        type=SourceType.web,
    )
    monkeypatch.setattr(store_module.store, "create_web_source", lambda _client, payload: source)

    sent = {}

    def fake_send_task(name, args):
        sent["name"] = name
        sent["args"] = args

    monkeypatch.setattr(sources_router.celery_app, "send_task", fake_send_task)

    resp = client.post(
        "/sources/web",
        json={"hub_id": "11111111-1111-1111-1111-111111111111", "url": "https://example.com/docs"},
    )
    assert resp.status_code == 201
    assert sent["name"] == "ingest_web_source"
    assert sent["args"][0] == "src-web-1"


def test_create_youtube_source_success(client, monkeypatch) -> None:
    # Mocks YouTube source creation; expect ingest_youtube_source task enqueued.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    source = Source(
        id="src-yt-1",
        hub_id="11111111-1111-1111-1111-111111111111",
        original_name="youtube.com/abc123def45",
        status=SourceStatus.queued,
        storage_path="11111111-1111-1111-1111-111111111111/src-yt-1/youtube.md",
        type=SourceType.youtube,
    )
    monkeypatch.setattr(store_module.store, "create_youtube_source", lambda _client, payload: source)

    sent = {}

    def fake_send_task(name, args):
        sent["name"] = name
        sent["args"] = args

    monkeypatch.setattr(sources_router.celery_app, "send_task", fake_send_task)

    resp = client.post(
        "/sources/youtube",
        json={
            "hub_id": "11111111-1111-1111-1111-111111111111",
            "url": "https://www.youtube.com/watch?v=abc123def45",
            "language": "en",
            "allow_auto_captions": False,
        },
    )
    assert resp.status_code == 201
    assert sent["name"] == "ingest_youtube_source"
    assert sent["args"][0] == "src-yt-1"


def test_create_youtube_source_invalid_video_id(client, monkeypatch) -> None:
    # Mocks failure to extract video ID; expect 400 response.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    def raise_invalid(_client, _payload):
        raise ValueError("Unable to extract YouTube video ID")

    monkeypatch.setattr(store_module.store, "create_youtube_source", raise_invalid)

    resp = client.post(
        "/sources/youtube",
        json={"hub_id": "11111111-1111-1111-1111-111111111111", "url": "https://example.com"},
    )
    assert resp.status_code == 400


def test_create_youtube_source_requires_http_url(client) -> None:
    # Missing scheme should fail validation.
    resp = client.post(
        "/sources/youtube",
        json={"hub_id": "11111111-1111-1111-1111-111111111111", "url": "youtube.com/watch?v=abc"},
    )
    assert resp.status_code == 422


def test_refresh_web_source_success(client, monkeypatch) -> None:
    # Mocks refresh; expect ingest_web_source task enqueued.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    source_id = "22222222-2222-2222-2222-222222222222"
    source = Source(
        id=source_id,
        hub_id="11111111-1111-1111-1111-111111111111",
        original_name="example.com/docs",
        status=SourceStatus.queued,
        storage_path=f"11111111-1111-1111-1111-111111111111/{source_id}/web.md",
        type=SourceType.web,
    )
    monkeypatch.setattr(
        store_module.store,
        "refresh_source",
        lambda _client, source_id: (source, {"type": "web", "url": "https://example.com/docs"}),
    )

    sent = {}

    def fake_send_task(name, args):
        sent["name"] = name
        sent["args"] = args

    monkeypatch.setattr(sources_router.celery_app, "send_task", fake_send_task)

    resp = client.post(f"/sources/{source_id}/refresh")
    assert resp.status_code == 200
    assert sent["name"] == "ingest_web_source"
    assert sent["args"][0] == source_id


def test_refresh_youtube_source_success(client, monkeypatch) -> None:
    # Mocks refresh; expect ingest_youtube_source task enqueued.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    source_id = "33333333-3333-3333-3333-333333333333"
    source = Source(
        id=source_id,
        hub_id="11111111-1111-1111-1111-111111111111",
        original_name="youtube.com/abc123def45",
        status=SourceStatus.queued,
        storage_path=f"11111111-1111-1111-1111-111111111111/{source_id}/youtube.md",
        type=SourceType.youtube,
    )
    monkeypatch.setattr(
        store_module.store,
        "refresh_source",
        lambda _client, source_id: (
            source,
            {
                "type": "youtube",
                "url": "https://www.youtube.com/watch?v=abc123def45",
                "language": "en",
                "allow_auto_captions": True,
            },
        ),
    )

    sent = {}

    def fake_send_task(name, args):
        sent["name"] = name
        sent["args"] = args

    monkeypatch.setattr(sources_router.celery_app, "send_task", fake_send_task)

    resp = client.post(f"/sources/{source_id}/refresh")
    assert resp.status_code == 200
    assert sent["name"] == "ingest_youtube_source"
    assert sent["args"][0] == source_id
