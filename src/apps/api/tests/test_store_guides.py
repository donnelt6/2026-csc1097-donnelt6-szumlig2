"""Unit tests for guide generation logic with stubbed clients."""

from app.schemas import GuideGenerateRequest
from app.services.store import store


class FakeResponse:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


class FakeTable:
    def __init__(self, name: str) -> None:
        self.name = name
        self._payload = None
        self._action = None

    def select(self, *args, **kwargs) -> "FakeTable":
        return self

    def eq(self, *args, **kwargs) -> "FakeTable":
        return self

    def is_(self, *args, **kwargs) -> "FakeTable":
        return self

    def order(self, *args, **kwargs) -> "FakeTable":
        return self

    def limit(self, *args, **kwargs) -> "FakeTable":
        return self

    def update(self, payload: dict) -> "FakeTable":
        self._action = "update"
        self._payload = payload
        return self

    def insert(self, payload: list[dict] | dict) -> "FakeTable":
        self._action = "insert"
        self._payload = payload
        return self

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
        return FakeResponse([])


class FakeClient:
    def table(self, name: str) -> FakeTable:
        return FakeTable(name)


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
