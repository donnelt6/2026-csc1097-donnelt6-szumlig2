"""Unit tests for store source creation cleanup behavior and suggestion dedupe helpers."""

import uuid
from datetime import datetime, timezone

import pytest

from app.schemas import Source, SourceCreate, SourceStatus, SourceSuggestion, SourceSuggestionStatus, SourceSuggestionType, SourceType
from app.services import store as store_module


# Simple response stub used by the surrounding tests.
# Test helpers and fixtures.
class FakeResponse:

    # Initializes the test helper state used by this class.
    def __init__(self, data: list[dict]) -> None:
        self.data = data


# Table stub used to emulate Supabase table calls in tests.
class FakeTable:
    # Initializes the test helper state used by this class.
    def __init__(self, client: "FakeClient", name: str) -> None:
        self.client = client
        self.name = name
        self._payload: dict | None = None
        self._op: str | None = None
        self._filters: dict[str, str] = {}
        self._selected_fields: str | None = None
        self._limit: int | None = None

    # Records an insert payload and returns the stub for chaining.
    def insert(self, payload: dict) -> "FakeTable":
        self._op = "insert"
        self._payload = payload
        self.client.inserted.append((self.name, payload))
        return self

    # Captures an update payload for the current query stub.
    def update(self, payload: dict) -> "FakeTable":
        self._op = "update"
        self._payload = payload
        return self

    # Captures the requested select clause for later execution.
    def select(self, fields: str) -> "FakeTable":
        self._op = "select"
        self._selected_fields = fields
        return self

    # Marks the current query stub as a delete operation.
    def delete(self) -> "FakeTable":
        self._op = "delete"
        return self

    # Captures an equality filter for the current query stub.
    def eq(self, column: str, value: str) -> "FakeTable":
        self._filters[column] = value
        return self

    # Captures a result limit for the current query stub.
    def limit(self, value: int) -> "FakeTable":
        self._limit = value
        return self

    # Returns the prepared fake response for the current operation.
    def execute(self) -> FakeResponse:
        if self._op == "insert":
            return FakeResponse([self._payload or {}])
        if self._op == "update":
            self.client.updates.append((self.name, dict(self._filters), self._payload or {}))
            row = self.client.source_suggestions.get(self._filters.get("id", ""))
            if row is None:
                return FakeResponse([])
            expected_status = self._filters.get("status")
            if expected_status is not None and row.get("status") != expected_status:
                return FakeResponse([])
            row.update(self._payload or {})
            return FakeResponse([dict(row)])
        if self._op == "select" and self.name == "source_suggestions":
            row = self.client.source_suggestions.get(self._filters.get("id", ""))
            if row is None:
                return FakeResponse([])
            return FakeResponse([{"id": row["id"]}])
        if self._op == "delete":
            self.client.deleted.append((self.name, dict(self._filters)))
            return FakeResponse([{"id": self._filters.get("id")}])
        return FakeResponse([{}])


# Simple client stub used by the surrounding tests.
class FakeClient:
    # Initializes the test helper state used by this class.
    def __init__(self) -> None:
        self.inserted: list[tuple[str, dict]] = []
        self.deleted: list[tuple[str, dict[str, str]]] = []
        self.updates: list[tuple[str, dict[str, str], dict]] = []
        self.source_suggestions: dict[str, dict] = {}

    # Returns a stub table object for the requested table name.
    def table(self, name: str) -> FakeTable:
        return FakeTable(self, name)


# Verifies that create source deletes row on upload url failure.
# Store service tests.
def test_create_source_deletes_row_on_upload_url_failure(monkeypatch) -> None:

    fake_client = FakeClient()
    source_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
    hub_id = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

    monkeypatch.setattr(store_module.uuid, "uuid4", lambda: source_id)

    # Helper used by the surrounding test code.
    def raise_upload_url(_path: str) -> str:
        raise RuntimeError("Failed to create signed upload URL")

    monkeypatch.setattr(store_module.store, "create_upload_url", raise_upload_url)

    payload = SourceCreate(hub_id=hub_id, original_name="doc.txt")

    with pytest.raises(RuntimeError):
        store_module.store.create_source(fake_client, payload)

    assert fake_client.deleted == [("sources", {"id": str(source_id)})]


# Verifies that canonicalize web url strips tracking and fragment.
def test_canonicalize_web_url_strips_tracking_and_fragment() -> None:
    canonical = store_module._canonicalize_web_url("https://www.Example.com/docs/?utm_source=test&topic=1#intro")
    assert canonical == "https://example.com/docs?topic=1"


