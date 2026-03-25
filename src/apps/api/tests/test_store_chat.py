"""Unit tests for store.chat with stubbed clients and retrieval results."""

from types import SimpleNamespace

import pytest

from app.schemas import ChatRequest, Citation, HubScope
from app.services.store import (
    _fallback_chat_session_title,
    _normalize_chat_session_title,
    _is_vague_follow_up,
    _most_recent_informative_user_turn,
    store,
)


class FakeResponse:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


class FakeTable:
    def __init__(self, client: "FakeClient", name: str) -> None:
        self.client = client
        self.name = name
        self._payload = None

    def insert(self, payload: dict) -> "FakeTable":
        self._payload = payload
        self.client.inserted.setdefault(self.name, []).append(payload)
        return self

    def execute(self) -> FakeResponse:
        if self.name == "chat_sessions":
            return FakeResponse([{"id": "session-1", "created_at": "2026-01-01T00:00:00Z"}])
        if self.name == "messages":
            self.client.message_count += 1
            return FakeResponse(
                [
                    {
                        "id": f"message-{self.client.message_count}",
                        "created_at": f"2026-01-01T00:00:0{self.client.message_count}Z",
                    }
                ]
            )
        return FakeResponse([{}])


class FakeClient:
    def __init__(self) -> None:
        self.message_count = 0
        self.inserted: dict[str, list[dict]] = {}

    def table(self, name: str) -> FakeTable:
        return FakeTable(self, name)


@pytest.fixture(autouse=True)
def stub_session_helpers(monkeypatch) -> None:
    monkeypatch.setattr(
        store,
        "_normalize_chat_source_ids",
        lambda client, hub_id, requested_source_ids: (
            ["src-1", "src-2"] if requested_source_ids is None else requested_source_ids,
            requested_source_ids,
        ),
    )
    monkeypatch.setattr(
        store,
        "_create_chat_session_with_messages",
        lambda **kwargs: {
            "session_id": "session-1",
            "session_title": kwargs["title"],
            "session_created_at": "2026-01-01T00:00:00Z",
            "assistant_message_id": "message-service-1",
            "assistant_created_at": "2026-01-01T00:00:01Z",
        },
    )
    monkeypatch.setattr(
        store,
        "_get_chat_session_row",
        lambda client, session_id, include_deleted=False: {
            "id": str(session_id),
            "hub_id": "11111111-1111-1111-1111-111111111111",
            "title": "Assignment Help",
            "scope": "hub",
            "source_ids": ["src-1", "src-2"],
            "created_at": "2026-01-01T00:00:00Z",
            "last_message_at": "2026-01-01T00:00:01Z",
            "deleted_at": None,
        },
    )
    monkeypatch.setattr(store, "_update_chat_session_state", lambda session_id, **kwargs: None)
    monkeypatch.setattr(store, "_recent_conversation", lambda client, session_id: [])
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, session_id: [])
    monkeypatch.setattr(store, "_generate_chat_session_title", lambda first_message: "Assignment Help")


class FakeCompletion:
    def __init__(self, content: str) -> None:
        self.choices = [SimpleNamespace(message=SimpleNamespace(content=content))]
        self.usage = None


class FakeChatCompletions:
    def __init__(self, content: str) -> None:
        self._content = content

    def create(self, **kwargs) -> FakeCompletion:
        return FakeCompletion(self._content)


class RecordingChatCompletions:
    def __init__(self, content: str) -> None:
        self._content = content
        self.calls: list[dict] = []

    def create(self, **kwargs) -> FakeCompletion:
        self.calls.append(kwargs)
        return FakeCompletion(self._content)


class SequenceChatCompletions:
    def __init__(self, responses: list[object]) -> None:
        self._responses = list(responses)
        self.calls: list[dict] = []

    def create(self, **kwargs) -> FakeCompletion:
        self.calls.append(kwargs)
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return FakeCompletion(str(response))


class FakeChat:
    def __init__(self, completions) -> None:
        self.completions = completions


