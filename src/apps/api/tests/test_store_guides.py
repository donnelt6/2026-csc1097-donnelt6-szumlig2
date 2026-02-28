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
