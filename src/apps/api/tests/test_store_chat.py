"""Unit tests for store.chat with stubbed clients and match results."""

from types import SimpleNamespace

from app.schemas import ChatRequest, Citation, HubScope
from app.services.store import store


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
            return FakeResponse([{"id": "session-1"}])
        if self.name == "messages":
            self.client.message_count += 1
            return FakeResponse([{"id": f"message-{self.client.message_count}"}])
        return FakeResponse([{}])


class FakeClient:
    def __init__(self) -> None:
        self.message_count = 0
        self.inserted: dict[str, list[dict]] = {}

    def table(self, name: str) -> FakeTable:
        return FakeTable(self, name)


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


def _match(source_id: str = "src-1", snippet: str = "Snippet", similarity: float = 0.9) -> dict:
    return {
        "source_id": source_id,
        "text": snippet,
        "chunk_index": 0,
        "similarity": similarity,
    }


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


def test_chat_returns_fallback_when_no_matches(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])
    monkeypatch.setattr(store, "_match_chunks", lambda client, hub_id, embedding, top_k, source_ids=None: [])
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Hello! How can I help you today?"))

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="What is this?")
    result = store.chat(fake_client, "user-1", payload)

    assert result.answer == "Hello! How can I help you today?"
    assert result.citations == []


def test_chat_includes_citations_when_matches(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])
    monkeypatch.setattr(store, "_match_chunks", lambda client, hub_id, embedding, top_k, source_ids=None: [_match()])
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1]"))

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="What is this?")
    result = store.chat(fake_client, "user-1", payload)

    assert result.answer == "Answer [1]"
    assert len(result.citations) == 1
    assert result.citations[0].source_id == "src-1"
    assert len(fake_client.inserted.get("messages", [])) == 2


def test_chat_rewrites_vague_follow_up_using_recent_history_and_prior_citations(monkeypatch) -> None:
    fake_client = FakeClient()
    retrieval_history = _retrieval_history()
    rewrite_calls: list[tuple[str, list[dict]]] = []
    embedded_queries: list[str] = []

    monkeypatch.setattr(store, "_recent_conversation", lambda client, user_id, hub_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, user_id, hub_id: retrieval_history)

    def fake_rewrite(question: str, history: list[dict]) -> str:
        rewrite_calls.append((question, history))
        return "Explain lexical analysis in more detail"

    monkeypatch.setattr(store, "_rewrite_query_for_retrieval", fake_rewrite)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [0.1])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            _match("src-lex", "Lexical analysis turns characters into tokens.")
        ],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("More detail [1]"))

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="tell me more")
    result = store.chat(fake_client, "user-1", payload)

    assert rewrite_calls == [("tell me more", retrieval_history)]
    assert embedded_queries == ["Explain lexical analysis in more detail"]
    assert result.answer == "More detail [1]"
    assert [citation.source_id for citation in result.citations] == ["src-lex"]


def test_chat_does_not_rewrite_clear_standalone_question(monkeypatch) -> None:
    fake_client = FakeClient()
    embedded_queries: list[str] = []
    rewrite_calls: list[str] = []
    retrieval_history = _retrieval_history()
    question = "How many assignments are there in CSC1098?"

    monkeypatch.setattr(store, "_recent_conversation", lambda client, user_id, hub_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, user_id, hub_id: retrieval_history)

    def fake_rewrite(question_text: str, history: list[dict]) -> str:
        rewrite_calls.append(question_text)
        return "unused rewrite"

    monkeypatch.setattr(store, "_rewrite_query_for_retrieval", fake_rewrite)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [0.1])
    monkeypatch.setattr(store, "_match_chunks", lambda client, hub_id, embedding, top_k, source_ids=None: [_match()])
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1]"))

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question=question)
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

    monkeypatch.setattr(store, "_recent_conversation", lambda client, user_id, hub_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, user_id, hub_id: retrieval_history)

    def fake_rewrite(question: str, history: list[dict]) -> str:
        rewrite_calls.append(question)
        return "How many assignments are there in CSC1098?"

    def fake_match_chunks(client, hub_id, embedding, top_k, source_ids=None):
        match_calls.append(str(embedding[0]))
        if len(match_calls) == 1:
            return []
        return [_match("src-2", "The module has two assignments worth 15% each.")]

    monkeypatch.setattr(store, "_rewrite_query_for_retrieval", fake_rewrite)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [len(embedded_queries)])
    monkeypatch.setattr(store, "_match_chunks", fake_match_chunks)
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("There are two assignments. [1]"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="How many assignments are in the module?",
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

    monkeypatch.setattr(store, "_recent_conversation", lambda client, user_id, hub_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, user_id, hub_id: retrieval_history)
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
        return [_match("src-2", "The module has two assignments worth 15% each.")]

    monkeypatch.setattr(store, "_match_chunks", fake_match)
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("There are two assignments. [1]"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="How many assignments are in the module?",
        source_ids=["22222222-2222-2222-2222-222222222222"],
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

    monkeypatch.setattr(store, "_recent_conversation", lambda client, user_id, hub_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, user_id, hub_id: retrieval_history)
    monkeypatch.setattr(store, "_embed_query", lambda text: embedded_queries.append(text) or [0.1])
    monkeypatch.setattr(store, "_match_chunks", lambda client, hub_id, embedding, top_k, source_ids=None: [])
    monkeypatch.setattr(store, "llm_client", llm_client)

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="tell me more")
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
    prompt = llm_client.chat.completions.calls[0]["messages"][1]["content"]
    assert "Recent conversation:" in prompt
    assert "Recent cited snippets:" in prompt
    assert "Lexical analysis turns a stream of characters into tokens. [1]" in prompt
    assert "Lexical analysis takes a stream of characters and generates a stream of tokens." in prompt
    assert llm_client.chat.completions.calls[0]["temperature"] == 0


def test_chat_global_uses_web_search(monkeypatch) -> None:
    fake_client = FakeClient()
    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])
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

    monkeypatch.setattr(store, "_recent_conversation", lambda client, user_id, hub_id: retrieval_history)
    monkeypatch.setattr(store, "_recent_retrieval_context", lambda client, user_id, hub_id: retrieval_history)
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
            _match("src-lex", "Lexical analysis turns characters into tokens.")
        ],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClientWithResponses(FakeWebSearchResponse("Global answer [1]")))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        scope=HubScope.global_scope,
        question="tell me more",
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

    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])
    monkeypatch.setattr(store, "_match_chunks", fake_match)
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Hello!"))

    payload = ChatRequest(
        hub_id="11111111-1111-1111-1111-111111111111",
        question="What is this?",
        source_ids=["22222222-2222-2222-2222-222222222222"],
    )
    store.chat(fake_client, "user-1", payload)

    assert captured["source_ids"] == ["22222222-2222-2222-2222-222222222222"]