class FakeLLMClient:
    def __init__(self, content: str) -> None:
        self.chat = FakeChat(FakeChatCompletions(content))


class RecordingLLMClient:
    def __init__(self, content: str) -> None:
        self.chat = FakeChat(RecordingChatCompletions(content))


class SequenceLLMClient:
    def __init__(self, responses: list[object]) -> None:
        self.chat = FakeChat(SequenceChatCompletions(responses))


class FakeWebSearchResponse:
    def __init__(self, content: str) -> None:
        self.output_text = content
        self.output = [
            {
                "type": "web_search_call",
                "web_search_call": {
                    "results": [
                        {
                            "title": "Example",
                            "url": "https://example.com",
                            "snippet": "Example snippet",
                        }
                    ]
                },
            }
        ]
        self.usage = None


class FakeResponsesClient:
    def __init__(self, response: FakeWebSearchResponse) -> None:
        self._response = response

    def create(self, **kwargs) -> FakeWebSearchResponse:
        return self._response


class FakeLLMClientWithResponses:
    def __init__(self, response: FakeWebSearchResponse) -> None:
        self.responses = FakeResponsesClient(response)
        self.chat = FakeChat(FakeChatCompletions("Fallback"))


def _match(
    source_id: str = "src-1",
    snippet: str = "Snippet",
    similarity: float = 0.9,
    embedding: list[float] | None = None,
    chunk_index: int = 0,
) -> dict:
    row = {
        "source_id": source_id,
        "text": snippet,
        "chunk_index": chunk_index,
        "similarity": similarity,
    }
    if embedding is not None:
        row["embedding"] = embedding
    return row


def _retrieval_history() -> list[dict]:
    return [
        {"role": "user", "content": "What is lexical analysis?", "citations": []},
        {
            "role": "assistant",
            "content": "Lexical analysis turns a stream of characters into tokens. [1]",
            "citations": [
                Citation(
                    source_id="src-lex",
                    snippet="Lexical analysis takes a stream of characters and generates a stream of tokens.",
                    chunk_index=0,
                )
            ],
        },
    ]


def _mixed_retrieval_history() -> list[dict]:
    return [
        {
            "role": "user",
            "content": "Where should Caddie place optional interactive exercises during onboarding?",
            "citations": [],
        },
        {
            "role": "assistant",
            "content": "Optional exercises fit best in follow-up chat prompts and onboarding guides. [1] [2]",
            "citations": [
                Citation(
                    source_id="src-b",
                    snippet="Optional exercises should feel like a natural extension of onboarding.",
                    chunk_index=0,
                ),
                Citation(
                    source_id="src-c",
                    snippet="Follow-up chat prompts and guides are good places for interactive exercises.",
                    chunk_index=1,
                ),
            ],
        },
    ]


def _mixed_follow_up_history() -> list[dict]:
    return [
        {
            "role": "user",
            "content": "Where should Caddie place optional interactive exercises during onboarding?",
            "citations": [],
        },
        {
            "role": "assistant",
            "content": "Optional exercises fit best in follow-up chat prompts and onboarding guides. [1] [2]",
            "citations": [
                Citation(
                    source_id="src-b",
                    snippet="Optional exercises should feel like a natural extension of onboarding.",
                    chunk_index=0,
                ),
                Citation(
                    source_id="src-c",
                    snippet="Follow-up chat prompts and guides are good places for interactive exercises.",
                    chunk_index=1,
                ),
            ],
        },
        {
            "role": "user",
            "content": "How could a Haskell palindrome example fit into that?",
            "citations": [],
        },
        {
            "role": "assistant",
            "content": "A palindrome exercise could fit as an onboarding micro-exercise. [1] [2]",
            "citations": [
                Citation(
                    source_id="src-a",
                    snippet="Normalization matters for palindrome exercises.",
                    chunk_index=2,
                ),
                Citation(
                    source_id="src-b",
                    snippet="Keep exercises lightweight and contextual to onboarding.",
                    chunk_index=3,
                ),
            ],
        },
        {
            "role": "user",
            "content": "Why would normalization be a good exercise there?",
            "citations": [],
        },
    ]


