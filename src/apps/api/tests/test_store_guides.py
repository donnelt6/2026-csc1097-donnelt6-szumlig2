"""Unit tests for guide generation logic with stubbed clients."""

from app.schemas import GuideGenerateRequest
from app.services.store import store


# Simple response stub used by the surrounding tests.
# Test helpers and fixtures.
class FakeResponse:

    # Initializes the test helper state used by this class.
    def __init__(self, data: list[dict]) -> None:
        self.data = data


# Table stub used to emulate Supabase table calls in tests.
class FakeTable:
    # Initializes the test helper state used by this class.
    def __init__(self, name: str) -> None:
        self.name = name
        self._payload = None
        self._action = None

    # Captures the requested select clause for later execution.
    def select(self, *args, **kwargs) -> "FakeTable":
        return self

    # Captures an equality filter for the current query stub.
    def eq(self, *args, **kwargs) -> "FakeTable":
        return self

    # Helper used by the surrounding test code.
    def is_(self, *args, **kwargs) -> "FakeTable":
        return self

    # Captures ordering details for the current query stub.
    def order(self, *args, **kwargs) -> "FakeTable":
        return self

    # Captures a result limit for the current query stub.
    def limit(self, *args, **kwargs) -> "FakeTable":
        return self

    # Captures an update payload for the current query stub.
    def update(self, payload: dict) -> "FakeTable":
        self._action = "update"
        self._payload = payload
        return self

    # Records an insert payload and returns the stub for chaining.
    def insert(self, payload: list[dict] | dict) -> "FakeTable":
        self._action = "insert"
        self._payload = payload
        return self

    # Returns the prepared fake response for the current operation.
    def execute(self) -> FakeResponse:
        if self._action == "insert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            data = []
            for idx, row in enumerate(payloads, start=1):
                stored = dict(row)
                if self.name == "guide_entries":
                    stored.setdefault("id", f"guide-{idx}")
                    stored.setdefault("created_at", "2026-01-01T00:00:00Z")
                if self.name == "guide_steps":
                    stored.setdefault("id", f"step-{idx}")
                    stored.setdefault("created_at", "2026-01-01T00:00:00Z")
                data.append(stored)
            return FakeResponse(data)
        if self._action == "update":
            stored = dict(self._payload or {})
            if self.name == "guide_entries":
                stored.setdefault("id", "guide-1")
                stored.setdefault("hub_id", "hub-1")
                stored.setdefault("title", stored.get("title", "Guide"))
                stored.setdefault("topic", stored.get("topic"))
                stored.setdefault("topic_label", stored.get("topic_label"))
                stored.setdefault("topic_labels", stored.get("topic_labels", []))
                stored.setdefault("summary", stored.get("summary"))
                stored.setdefault("source_ids", [])
                stored.setdefault("is_favourited", False)
                stored.setdefault("created_at", "2026-01-01T00:00:00Z")
            if self.name == "guide_steps":
                stored.setdefault("id", "step-1")
                stored.setdefault("guide_id", "guide-1")
                stored.setdefault("step_index", 1)
                stored.setdefault("title", stored.get("title"))
                stored.setdefault("instruction", stored.get("instruction", "Instruction"))
                stored.setdefault("citations", stored.get("citations", []))
                stored.setdefault("confidence", stored.get("confidence", 1.0))
                stored.setdefault("created_at", "2026-01-01T00:00:00Z")
            return FakeResponse([stored])
        return FakeResponse([])


# Simple client stub used by the surrounding tests.
class FakeClient:
    # Returns a stub table object for the requested table name.
    def table(self, name: str) -> FakeTable:
        return FakeTable(name)


# Matches selected fields so nested payload assertions stay concise.
def _match(
    source_id: str,
    similarity: float,
    embedding: list[float],
    snippet: str = "Snippet",
    chunk_index: int = 0,
) -> dict:
    return {
        "source_id": source_id,
        "text": snippet,
        "chunk_index": chunk_index,
        "similarity": similarity,
        "embedding": embedding,
    }


