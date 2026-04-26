"""Unit tests for store source creation cleanup behavior and suggestion dedupe helpers."""

import uuid
from datetime import datetime, timezone

import pytest

from app.schemas import Source, SourceCreate, SourceStatus, SourceSuggestion, SourceSuggestionStatus, SourceSuggestionType, SourceType, YouTubeFallbackSourceCreate, YouTubeSourceCreate
from app.services import store as store_module
from app.services.store import source_helpers
from app.services.store import sources as sources_module


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
        self._contains_filters: dict[str, dict] = {}
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

    # Captures a JSON containment filter for the current query stub.
    def contains(self, column: str, value: dict) -> "FakeTable":
        self._contains_filters[column] = value
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
        if self._op == "select" and self.name == "sources":
            rows = [dict(row) for row in self.client.sources]
            for column, value in self._filters.items():
                rows = [row for row in rows if str(row.get(column)) == value]
            for column, expected in self._contains_filters.items():
                rows = [
                    row for row in rows
                    if isinstance(row.get(column), dict)
                    and all(row[column].get(key) == expected_value for key, expected_value in expected.items())
                ]
            if self._limit is not None:
                rows = rows[:self._limit]
            return FakeResponse(rows)
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
        self.sources: list[dict] = []
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


# Verifies that standalone manual media uploads persist the media file kind metadata.
def test_create_source_marks_manual_media_upload(monkeypatch) -> None:
    fake_client = FakeClient()
    source_id = uuid.UUID("12121212-1212-1212-1212-121212121212")
    hub_id = uuid.UUID("abababab-abab-abab-abab-abababababab")

    monkeypatch.setattr(store_module.uuid, "uuid4", lambda: source_id)
    monkeypatch.setattr(store_module.store, "create_upload_url", lambda _path: "http://upload.media")

    payload = SourceCreate(hub_id=hub_id, original_name="clip.mp4", file_kind="media")

    source, upload_url = store_module.store.create_source(fake_client, payload)

    assert source.type == SourceType.file
    assert upload_url == "http://upload.media"
    inserted = fake_client.inserted[0][1]
    assert inserted["ingestion_metadata"] == {"file_kind": "media", "source_origin": "manual_media"}


# Verifies that canonicalize web url strips tracking and fragment.
def test_canonicalize_web_url_strips_tracking_and_fragment() -> None:
    canonical = source_helpers.canonicalize_web_url("https://www.Example.com/docs/?utm_source=test&topic=1#intro")
    assert canonical == "https://example.com/docs?topic=1"


# Verifies that shared YouTube parsing stays available through source helpers.
def test_extract_youtube_video_id_uses_shared_helper() -> None:
    assert source_helpers.extract_youtube_video_id("https://youtube.com/live/abc123def45") == "abc123def45"
    assert source_helpers.normalize_youtube_id("invalid") is None


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


# Verifies that duplicate YouTube videos are rejected within the same hub.
def test_create_youtube_source_rejects_duplicate_video() -> None:
    fake_client = FakeClient()
    fake_client.sources = [
        {
            "id": "src-yt-1",
            "hub_id": "11111111-1111-1111-1111-111111111111",
            "type": SourceType.youtube.value,
            "original_name": "youtube.com/abc123def45",
            "status": SourceStatus.complete.value,
            "ingestion_metadata": {"url": "https://youtu.be/abc123def45", "video_id": "abc123def45"},
            "created_at": datetime.now(timezone.utc),
        }
    ]
    payload = YouTubeSourceCreate(
        hub_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        url="https://www.youtube.com/watch?v=abc123def45",
        language="en",
        allow_auto_captions=True,
    )

    with pytest.raises(ValueError, match="already in this hub"):
        store_module.store.create_youtube_source(fake_client, payload)