def test_chat_returns_fallback_when_no_matches(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(store, "_match_chunks", lambda client, hub_id, embedding, top_k, source_ids=None: [])
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Hello! How can I help you today?"))

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="What is this?")
    result = store.chat(fake_client, "user-1", payload)

    assert result.answer == "Hello! How can I help you today?"
    assert result.citations == []


def test_chat_diversifies_citations_across_relevant_sources(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-a", snippet="A1", similarity=0.99, embedding=[1.0, 0.0], chunk_index=0),
            _match("src-a", snippet="A2", similarity=0.98, embedding=[0.99, 0.01], chunk_index=1),
            _match("src-b", snippet="B1", similarity=0.82, embedding=[0.2, 0.98], chunk_index=2),
            _match("src-c", snippet="C1", similarity=0.78, embedding=[0.0, 1.0], chunk_index=3),
        ],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1] [2] [3]"))

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="Compare the sources")
    result = store.chat(fake_client, "user-1", payload)

    assert len(result.citations) == 3
    assert len({citation.source_id for citation in result.citations}) >= 2


def test_chat_allows_single_source_when_only_one_source_is_relevant(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-a", snippet="A1", similarity=0.99, embedding=[1.0, 0.0], chunk_index=0),
            _match("src-a", snippet="A2", similarity=0.95, embedding=[0.99, 0.01], chunk_index=1),
            _match("src-a", snippet="A3", similarity=0.90, embedding=[0.97, 0.03], chunk_index=2),
            _match("src-a", snippet="A4", similarity=0.88, embedding=[0.96, 0.04], chunk_index=3),
        ],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1] [2] [3]"))

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="Stay on one source")
    result = store.chat(fake_client, "user-1", payload)

    assert len(result.citations) == 3
    assert {citation.source_id for citation in result.citations} == {"src-a"}


def test_chat_sparse_fallback_keeps_best_raw_match(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-low", snippet="Low relevance", similarity=0.25, embedding=[1.0, 0.0], chunk_index=0),
            _match("src-lower", snippet="Lower relevance", similarity=0.10, embedding=[0.0, 1.0], chunk_index=1),
        ],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1]"))

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="Edge case")
    result = store.chat(fake_client, "user-1", payload)

    assert [citation.source_id for citation in result.citations] == ["src-low"]


def test_chat_rewrites_vague_follow_up_using_recent_history_and_prior_citations(monkeypatch) -> None:
    fake_client = FakeClient()
    retrieval_history = _retrieval_history()
    rewrite_calls: list[tuple[str, list[dict]]] = []
    embedded_queries: list[str] = []

    monkeypatch.setattr(store, "_recent_conversation", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, session_id: retrieval_history)

    def fake_rewrite(question: str, history: list[dict]) -> str:
        rewrite_calls.append((question, history))
        return "Explain lexical analysis in more detail"

    monkeypatch.setattr(store, "_rewrite_query_for_retrieval", fake_rewrite)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [0.1])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-lex", snippet="Lexical analysis turns characters into tokens.")
        ],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("More detail [1]"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="tell me more",
        session_id="33333333-3333-3333-3333-333333333333",
    )
    result = store.chat(fake_client, "user-1", payload)

    assert rewrite_calls == [("tell me more", retrieval_history)]
    assert embedded_queries == ["Explain lexical analysis in more detail"]
    assert result.answer == "More detail [1]"
    assert [citation.source_id for citation in result.citations] == ["src-lex"]


def test_detects_longer_deictic_follow_up_questions() -> None:
    assert _is_vague_follow_up("How could a Haskell palindrome example fit into that?")
    assert _is_vague_follow_up("Why would normalization be a good exercise there?")
    assert not _is_vague_follow_up("How does this function work in Haskell?")


