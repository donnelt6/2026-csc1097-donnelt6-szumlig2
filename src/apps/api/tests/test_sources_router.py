"""Router tests for sources endpoints with mocked rate limits and store calls."""

from datetime import datetime, timezone

from app.dependencies import get_rate_limiter
from app.main import app
from app.routers import sources as sources_router
from app.schemas import HubMember, MembershipRole, Source, SourceStatus, SourceSuggestion, SourceSuggestionStatus, SourceSuggestionType, SourceType
from app.services import rate_limit as rate_limit_module
from app.services import store as store_module
from app.services.store import ConflictError


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
        ingestion_metadata={"video_id": "abc123def45"},
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
    assert sent["args"][-1] == "abc123def45"


def test_create_youtube_source_invalid_video_id(client, monkeypatch) -> None:
    # Mocks failure to extract video ID; expect 400 response.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    def raise_invalid(_client, _payload):
        raise ValueError("Unable to extract YouTube video ID")

    monkeypatch.setattr(store_module.store, "create_youtube_source", raise_invalid)

    resp = client.post(
        "/sources/youtube",
        json={"hub_id": "11111111-1111-1111-1111-111111111111", "url": "https://www.youtube.com/watch?v=bad"},
    )
    assert resp.status_code == 400


def test_create_youtube_source_requires_http_url(client) -> None:
    # Missing scheme should fail validation.
    resp = client.post(
        "/sources/youtube",
        json={"hub_id": "11111111-1111-1111-1111-111111111111", "url": "youtube.com/watch?v=abc"},
    )
    assert resp.status_code == 422


