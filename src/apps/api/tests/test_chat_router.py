"""Router tests for chat endpoint with mocked rate limiting and store calls."""

from app.routers import chat as chat_router
from app.schemas import ChatResponse, Citation
from app.services import rate_limit as rate_limit_module
from app.services import store as store_module


def test_chat_rate_limited(client, monkeypatch) -> None:
    # Forces rate limit failure; expect 429 response from /chat.
    rl = rate_limit_module.RateLimitResult(allowed=False, remaining=0, reset_in_seconds=10)
    monkeypatch.setattr(chat_router.rate_limiter, "check", lambda key, limit: rl)

    resp = client.post("/chat", json={"hub_id": "hub-1", "question": "Hi"})
    assert resp.status_code == 429


def test_chat_success(client, monkeypatch) -> None:
    # Mocks chat response; expect 200 with answer and citations.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setattr(chat_router.rate_limiter, "check", lambda key, limit: rl)

    response = ChatResponse(
        answer="Answer",
        citations=[Citation(source_id="src-1", snippet="Snippet", chunk_index=0)],
        message_id="msg-1",
    )
    monkeypatch.setattr(store_module.store, "chat", lambda _client, user_id, payload: response)

    resp = client.post("/chat", json={"hub_id": "hub-1", "question": "Hi"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["answer"] == "Answer"