def test_chat_session_title_normalization_and_fallback() -> None:
    assert _normalize_chat_session_title('Title: "Assignment Help"') == "Assignment Help"
    assert _normalize_chat_session_title("How do I submit assignments for this module today") == "How do I submit assignments"
    assert _fallback_chat_session_title("  How\n\n do   I submit assignments?  ") == "How do I submit assignments?"


def test_normalized_source_ids_follow_complete_source_order() -> None:
    assert store._normalize_source_ids_to_complete_order(
        ["src-3", "src-1"],
        ["src-1", "src-2", "src-3"],
    ) == ["src-1", "src-3"]


def test_normalize_chat_source_ids_uses_all_complete_sources_when_omitted(monkeypatch) -> None:
    monkeypatch.setattr(store, "_complete_source_ids_for_hub", lambda client, hub_id: ["src-2", "src-1"])

    persisted_source_ids, retrieval_source_ids = type(store)._normalize_chat_source_ids(
        store,
        FakeClient(),
        "hub-1",
        None,
    )

    assert persisted_source_ids == ["src-2", "src-1"]
    assert retrieval_source_ids is None


def test_normalize_chat_source_ids_preserves_explicit_empty_selection(monkeypatch) -> None:
    monkeypatch.setattr(store, "_complete_source_ids_for_hub", lambda client, hub_id: ["src-2", "src-1"])

    persisted_source_ids, retrieval_source_ids = type(store)._normalize_chat_source_ids(
        store,
        FakeClient(),
        "hub-1",
        [],
    )

    assert persisted_source_ids == []
    assert retrieval_source_ids == []


def test_chat_draft_failure_does_not_persist_session(monkeypatch) -> None:
    fake_client = FakeClient()
    helper_calls: list[dict] = []
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(store, "_match_chunks", lambda client, hub_id, embedding, top_k, source_ids=None: [])
    monkeypatch.setattr(store, "llm_client", SequenceLLMClient([RuntimeError("chat failed")]))
    monkeypatch.setattr(store, "_create_chat_session_with_messages", lambda **kwargs: helper_calls.append(kwargs))

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="What is this?")

    with pytest.raises(RuntimeError, match="chat failed"):
        store.chat(fake_client, "user-1", payload)

    assert helper_calls == []
    assert fake_client.inserted == {}


def test_chat_persists_new_session_after_first_successful_send(monkeypatch) -> None:
    fake_client = FakeClient()
    persisted: dict[str, object] = {}
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(store, "_match_chunks", lambda client, hub_id, embedding, top_k, source_ids=None: [])
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Hello! How can I help you today?"))

    def fake_create_chat_session_with_messages(**kwargs):
        persisted.update(kwargs)
        return {
            "session_id": "session-42",
            "session_title": kwargs["title"],
            "session_created_at": "2026-01-01T00:00:00Z",
            "assistant_message_id": "message-42",
            "assistant_created_at": "2026-01-01T00:00:01Z",
        }

    monkeypatch.setattr(store, "_create_chat_session_with_messages", fake_create_chat_session_with_messages)

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="What is this?")
    result = store.chat(fake_client, "user-1", payload)

    assert result.session_id == "session-42"
    assert result.message_id == "message-42"
    assert persisted["user_content"] == "What is this?"
    assert persisted["assistant_content"] == "Hello! How can I help you today?"
    assert persisted["source_ids"] == ["src-1", "src-2"]
    assert fake_client.inserted == {}


def test_anchor_selection_skips_context_dependent_turns() -> None:
    assert (
        _most_recent_informative_user_turn(_mixed_follow_up_history())
        == "Where should Caddie place optional interactive exercises during onboarding?"
    )