def test_create_youtube_source_requires_youtube_domain(client) -> None:
    # Non-YouTube domains should fail validation.
    resp = client.post(
        "/sources/youtube",
        json={"hub_id": "11111111-1111-1111-1111-111111111111", "url": "https://example.com/watch?v=abc"},
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
                "video_id": "abc123def45",
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
    assert sent["args"][-1] == "abc123def45"


def test_list_source_suggestions_returns_pending_items(client, monkeypatch) -> None:
    suggestion = SourceSuggestion(
        id="11111111-1111-1111-1111-111111111111",
        hub_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type=SourceSuggestionType.web,
        status=SourceSuggestionStatus.pending,
        url="https://example.com/docs",
        canonical_url="https://example.com/docs",
        title="Example docs",
        confidence=0.82,
        created_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(store_module.store, "list_source_suggestions", lambda _client, hub_id, status=None: [suggestion])

    resp = client.get("/sources/suggestions?hub_id=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    assert resp.status_code == 200
    assert resp.json()[0]["id"] == suggestion.id


def test_accept_web_source_suggestion_success(client, monkeypatch) -> None:
    suggestion_id = "11111111-1111-1111-1111-111111111111"
    hub_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    pending = SourceSuggestion(
        id=suggestion_id,
        hub_id=hub_id,
        type=SourceSuggestionType.web,
        status=SourceSuggestionStatus.pending,
        url="https://example.com/docs",
        canonical_url="https://example.com/docs",
        title="Example docs",
        confidence=0.82,
        created_at=datetime.now(timezone.utc),
    )
    accepted = pending.model_copy(update={"status": SourceSuggestionStatus.accepted, "accepted_source_id": "src-web-1"})
    source = Source(
        id="src-web-1",
        hub_id=hub_id,
        original_name="example.com/docs",
        status=SourceStatus.queued,
        storage_path=f"{hub_id}/src-web-1/web.md",
        type=SourceType.web,
    )

    monkeypatch.setattr(store_module.store, "get_source_suggestion", lambda _client, _suggestion_id: pending)
    monkeypatch.setattr(
        store_module.store,
        "get_member_role",
        lambda _client, _hub_id, _user_id: HubMember(
            hub_id=hub_id,
            user_id="00000000-0000-0000-0000-000000000001",
            role=MembershipRole.editor,
            accepted_at=datetime.now(timezone.utc),
        ),
    )
    monkeypatch.setattr(store_module.store, "find_existing_source_for_suggestion", lambda _client, _suggestion: None)
    monkeypatch.setattr(store_module.store, "create_web_source", lambda _client, _payload: source)
    monkeypatch.setattr(
        store_module.store,
        "update_source_suggestion",
        lambda _client, _suggestion_id, _payload, **_kwargs: accepted,
    )

    sent = {}

    def fake_send_task(name, args):
        sent["name"] = name
        sent["args"] = args

    monkeypatch.setattr(sources_router.celery_app, "send_task", fake_send_task)

    resp = client.patch(f"/sources/suggestions/{suggestion_id}", json={"action": "accepted"})
    assert resp.status_code == 200
    assert resp.json()["suggestion"]["status"] == "accepted"
    assert sent["name"] == "ingest_web_source"
    assert sent["args"][0] == source.id


def test_accept_youtube_source_suggestion_success(client, monkeypatch) -> None:
    suggestion_id = "22222222-2222-2222-2222-222222222222"
    hub_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    pending = SourceSuggestion(
        id=suggestion_id,
        hub_id=hub_id,
        type=SourceSuggestionType.youtube,
        status=SourceSuggestionStatus.pending,
        url="https://www.youtube.com/watch?v=abc123def45",
        video_id="abc123def45",
        title="Demo video",
        confidence=0.78,
        created_at=datetime.now(timezone.utc),
    )
    accepted = pending.model_copy(update={"status": SourceSuggestionStatus.accepted, "accepted_source_id": "src-yt-1"})
    source = Source(
        id="src-yt-1",
        hub_id=hub_id,
        original_name="youtube.com/abc123def45",
        status=SourceStatus.queued,
        storage_path=f"{hub_id}/src-yt-1/youtube.md",
        type=SourceType.youtube,
        ingestion_metadata={"video_id": "abc123def45"},
    )

    monkeypatch.setattr(store_module.store, "get_source_suggestion", lambda _client, _suggestion_id: pending)
    monkeypatch.setattr(
        store_module.store,
        "get_member_role",
        lambda _client, _hub_id, _user_id: HubMember(
            hub_id=hub_id,
            user_id="00000000-0000-0000-0000-000000000001",
            role=MembershipRole.owner,
            accepted_at=datetime.now(timezone.utc),
        ),
    )
    monkeypatch.setattr(store_module.store, "find_existing_source_for_suggestion", lambda _client, _suggestion: None)
    monkeypatch.setattr(store_module.store, "create_youtube_source", lambda _client, _payload: source)
    monkeypatch.setattr(
        store_module.store,
        "update_source_suggestion",
        lambda _client, _suggestion_id, _payload, **_kwargs: accepted,
    )

    sent = {}

    def fake_send_task(name, args):
        sent["name"] = name
        sent["args"] = args

    monkeypatch.setattr(sources_router.celery_app, "send_task", fake_send_task)

    resp = client.patch(f"/sources/suggestions/{suggestion_id}", json={"action": "accepted"})
    assert resp.status_code == 200
    assert resp.json()["suggestion"]["status"] == "accepted"
    assert sent["name"] == "ingest_youtube_source"
    assert sent["args"][-1] == "abc123def45"


def test_decline_source_suggestion_success(client, monkeypatch) -> None:
    suggestion_id = "33333333-3333-3333-3333-333333333333"
    hub_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    pending = SourceSuggestion(
        id=suggestion_id,
        hub_id=hub_id,
        type=SourceSuggestionType.web,
        status=SourceSuggestionStatus.pending,
        url="https://example.com/decline",
        canonical_url="https://example.com/decline",
        title="Decline me",
        confidence=0.51,
        created_at=datetime.now(timezone.utc),
    )
    declined = pending.model_copy(update={"status": SourceSuggestionStatus.declined})

    monkeypatch.setattr(store_module.store, "get_source_suggestion", lambda _client, _suggestion_id: pending)
    monkeypatch.setattr(
        store_module.store,
        "get_member_role",
        lambda _client, _hub_id, _user_id: HubMember(
            hub_id=hub_id,
            user_id="00000000-0000-0000-0000-000000000001",
            role=MembershipRole.editor,
            accepted_at=datetime.now(timezone.utc),
        ),
    )
    monkeypatch.setattr(
        store_module.store,
        "update_source_suggestion",
        lambda _client, _suggestion_id, _payload, **_kwargs: declined,
    )

    resp = client.patch(f"/sources/suggestions/{suggestion_id}", json={"action": "declined"})
    assert resp.status_code == 200
    assert resp.json()["suggestion"]["status"] == "declined"


def test_source_suggestion_review_forbidden_for_viewer(client, monkeypatch) -> None:
    suggestion = SourceSuggestion(
        id="44444444-4444-4444-4444-444444444444",
        hub_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type=SourceSuggestionType.web,
        status=SourceSuggestionStatus.pending,
        url="https://example.com/docs",
        canonical_url="https://example.com/docs",
        title="Example docs",
        confidence=0.82,
        created_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(store_module.store, "get_source_suggestion", lambda _client, _suggestion_id: suggestion)
    monkeypatch.setattr(
        store_module.store,
        "get_member_role",
        lambda _client, _hub_id, _user_id: HubMember(
            hub_id=suggestion.hub_id,
            user_id="00000000-0000-0000-0000-000000000001",
            role=MembershipRole.viewer,
            accepted_at=datetime.now(timezone.utc),
        ),
    )

    resp = client.patch(f"/sources/suggestions/{suggestion.id}", json={"action": "accepted"})
    assert resp.status_code == 403


def test_source_suggestion_not_found(client, monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "get_source_suggestion",
        lambda _client, _suggestion_id: (_ for _ in ()).throw(KeyError("missing")),
    )

    resp = client.patch("/sources/suggestions/55555555-5555-5555-5555-555555555555", json={"action": "accepted"})
    assert resp.status_code == 404


def test_source_suggestion_conflict_when_already_reviewed(client, monkeypatch) -> None:
    suggestion = SourceSuggestion(
        id="66666666-6666-6666-6666-666666666666",
        hub_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type=SourceSuggestionType.web,
        status=SourceSuggestionStatus.accepted,
        url="https://example.com/docs",
        canonical_url="https://example.com/docs",
        title="Example docs",
        confidence=0.82,
        created_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(store_module.store, "get_source_suggestion", lambda _client, _suggestion_id: suggestion)

    resp = client.patch(f"/sources/suggestions/{suggestion.id}", json={"action": "accepted"})
    assert resp.status_code == 409


def test_source_suggestion_conflict_when_review_claim_is_lost(client, monkeypatch) -> None:
    suggestion = SourceSuggestion(
        id="77777777-7777-7777-7777-777777777777",
        hub_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type=SourceSuggestionType.web,
        status=SourceSuggestionStatus.pending,
        url="https://example.com/docs",
        canonical_url="https://example.com/docs",
        title="Example docs",
        confidence=0.82,
        created_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(store_module.store, "get_source_suggestion", lambda _client, _suggestion_id: suggestion)
    monkeypatch.setattr(
        store_module.store,
        "get_member_role",
        lambda _client, _hub_id, _user_id: HubMember(
            hub_id=suggestion.hub_id,
            user_id="00000000-0000-0000-0000-000000000001",
            role=MembershipRole.editor,
            accepted_at=datetime.now(timezone.utc),
        ),
    )
    monkeypatch.setattr(
        store_module.store,
        "update_source_suggestion",
        lambda _client, _suggestion_id, _payload, **_kwargs: (_ for _ in ()).throw(ConflictError("lost race")),
    )
    monkeypatch.setattr(
        store_module.store,
        "create_web_source",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("create_web_source should not run after a lost claim")),
    )

    resp = client.patch(f"/sources/suggestions/{suggestion.id}", json={"action": "accepted"})
    assert resp.status_code == 409