# Verifies that generate guide skips steps without citations.
# Store service tests.
def test_generate_guide_skips_steps_without_citations(monkeypatch) -> None:

    fake_client = FakeClient()
    monkeypatch.setattr(
        store,
        "_fetch_source_context",
        lambda client, hub_id, source_id, limit: [{"source_id": source_id, "chunk_index": 0, "text": "Context"}],
    )
    monkeypatch.setattr(
        store,
        "_generate_guide_steps",
        lambda context, topic, count: [
            {"title": "Step 1", "instruction": "First"},
            {"title": "Step 2", "instruction": "Second"},
        ],
    )
    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])

    matches = [
        [],
        [{"source_id": "src-1", "text": "Snippet", "chunk_index": 0, "similarity": 0.9}],
    ]

    # Helper used by the surrounding test code.
    def fake_match(*_args, **_kwargs):
        return matches.pop(0)

    monkeypatch.setattr(store, "_match_chunks", fake_match)

    payload = GuideGenerateRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        source_ids=["22222222-2222-2222-2222-222222222222"],
        topic="Onboarding",
    )
    entry = store.generate_guide(fake_client, "user-1", payload)

    assert entry is not None
    assert len(entry.steps) == 1
    assert entry.steps[0].instruction == "Second"


# Verifies that generate guide requires cited steps.
def test_generate_guide_requires_cited_steps(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(
        store,
        "_fetch_source_context",
        lambda client, hub_id, source_id, limit: [{"source_id": source_id, "chunk_index": 0, "text": "Context"}],
    )
    monkeypatch.setattr(
        store,
        "_generate_guide_steps",
        lambda context, topic, count: [{"title": "Step 1", "instruction": "First"}],
    )
    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])
    monkeypatch.setattr(store, "_match_chunks", lambda *args, **kwargs: [])

    payload = GuideGenerateRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        source_ids=["22222222-2222-2222-2222-222222222222"],
    )
    entry = store.generate_guide(fake_client, "user-1", payload)

    assert entry is None


# Verifies that generate guide diversifies step citations for mixed sources.
def test_generate_guide_diversifies_step_citations_for_mixed_sources(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(
        store,
        "_fetch_source_context",
        lambda client, hub_id, source_id, limit: [{"source_id": source_id, "chunk_index": 0, "text": "Context"}],
    )
    monkeypatch.setattr(
        store,
        "_generate_guide_steps",
        lambda context, topic, count: [{"title": "Step 1", "instruction": "First"}],
    )
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-a", 0.99, [1.0, 0.0], snippet="A1", chunk_index=0),
            _match("src-a", 0.98, [0.99, 0.01], snippet="A2", chunk_index=1),
            _match("src-b", 0.82, [0.2, 0.98], snippet="B1", chunk_index=2),
            _match("src-c", 0.78, [0.0, 1.0], snippet="C1", chunk_index=3),
        ],
    )

    payload = GuideGenerateRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        source_ids=["22222222-2222-2222-2222-222222222222"],
        topic="Onboarding",
    )
    entry = store.generate_guide(fake_client, "user-1", payload)

    assert entry is not None
    assert len(entry.steps) == 1
    assert len(entry.steps[0].citations) == 3
    assert len({citation.source_id for citation in entry.steps[0].citations}) >= 2


# Verifies that generate guide sparse fallback keeps best raw matches.
def test_generate_guide_sparse_fallback_keeps_best_raw_matches(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(
        store,
        "_fetch_source_context",
        lambda client, hub_id, source_id, limit: [{"source_id": source_id, "chunk_index": 0, "text": "Context"}],
    )
    monkeypatch.setattr(
        store,
        "_generate_guide_steps",
        lambda context, topic, count: [{"title": "Step 1", "instruction": "First"}],
    )
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-low", 0.25, [1.0, 0.0], snippet="Low", chunk_index=0),
            _match("src-lower", 0.20, [0.0, 1.0], snippet="Lower", chunk_index=1),
        ],
    )

    payload = GuideGenerateRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        source_ids=["22222222-2222-2222-2222-222222222222"],
        topic="Onboarding",
    )
    entry = store.generate_guide(fake_client, "user-1", payload)

    assert entry is not None
    assert [citation.source_id for citation in entry.steps[0].citations] == ["src-low", "src-lower"]