def test_chat_rewrites_longer_deictic_follow_up_using_recent_history(monkeypatch) -> None:
    fake_client = FakeClient()
    retrieval_history = _mixed_follow_up_history()
    rewrite_calls: list[tuple[str, list[dict]]] = []
    embedded_queries: list[str] = []

    monkeypatch.setattr(store, "_recent_conversation", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, session_id: retrieval_history)

    def fake_rewrite(question: str, history: list[dict]) -> str:
        rewrite_calls.append((question, history))
        return "Why would incorporating normalization as an exercise in the Haskell palindrome example enhance onboarding?"

    monkeypatch.setattr(store, "_rewrite_query_for_retrieval", fake_rewrite)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [0.1])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-a", snippet="Normalization matters for palindrome exercises.")
        ],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1]"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="Why would normalization be a good exercise there?",
        session_id="33333333-3333-3333-3333-333333333333",
    )
    result = store.chat(fake_client, "user-1", payload)

    assert rewrite_calls == [("Why would normalization be a good exercise there?", retrieval_history)]
    assert embedded_queries[0] == "Why would incorporating normalization as an exercise in the Haskell palindrome example enhance onboarding?"
    assert result.answer == "Answer [1]"


def test_chat_anchors_vague_follow_up_when_mixed_history_collapses_to_one_source(monkeypatch) -> None:
    fake_client = FakeClient()
    retrieval_history = _mixed_follow_up_history()
    embedded_queries: list[str] = []
    rewritten_query = "Why would incorporating normalization as an exercise in the Haskell palindrome example enhance the onboarding experience?"
    anchored_query = (
        "Where should Caddie place optional interactive exercises during onboarding? "
        "Why would incorporating normalization as an exercise in the Haskell palindrome example enhance the onboarding experience?"
    )

    monkeypatch.setattr(store, "_recent_conversation", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_rewrite_query_for_retrieval", lambda question, history: rewritten_query)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [len(embedded_queries), 0.0])

    def fake_match_chunks(client, hub_id, embedding, top_k, source_ids=None):
        query_text = embedded_queries[-1]
        if query_text == rewritten_query:
            return [
                _match("src-a", snippet="Normalization matters for palindrome exercises.", similarity=0.97),
                _match("src-a", snippet="A palindrome task can illustrate normalization.", similarity=0.94, chunk_index=1),
            ]
        if query_text == anchored_query:
            return [
                _match("src-a", snippet="Normalization matters for palindrome exercises.", similarity=0.97),
                _match("src-b", snippet="Optional exercises should feel native to onboarding.", similarity=0.88, chunk_index=1),
                _match("src-c", snippet="Follow-up chat prompts are a good place for short exercises.", similarity=0.84, chunk_index=2),
            ]
        return []

    monkeypatch.setattr(store, "_match_chunks", fake_match_chunks)
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1] [2]"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="tell me more",
        session_id="33333333-3333-3333-3333-333333333333",
    )
    result = store.chat(fake_client, "user-1", payload)

    assert embedded_queries == [rewritten_query, anchored_query]
    assert len({citation.source_id for citation in result.citations}) >= 2


def test_chat_does_not_anchor_follow_up_when_recent_history_is_single_source(monkeypatch) -> None:
    fake_client = FakeClient()
    retrieval_history = _retrieval_history()
    embedded_queries: list[str] = []
    rewritten_query = "Explain lexical analysis in more detail"

    monkeypatch.setattr(store, "_recent_conversation", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_rewrite_query_for_retrieval", lambda question, history: rewritten_query)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [0.1])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-lex", snippet="Lexical analysis turns characters into tokens.")
        ],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1]"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="tell me more",
        session_id="33333333-3333-3333-3333-333333333333",
    )
    result = store.chat(fake_client, "user-1", payload)

    assert embedded_queries == [rewritten_query]
    assert [citation.source_id for citation in result.citations] == ["src-lex"]


