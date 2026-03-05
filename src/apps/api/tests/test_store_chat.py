"""Unit tests for store.chat with stubbed clients and match results."""

from types import SimpleNamespace

from app.schemas import ChatRequest, HubScope
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


class FakeChat:
    def __init__(self, content: str) -> None:
        self.completions = FakeChatCompletions(content)


class FakeLLMClient:
    def __init__(self, content: str) -> None:
        self.chat = FakeChat(content)


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
        self.chat = FakeChat("Fallback")


def test_chat_returns_fallback_when_no_matches(monkeypatch) -> None:
    # Forces empty matches; expect an uncited conversational response.
    fake_client = FakeClient()
    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])
    monkeypatch.setattr(store, "_match_chunks", lambda client, hub_id, embedding, top_k, source_ids=None: [])
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Hello! How can I help you today?"))

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="What is this?")
    result = store.chat(fake_client, "user-1", payload)

    assert result.answer == "Hello! How can I help you today?"
    assert result.citations == []


def test_chat_includes_citations_when_matches(monkeypatch) -> None:
    # Provides a match and fake LLM; expect citations and stored messages.
    fake_client = FakeClient()
    monkeypatch.setattr(store, "_embed_query", lambda text: [0.1])
    monkeypatch.setattr(
        store,
        "_match_chunks",
        lambda client, hub_id, embedding, top_k, source_ids=None: [
            {"source_id": "src-1", "text": "Snippet", "chunk_index": 0, "similarity": 0.9}
        ],
    )
    monkeypatch.setattr(store, "llm_client", FakeLLMClient("Answer [1]"))

    payload = ChatRequest(hub_id="11111111-1111-1111-1111-111111111111", question="What is this?")
    result = store.chat(fake_client, "user-1", payload)

    assert result.answer == "Answer [1]"
    assert len(result.citations) == 1
    assert result.citations[0].source_id == "src-1"
    assert len(fake_client.inserted.get("messages", [])) == 2


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