# Verifies that duplicate detection still catches legacy YouTube rows that only stored the URL.
def test_create_youtube_source_rejects_duplicate_video_from_legacy_url_only_row(monkeypatch) -> None:
    fake_client = FakeClient()
    existing = Source(
        id="src-yt-legacy",
        hub_id="11111111-1111-1111-1111-111111111111",
        type=SourceType.youtube,
        original_name="youtube.com/abc123def45",
        status=SourceStatus.complete,
        ingestion_metadata={"url": "https://youtu.be/abc123def45"},
        created_at=datetime.now(timezone.utc),
    )
    payload = YouTubeSourceCreate(
        hub_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        url="https://www.youtube.com/watch?v=abc123def45",
        language="en",
        allow_auto_captions=True,
    )
    monkeypatch.setattr(store_module.store, "list_sources", lambda _client, _hub_id: [existing])

    with pytest.raises(ValueError, match="already in this hub"):
        store_module.store.create_youtube_source(fake_client, payload)


# Verifies that linked YouTube fallback sources are created as file sources with linkage metadata.
def test_create_youtube_fallback_source_creates_linked_file(monkeypatch) -> None:
    fake_client = FakeClient()
    parent = Source(
        id="src-yt-1",
        hub_id="hub-1",
        type=SourceType.youtube,
        original_name="youtube.com/abc123def45",
        status=SourceStatus.failed,
        ingestion_metadata={
            "url": "https://www.youtube.com/watch?v=abc123def45",
            "video_id": "abc123def45",
            "youtube_fallback_allowed": True,
        },
        created_at=datetime.now(timezone.utc),
    )

    payload = YouTubeFallbackSourceCreate(
        hub_id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        youtube_source_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        original_name="lecture.mp4",
    )
    parent.id = "11111111-1111-1111-1111-111111111111"
    parent.hub_id = str(payload.hub_id)
    monkeypatch.setattr(store_module.store, "get_source", lambda _client, source_id: parent if source_id == parent.id else None)
    monkeypatch.setattr(store_module.store, "create_upload_url", lambda _path: "http://upload.fallback")

    source, upload_url = store_module.store.create_youtube_fallback_source(fake_client, payload)

    assert source.type == SourceType.file
    assert upload_url == "http://upload.fallback"
    inserted = fake_client.inserted[0][1]
    assert inserted["ingestion_metadata"]["source_origin"] == "youtube_fallback"
    assert inserted["ingestion_metadata"]["youtube_fallback_parent_source_id"] == parent.id
    assert fake_client.updates[-1][2]["ingestion_metadata"]["youtube_fallback_source_status"] == "pending_upload"


# Verifies that stale pending-upload fallback rows are replaced by a new recovery attempt.
def test_create_youtube_fallback_source_replaces_stale_pending_upload(monkeypatch) -> None:
    fake_client = FakeClient()
    deleted_source_ids: list[str] = []
    parent = Source(
        id="src-yt-2",
        hub_id="hub-1",
        type=SourceType.youtube,
        original_name="youtube.com/xyz987uvw65",
        status=SourceStatus.failed,
        ingestion_metadata={
            "url": "https://www.youtube.com/watch?v=xyz987uvw65",
            "video_id": "xyz987uvw65",
            "youtube_fallback_allowed": True,
            "youtube_fallback_source_id": "src-fallback-stale",
            "youtube_fallback_source_status": "pending_upload",
        },
        created_at=datetime.now(timezone.utc),
    )

    payload = YouTubeFallbackSourceCreate(
        hub_id=uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        youtube_source_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        original_name="retry.mp4",
    )
    parent.id = "22222222-2222-2222-2222-222222222222"
    parent.hub_id = str(payload.hub_id)
    monkeypatch.setattr(store_module.store, "get_source", lambda _client, source_id: parent if source_id == parent.id else (_ for _ in ()).throw(KeyError("missing")))
    monkeypatch.setattr(store_module.store, "create_upload_url", lambda _path: "http://upload.retry")
    monkeypatch.setattr(store_module.store, "delete_source", lambda _client, source_id: deleted_source_ids.append(source_id))

    source, upload_url = store_module.store.create_youtube_fallback_source(fake_client, payload)

    assert source.type == SourceType.file
    assert upload_url == "http://upload.retry"
    assert deleted_source_ids == ["src-fallback-stale"]