def test_chat_keeps_initial_retrieval_when_anchored_fallback_does_not_improve_diversity(monkeypatch) -> None:
    fake_client = FakeClient()
    retrieval_history = _mixed_follow_up_history()
    embedded_queries: list[str] = []
    rewritten_query = "Why would incorporating normalization as an exercise in the Haskell palindrome example enhance the onboarding experience?"
    anchored_query = (
        "Where should Caddie place optional interactive exercises during onboarding? "
        "Why would incorporating normalization as an exercise in the Haskell palindrome example enhance the onboarding experience?"
    )

    monkeypatch.setattr(store, "_recent_conversation", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_rewrite_query_for_retrieval", lambda question, history: rewritten_query)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [len(embedded_queries), 0.0])

    def fake_match_chunks(client, hub_id, embedding, top_k, source_ids=None):
        query_text = embedded_queries[-1]
        if query_text == rewritten_query:
            return [_match("src-a", snippet="Initial palindrome context.", similarity=0.97)]
        if query_text == anchored_query:
            return [_match("src-a", snippet="Fallback palindrome context.", similarity=0.96)]
        return []

    monkeypatch.setattr(store, "_match_chunks", fake_match_chunks)
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1]"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="tell me more",
        session_id="33333333-3333-3333-3333-333333333333",
    )
    result = store.chat(fake_client, "user-1", payload)

    assert embedded_queries == [rewritten_query, anchored_query]
    assert [citation.snippet for citation in result.citations] == ["Initial palindrome context."]

def test_chat_does_not_rewrite_clear_standalone_question(monkeypatch) -> None:
    fake_client = FakeClient()
    embedded_queries: list[str] = []
    rewrite_calls: list[str] = []
    retrieval_history = _retrieval_history()
    question = "How many assignments are there in CSC1098?"

    monkeypatch.setattr(store, "_recent_conversation", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, session_id: retrieval_history)

    def fake_rewrite(question_text: str, history: list[dict]) -> str:
        rewrite_calls.append(question_text)
        return "unused rewrite"

    monkeypatch.setattr(store, "_rewrite_query_for_retrieval", fake_rewrite)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [0.1])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [_match()],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1]"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question=question,
        session_id="33333333-3333-3333-3333-333333333333",
    )
    result = store.chat(fake_client, "user-1", payload)

    assert rewrite_calls == []
    assert embedded_queries == [question]
    assert result.answer == "Answer [1]"


def test_chat_retries_with_rewrite_after_initial_no_match(monkeypatch) -> None:
    fake_client = FakeClient()
    retrieval_history = _retrieval_history()
    embedded_queries: list[str] = []
    match_calls: list[str] = []
    rewrite_calls: list[str] = []

    monkeypatch.setattr(store, "_recent_conversation", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, session_id: retrieval_history)

    def fake_rewrite(question: str, history: list[dict]) -> str:
        rewrite_calls.append(question)
        return "How many assignments are there in CSC1098?"

    def fake_match_chunks(client, hub_id, embedding, top_k, source_ids=None):
        match_calls.append(str(embedding[0]))
        if len(match_calls) == 1:
            return []
        return [_match("src-2", snippet="The module has two assignments worth 15% each.")]

    monkeypatch.setattr(store, "_rewrite_query_for_retrieval", fake_rewrite)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [len(embedded_queries)])
    monkeypatch.setattr(store, "_match_chunks", fake_match_chunks)
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("There are two assignments. [1]"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="How many assignments are in the module?",
        session_id="33333333-3333-3333-3333-333333333333",
    )
    result = store.chat(fake_client, "user-1", payload)

    assert rewrite_calls == ["How many assignments are in the module?"]
    assert embedded_queries == [
        "How many assignments are in the module?",
        "How many assignments are there in CSC1098?",
    ]
    assert len(match_calls) == 2
    assert [citation.source_id for citation in result.citations] == ["src-2"]


def test_chat_preserves_source_filters_when_rewriting(monkeypatch) -> None:
    fake_client = FakeClient()
    retrieval_history = _retrieval_history()
    received_source_ids: list[list[str] | None] = []

    monkeypatch.setattr(store, "_recent_conversation", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(
        store,
        "_rewrite_query_for_retrieval",
        lambda question, history: "How many assignments are there in CSC1098?",
    )
    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])

    def fake_match(client, hub_id, embedding, top_k, source_ids=None):
        received_source_ids.append(source_ids)
        if len(received_source_ids) == 1:
            return []
        return [_match("src-2", snippet="The module has two assignments worth 15% each.")]

    monkeypatch.setattr(store, "_match_chunks", fake_match)
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("There are two assignments. [1]"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="How many assignments are in the module?",
        source_ids=["22222222-2222-2222-2222-222222222222"],
        session_id="33333333-3333-3333-3333-333333333333",
    )
    store.chat(fake_client, "user-1", payload)

    assert received_source_ids == [
        ["22222222-2222-2222-2222-222222222222"],
        ["22222222-2222-2222-2222-222222222222"],
    ]