# Verifies that find existing source for web suggestion.
def test_find_existing_source_for_web_suggestion(monkeypatch) -> None:
    suggestion = SourceSuggestion(
        id="suggestion-1",
        hub_id="hub-1",
        type=SourceSuggestionType.web,
        status=SourceSuggestionStatus.pending,
        url="https://example.com/docs?utm_source=test",
        canonical_url="https://example.com/docs",
        title="Docs",
        confidence=0.7,
        created_at=datetime.now(timezone.utc),
    )
    existing = Source(
        id="src-1",
        hub_id="hub-1",
        type=SourceType.web,
        original_name="Docs",
        status=SourceStatus.complete,
        ingestion_metadata={"final_url": "https://www.example.com/docs/"},
        created_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(store_module.store, "list_sources", lambda _client, _hub_id: [existing])

    matched = store_module.store.find_existing_source_for_suggestion(object(), suggestion)
    assert matched is not None
    assert matched.id == existing.id


# Verifies that find existing source for youtube suggestion.
def test_find_existing_source_for_youtube_suggestion(monkeypatch) -> None:
    suggestion = SourceSuggestion(
        id="suggestion-2",
        hub_id="hub-1",
        type=SourceSuggestionType.youtube,
        status=SourceSuggestionStatus.pending,
        url="https://www.youtube.com/watch?v=abc123def45",
        video_id="abc123def45",
        title="Video",
        confidence=0.9,
        created_at=datetime.now(timezone.utc),
    )
    existing = Source(
        id="src-yt-1",
        hub_id="hub-1",
        type=SourceType.youtube,
        original_name="Video",
        status=SourceStatus.complete,
        ingestion_metadata={"url": "https://youtu.be/abc123def45"},
        created_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(store_module.store, "list_sources", lambda _client, _hub_id: [existing])

    matched = store_module.store.find_existing_source_for_suggestion(object(), suggestion)
    assert matched is not None
    assert matched.id == existing.id


# Verifies that update source suggestion uses expected status guard.
def test_update_source_suggestion_uses_expected_status_guard() -> None:
    fake_client = FakeClient()
    suggestion_id = "suggestion-guarded"
    fake_client.source_suggestions[suggestion_id] = {
        "id": suggestion_id,
        "hub_id": "hub-1",
        "type": SourceSuggestionType.web.value,
        "status": SourceSuggestionStatus.pending.value,
        "url": "https://example.com/docs",
        "canonical_url": "https://example.com/docs",
        "video_id": None,
        "title": "Docs",
        "description": None,
        "rationale": None,
        "confidence": 0.8,
        "seed_source_ids": [],
        "search_metadata": None,
        "created_at": datetime.now(timezone.utc),
        "reviewed_at": None,
        "reviewed_by": None,
        "accepted_source_id": None,
    }

    updated = store_module.store.update_source_suggestion(
        fake_client,
        suggestion_id,
        {"status": SourceSuggestionStatus.accepted.value},
        expected_status=SourceSuggestionStatus.pending,
    )

    assert updated.status == SourceSuggestionStatus.accepted
    assert fake_client.updates == [
        (
            "source_suggestions",
            {"id": suggestion_id, "status": SourceSuggestionStatus.pending.value},
            {"status": SourceSuggestionStatus.accepted.value},
        )
    ]


# Verifies that update source suggestion raises conflict when expected status is stale.
def test_update_source_suggestion_raises_conflict_when_expected_status_is_stale() -> None:
    fake_client = FakeClient()
    suggestion_id = "suggestion-conflict"
    fake_client.source_suggestions[suggestion_id] = {
        "id": suggestion_id,
        "hub_id": "hub-1",
        "type": SourceSuggestionType.web.value,
        "status": SourceSuggestionStatus.accepted.value,
        "url": "https://example.com/docs",
        "canonical_url": "https://example.com/docs",
        "video_id": None,
        "title": "Docs",
        "description": None,
        "rationale": None,
        "confidence": 0.8,
        "seed_source_ids": [],
        "search_metadata": None,
        "created_at": datetime.now(timezone.utc),
        "reviewed_at": None,
        "reviewed_by": None,
        "accepted_source_id": None,
    }

    with pytest.raises(store_module.ConflictError):
        store_module.store.update_source_suggestion(
            fake_client,
            suggestion_id,
            {"status": SourceSuggestionStatus.accepted.value},
            expected_status=SourceSuggestionStatus.pending,
        )
