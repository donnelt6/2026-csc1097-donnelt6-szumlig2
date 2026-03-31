"""Unit tests for FAQ generation logic with stubbed clients."""

from app.schemas import FaqGenerateRequest
from app.services.store import store


class FakeResponse:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


class FakeTable:
    def __init__(self, client: "FakeClient", name: str) -> None:
        self.client = client
        self.name = name
        self._payload = None
        self._action = None
        self._filters: list[tuple[str, object]] = []

    def select(self, *args, **kwargs) -> "FakeTable":
        return self

    def eq(self, key: str, value: object) -> "FakeTable":
        self._filters.append((key, value))
        return self

    def is_(self, key: str, value: object) -> "FakeTable":
        self._filters.append((key, value))
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
                stored.setdefault("id", f"faq-{idx}")
                stored.setdefault("archived_at", None)
                stored.setdefault("created_at", "2026-01-01T00:00:00Z")
                data.append(stored)
            return FakeResponse(data)
        if self._action == "update":
            self.client.updates.append((self.name, self._payload or {}, list(self._filters)))
        return FakeResponse([])


class FakeClient:
    def __init__(self) -> None:
        self.updates: list[tuple[str, dict, list[tuple[str, object]]]] = []

    def table(self, name: str) -> FakeTable:
        return FakeTable(self, name)


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


def test_generate_faqs_skips_entries_without_citations(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(
        store,
        "_fetch_source_context",
        lambda client, hub_id, source_id, limit: [{"source_id": source_id, "chunk_index": 0, "text": "Context"}],
    )
    monkeypatch.setattr(store, "_generate_faq_questions", lambda context, count, existing=None: ["Question 1", "Question 2"])
    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])

    matches = [
        [],
        [{"source_id": "src-1", "text": "Snippet", "chunk_index": 0, "similarity": 0.9}],
    ]

    def fake_match(*_args, **_kwargs):
        return matches.pop(0)

    monkeypatch.setattr(store, "_match_chunks", fake_match)
    monkeypatch.setattr(store, "_generate_faq_answer", lambda question, context: "Answer [1]")

    payload = FaqGenerateRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        source_ids=["22222222-2222-2222-2222-222222222222"],
    )
    entries = store.generate_faqs(fake_client, "user-1", payload)

    assert len(entries) == 1
    assert entries[0].question == "Question 2"


def test_generate_faqs_requires_cited_answer(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(
        store,
        "_fetch_source_context",
        lambda client, hub_id, source_id, limit: [{"source_id": source_id, "chunk_index": 0, "text": "Context"}],
    )
    monkeypatch.setattr(store, "_generate_faq_questions", lambda context, count, existing=None: ["Question 1"])
    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            {"source_id": "src-1", "text": "Snippet", "chunk_index": 0, "similarity": 0.9}
        ],
    )
    monkeypatch.setattr(store, "_generate_faq_answer", lambda question, context: "Answer without citations")

    payload = FaqGenerateRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        source_ids=["22222222-2222-2222-2222-222222222222"],
    )
    entries = store.generate_faqs(fake_client, "user-1", payload)

    assert entries == []
    assert fake_client.updates == []


def test_generate_faqs_diversifies_citations_for_mixed_source_questions(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(
        store,
        "_fetch_source_context",
        lambda client, hub_id, source_id, limit: [{"source_id": source_id, "chunk_index": 0, "text": "Context"}],
    )
    monkeypatch.setattr(store, "_generate_faq_questions", lambda context, count, existing=None: ["Question 1"])
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
    monkeypatch.setattr(store, "_generate_faq_answer", lambda question, context: "Answer [1] [2] [3]")

    payload = FaqGenerateRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        source_ids=["22222222-2222-2222-2222-222222222222"],
    )
    entries = store.generate_faqs(fake_client, "user-1", payload)

    assert len(entries) == 1
    assert len(entries[0].citations) == 3
    assert len({citation.source_id for citation in entries[0].citations}) >= 2


def test_generate_faqs_skips_entries_when_no_matches_clear_similarity_threshold(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(
        store,
        "_fetch_source_context",
        lambda client, hub_id, source_id, limit: [{"source_id": source_id, "chunk_index": 0, "text": "Context"}],
    )
    monkeypatch.setattr(store, "_generate_faq_questions", lambda context, count, existing=None: ["Question 1"])
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-a", 0.25, [1.0, 0.0], snippet="A1", chunk_index=0),
            _match("src-b", 0.20, [0.0, 1.0], snippet="B1", chunk_index=1),
        ],
    )
    monkeypatch.setattr(store, "_generate_faq_answer", lambda question, context: "Answer [1]")

    payload = FaqGenerateRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        source_ids=["22222222-2222-2222-2222-222222222222"],
    )
    entries = store.generate_faqs(fake_client, "user-1", payload)

    assert entries == []