def test_chat_falls_back_cleanly_when_rewrite_fails(monkeypatch) -> None:
    fake_client = FakeClient()
    retrieval_history = _retrieval_history()
    embedded_queries: list[str] = []
    llm_client = SequenceLLMClient([RuntimeError("rewrite failed"), "Hello! How can I help you today?"])

    monkeypatch.setattr(store, "_recent_conversation", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [0.1])
    monkeypatch.setattr(store, "_match_chunks", lambda client, hub_id, embedding, top_k, source_ids=None: [])
    monkeypatch.setattr(store, "llm_client", llm_client)

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="tell me more",
        session_id="33333333-3333-3333-3333-333333333333",
    )
    result = store.chat(fake_client, "user-1", payload)

    assert embedded_queries == ["tell me more"]
    assert result.answer == "Hello! How can I help you today?"
    assert result.citations == []


def test_chat_uses_recent_citation_snippets_in_rewrite_context(monkeypatch) -> None:
    llm_client = RecordingLLMClient("Explain lexical analysis in more detail")
    monkeypatch.setattr(store, "llm_client", llm_client)

    rewritten = store._rewrite_query_for_retrieval("tell me more", _retrieval_history())

    assert rewritten == "Explain lexical analysis in more detail"
    assert len(llm_client.chat.completions.calls) == 1
    system_prompt = llm_client.chat.completions.calls[0]["messages"][0]["content"]
    prompt = llm_client.chat.completions.calls[0]["messages"][1]["content"]
    assert "Preserve all active facets from recent turns" in system_prompt
    assert "keep both the concept being discussed and the application, product, or workflow context" in system_prompt
    assert "Recent conversation:" in prompt
    assert "Recent cited snippets:" in prompt
    assert "Lexical analysis turns a stream of characters into tokens. [1]" in prompt
    assert "Lexical analysis takes a stream of characters and generates a stream of tokens." in prompt
    assert llm_client.chat.completions.calls[0]["temperature"] == 0


def test_chat_global_uses_web_search(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(store, "_match_chunks", lambda client, hub_id, embedding, top_k, source_ids=None: [])
    response = FakeWebSearchResponse("Global answer [1]")
    monkeypatch.setattr(store, "llm_client", FakeLLMClientWithResponses(response))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        scope=HubScope.global_scope,
        question="What is this?",
    )
    result = store.chat(fake_client, "user-1", payload)

    assert result.answer == "Global answer [1]"
    assert result.citations
    assert result.citations[0].source_id == "https://example.com"


def test_global_scope_also_benefits_from_rewritten_hub_retrieval(monkeypatch) -> None:
    fake_client = FakeClient()
    retrieval_history = _retrieval_history()
    embedded_queries: list[str] = []

    monkeypatch.setattr(store, "_recent_conversation", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, session_id: retrieval_history)
    monkeypatch.setattr(
        store,
        "_rewrite_query_for_retrieval",
        lambda question, history: "Explain lexical analysis in more detail",
    )
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [0.1])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-lex", snippet="Lexical analysis turns characters into tokens.")
        ],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClientWithResponses(FakeWebSearchResponse("Global answer [1]")))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        scope=HubScope.global_scope,
        question="tell me more",
        session_id="33333333-3333-3333-3333-333333333333",
    )
    result = store.chat(fake_client, "user-1", payload)

    assert embedded_queries == ["Explain lexical analysis in more detail"]
    assert result.answer == "Global answer [1]"
    assert result.citations