# Verifies that stale fallback cleanup logs the original delete failure before surfacing a friendly error.
def test_create_youtube_fallback_source_logs_delete_failure(monkeypatch) -> None:
    parent = Source(
        id="src-yt-2",
        hub_id="hub-1",
        type=SourceType.youtube,
        original_name="youtube.com/xyz987uvw65",
        status=SourceStatus.failed,
        ingestion_metadata={
            "url": "https://www.youtube.com/watch?v=xyz987uvw65",
            "video_id": "xyz987uvw65",
            "youtube_fallback_allowed": True,
            "youtube_fallback_source_id": "src-fallback-stale",
            "youtube_fallback_source_status": "pending_upload",
        },
        created_at=datetime.now(timezone.utc),
    )
    payload = YouTubeFallbackSourceCreate(
        hub_id=uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        youtube_source_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        original_name="retry.mp4",
    )
    parent.id = "22222222-2222-2222-2222-222222222222"
    parent.hub_id = str(payload.hub_id)

    fake_client = FakeClient()
    logged: list[str] = []

    monkeypatch.setattr(store_module.store, "get_source", lambda _client, source_id: parent if source_id == parent.id else (_ for _ in ()).throw(KeyError("missing")))
    monkeypatch.setattr(store_module.store, "delete_source", lambda _client, _source_id: (_ for _ in ()).throw(RuntimeError("delete denied")))
    monkeypatch.setattr(sources_module.logger, "exception", lambda message, *args, **kwargs: logged.append(message))

    with pytest.raises(ValueError, match="already being prepared"):
        store_module.store.create_youtube_fallback_source(fake_client, payload)

    assert logged == ["Failed to delete stale pending YouTube fallback source before creating a replacement"]


# Verifies that parent YouTube refresh is blocked while a manual recovery owns the retry flow.
def test_refresh_youtube_source_rejects_active_fallback(monkeypatch) -> None:
    source = Source(
        id="src-yt-3",
        hub_id="hub-1",
        type=SourceType.youtube,
        original_name="youtube.com/abc123def45",
        status=SourceStatus.failed,
        ingestion_metadata={
            "url": "https://www.youtube.com/watch?v=abc123def45",
            "video_id": "abc123def45",
            "youtube_fallback_source_id": "src-fallback-active",
            "youtube_fallback_source_status": "processing",
        },
        created_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(store_module.store, "get_source", lambda _client, _source_id: source)

    with pytest.raises(ValueError, match="active manual upload recovery"):
        store_module.store.refresh_youtube_source(object(), source.id)


# Verifies that deleting an older fallback child does not clear the parent's current recovery pointer.
def test_delete_source_preserves_newer_fallback_parent_pointer(monkeypatch) -> None:
    fake_client = FakeClient()
    deleted_child = Source(
        id="src-fallback-old",
        hub_id="hub-1",
        type=SourceType.file,
        original_name="old.mp4",
        storage_path="hub-1/src-fallback-old/old.mp4",
        status=SourceStatus.failed,
        ingestion_metadata={
            "source_origin": "youtube_fallback",
            "youtube_fallback_parent_source_id": "src-yt-parent",
        },
        created_at=datetime.now(timezone.utc),
    )
    parent = Source(
        id="src-yt-parent",
        hub_id="hub-1",
        type=SourceType.youtube,
        original_name="youtube.com/abc123def45",
        status=SourceStatus.failed,
        ingestion_metadata={
            "youtube_fallback_source_id": "src-fallback-current",
            "youtube_fallback_source_status": "processing",
        },
        created_at=datetime.now(timezone.utc),
    )

    storage_remove = []

    def fake_get_source(_client, source_id):
        if source_id == deleted_child.id:
            return deleted_child
        if source_id == parent.id:
            return parent
        raise KeyError(source_id)

    monkeypatch.setattr(store_module.store, "get_source", fake_get_source)
    monkeypatch.setattr(
        store_module.store.service_client.storage,
        "from_",
        lambda _bucket: type("FakeBucket", (), {"remove": lambda _self, paths: storage_remove.append(paths)})(),
    )

    store_module.store.delete_source(fake_client, deleted_child.id)

    assert fake_client.deleted == [("sources", {"id": deleted_child.id})]
    assert storage_remove == [[deleted_child.storage_path]]
    assert fake_client.updates == []


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
