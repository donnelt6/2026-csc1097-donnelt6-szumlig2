"""Router tests for sources endpoints with mocked rate limits and store calls."""

from app.routers import sources as sources_router
from app.schemas import Source, SourceStatus, SourceStatusResponse
from app.services import rate_limit as rate_limit_module
from app.services import store as store_module


def test_list_sources_returns_sources(client, monkeypatch) -> None:
    # Mocks list_sources; expect /sources/{hub_id} to return sources.
    source = Source(id="src-1", hub_id="hub-1", original_name="doc.txt", status=SourceStatus.queued)
    monkeypatch.setattr(store_module.store, "list_sources", lambda _client, hub_id: [source])

    resp = client.get("/sources/hub-1")
    assert resp.status_code == 200
    assert resp.json()[0]["id"] == "src-1"


def test_create_source_rate_limited(client, monkeypatch) -> None:
    # Forces rate limit failure; expect 429 response.
    rl = rate_limit_module.RateLimitResult(allowed=False, remaining=0, reset_in_seconds=10)
    monkeypatch.setattr(sources_router.rate_limiter, "check", lambda key, limit: rl)

    resp = client.post("/sources", json={"hub_id": "hub-1", "original_name": "doc.txt"})
    assert resp.status_code == 429


def test_create_source_success(client, monkeypatch) -> None:
    # Mocks create_source; expect 201 with upload URL and source payload.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setattr(sources_router.rate_limiter, "check", lambda key, limit: rl)

    source = Source(id="src-2", hub_id="hub-1", original_name="doc.txt", status=SourceStatus.queued)
    monkeypatch.setattr(store_module.store, "create_source", lambda _client, payload: (source, "http://upload"))

    resp = client.post("/sources", json={"hub_id": "hub-1", "original_name": "doc.txt"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["source"]["id"] == "src-2"
    assert data["upload_url"] == "http://upload"


def test_get_source_status_not_found(client, monkeypatch) -> None:
    # Mocks missing source; expect 404 response.
    def raise_not_found(_client, source_id):
        raise KeyError("Source not found")

    monkeypatch.setattr(store_module.store, "get_source_status", raise_not_found)
    resp = client.get("/sources/src-404/status")
    assert resp.status_code == 404


def test_enqueue_source_missing_storage_path(client, monkeypatch) -> None:
    # Mocks source without storage path; expect 400 response.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setattr(sources_router.rate_limiter, "check", lambda key, limit: rl)

    source = Source(id="src-3", hub_id="hub-1", original_name="doc.txt", status=SourceStatus.queued)
    monkeypatch.setattr(store_module.store, "get_source", lambda _client, source_id: source)

    resp = client.post("/sources/src-3/enqueue")
    assert resp.status_code == 400


def test_enqueue_source_success(client, monkeypatch) -> None:
    # Mocks enqueue path; expect task dispatch and queued status.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setattr(sources_router.rate_limiter, "check", lambda key, limit: rl)

    source = Source(
        id="src-4",
        hub_id="hub-1",
        original_name="doc.txt",
        status=SourceStatus.queued,
        storage_path="hub-1/src-4/doc.txt",
    )
    monkeypatch.setattr(store_module.store, "get_source", lambda _client, source_id: source)

    sent = {}

    def fake_send_task(name, args):
        sent["name"] = name
        sent["args"] = args

    monkeypatch.setattr(sources_router.celery_app, "send_task", fake_send_task)

    resp = client.post("/sources/src-4/enqueue")
    assert resp.status_code == 200
    assert resp.json()["status"] == "queued"