def test_generate_guide_persists_topic_labels_from_supplied_topic(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(
        store,
        "_fetch_source_context",
        lambda client, hub_id, source_id, limit: [{"source_id": source_id, "chunk_index": 0, "text": "Context"}],
    )
    monkeypatch.setattr(
        store,
        "_generate_guide_steps",
        lambda context, topic, count: [{"title": "Step 1", "instruction": "First"}],
    )
    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            {"source_id": "src-1", "text": "Snippet", "chunk_index": 0, "similarity": 0.9}
        ],
    )

    payload = GuideGenerateRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        source_ids=["22222222-2222-2222-2222-222222222222"],
        topic="HR",
    )
    entry = store.generate_guide(fake_client, "user-1", payload)

    assert entry is not None
    assert entry.topic_label == "HR"
    assert entry.topic_labels == ["HR"]


def test_update_guide_recomputes_topic_labels(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(
        store,
        "get_guide",
        lambda client, guide_id: type(
            "GuideStub",
            (),
            {
                "id": guide_id,
                "hub_id": "hub-1",
                "title": "Original title",
                "topic": None,
                "summary": None,
            },
        )(),
    )
    monkeypatch.setattr(store, "_fetch_guide_steps", lambda client, guide_id: [{"title": "Step 1", "instruction": "Do this"}])
    monkeypatch.setattr(store, "_safe_topic_labels_for_guide", lambda **kwargs: ["HR", "Security"])

    table = FakeTable("guide_entries")
    monkeypatch.setattr(fake_client, "table", lambda name: table if name == "guide_entries" else FakeTable(name))

    store.update_guide(fake_client, "guide-1", {"title": "Updated title"})

    assert table._payload == {"title": "Updated title", "topic_label": "HR", "topic_labels": ["HR", "Security"]}


def test_create_guide_step_refreshes_parent_topic_label(monkeypatch) -> None:
    fake_client = FakeClient()
    refreshed: list[str] = []
    monkeypatch.setattr(store, "_refresh_guide_topic_label", lambda client, guide_id: refreshed.append(guide_id))

    store.create_guide_step(
        fake_client,
        "guide-1",
        type("GuideStepPayload", (), {"title": "Step title", "instruction": "Step body"})(),
    )

    assert refreshed == ["guide-1"]


def test_update_guide_step_refreshes_parent_topic_label(monkeypatch) -> None:
    fake_client = FakeClient()
    refreshed: list[str] = []
    monkeypatch.setattr(store, "_refresh_guide_topic_label", lambda client, guide_id: refreshed.append(guide_id))

    store.update_guide_step(fake_client, "step-1", {"instruction": "Updated"})

    assert refreshed == ["guide-1"]


def test_clean_guide_subject_phrase_strips_setup_boilerplate() -> None:
    assert store._clean_guide_subject_phrase("setting up a vector clock") == "Vector Clock"
    assert store._clean_guide_subject_phrase("guide to setting up vector clock") == "Vector Clock"


def test_safe_topic_labels_for_guide_prefers_cleaned_title_or_topic(monkeypatch) -> None:
    monkeypatch.setattr(store, "_safe_classify_topic_labels", lambda content: ["Distributed Systems", "Concurrency"])

    labels = store._safe_topic_labels_for_guide(
        title="guide to setting up vector clock",
        topic=None,
        step_payloads=[{"title": "Step 1", "instruction": "Configure the clock"}],
    )

    assert labels == ["Vector Clock", "Distributed Systems", "Concurrency"]


def test_safe_topic_labels_for_guide_merges_explicit_topic_with_recomputed_labels(monkeypatch) -> None:
    monkeypatch.setattr(store, "_safe_classify_topic_labels", lambda content: ["Security", "Access"])

    labels = store._safe_topic_labels_for_guide(
        title="account access",
        topic="onbroading",
        step_payloads=[{"title": "Reset password", "instruction": "Use the password portal"}],
    )

    assert labels == ["Onbroading", "Account Access", "Security"]