def test_chat_filters_by_selected_sources(monkeypatch) -> None:
    fake_client = FakeClient()
    captured: dict[str, list[str] | None] = {}

    def fake_match(client, hub_id, embedding, top_k, source_ids=None):
        captured["source_ids"] = source_ids
        return []

    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(store, "_match_chunks", fake_match)
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Hello!"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="What is this?",
        source_ids=["22222222-2222-2222-2222-222222222222"],
    )
    store.chat(fake_client, "user-1", payload)

    assert captured["source_ids"] == ["22222222-2222-2222-2222-222222222222"]


def test_rename_chat_session_rejects_non_owner(monkeypatch) -> None:
    monkeypatch.setattr(
        store,
        "_get_chat_session_row",
        lambda client, session_id, include_deleted=False: {
            "id": str(session_id),
            "hub_id": "hub-1",
            "created_by": "someone-else",
            "deleted_at": None,
        },
    )

    with pytest.raises(PermissionError, match="Only the chat creator can modify this session."):
        store.rename_chat_session(object(), "user-1", "session-1", "Updated title")


def test_delete_chat_session_rejects_non_owner(monkeypatch) -> None:
    monkeypatch.setattr(
        store,
        "_get_chat_session_row",
        lambda client, session_id, include_deleted=False: {
            "id": str(session_id),
            "hub_id": "hub-1",
            "created_by": "someone-else",
            "deleted_at": None,
        },
    )

    with pytest.raises(PermissionError, match="Only the chat creator can modify this session."):
        store.delete_chat_session(object(), "user-1", "session-1")


def test_chat_caps_citations_at_three_and_stores_selected_order(monkeypatch) -> None:
    fake_client = FakeClient()
    persisted: dict[str, object] = {}
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-a", snippet="A1", similarity=0.99, embedding=[1.0, 0.0], chunk_index=0),
            _match("src-b", snippet="B1", similarity=0.87, embedding=[0.4, 0.92], chunk_index=1),
            _match("src-c", snippet="C1", similarity=0.82, embedding=[0.0, 1.0], chunk_index=2),
            _match("src-d", snippet="D1", similarity=0.80, embedding=[-0.2, 0.98], chunk_index=3),
        ],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1] [2] [3]"))
    monkeypatch.setattr(
        store,
        "_create_chat_session_with_messages",
        lambda **kwargs: persisted.update(kwargs) or {
            "session_id": "session-1",
            "session_title": kwargs["title"],
            "session_created_at": "2026-01-01T00:00:00Z",
            "assistant_message_id": "message-1",
            "assistant_created_at": "2026-01-01T00:00:01Z",
        },
    )

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="Limit citations")
    result = store.chat(fake_client, "user-1", payload)

    assert len(result.citations) == 3
    assert [citation.source_id for citation in persisted["assistant_citations"]] == [
        citation.source_id for citation in result.citations
    ]


def test_chat_ignores_malformed_quote_keys_but_keeps_valid_quote_metadata(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(store, "_embed_query", lambda text: [1.0, 0.0])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match(
                "src-a",
                snippet="Coursework submissions go through Moodle for this module.",
                similarity=0.99,
                chunk_index=0,
            ),
        ],
    )
    monkeypatch.setattr(
        store,
        "llm_client",
        FakeLLMClient(
            'Submit through Moodle. [1]\n'
            'QUOTES: {"source_1": [{"paraphrase": "ignored", "quote": "bad key"}], '
            '" 1 ": [{"paraphrase": "Use Moodle for submissions.", "quote": "submissions go through Moodle"}]}'
        ),
    )

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="How do I submit coursework?")
    result = store.chat(fake_client, "user-1", payload)

    assert result.answer == "Submit through Moodle. [1]"
    assert len(result.citations) == 1
    assert result.citations[0].relevant_quotes == ["submissions go through Moodle"]
    assert result.citations[0].paraphrased_quotes == ["Use Moodle for submissions."]
