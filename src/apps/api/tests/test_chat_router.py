"""Router tests for chat endpoints with mocked rate limiting and store calls."""

from datetime import datetime

from app.dependencies import get_rate_limiter
from app.main import app
from app.schemas import (
    ChatEventType,
    ChatResponse,
    ChatSearchResult,
    ChatSessionDetail,
    ChatSessionSummary,
    ChatFeedbackRating,
    Citation,
    CitationFeedbackEventType,
    HubMember,
    MembershipRole,
    SessionMessage,
)
from app.services import rate_limit as rate_limit_module
from app.services import store as store_module


# Test rate limiter that always returns the same result.
# Test helpers and fixtures.
class FixedRateLimiter:

    # Initializes the test helper state used by this class.
    def __init__(self, result: rate_limit_module.RateLimitResult) -> None:
        self.result = result

    # Returns the configured rate-limit result for each check.
    def check(self, key: str, limit: int, window_seconds: int = 60) -> rate_limit_module.RateLimitResult:
        return self.result


# Builds a hub member record used by membership-related tests.
def _member(*, accepted: bool) -> HubMember:
    return HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="user-1",
        role=MembershipRole.viewer,
        invited_at=datetime.utcnow(),
        accepted_at=datetime.utcnow() if accepted else None,
    )


# Verifies that chat rate limited.
# Endpoint behavior tests.
def test_chat_rate_limited(client, monkeypatch) -> None:

    # Forces rate limit failure; expect 429 response from /chat.
    rl = rate_limit_module.RateLimitResult(allowed=False, remaining=0, reset_in_seconds=10)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    resp = client.post("/chat", json={"hub_id": "11111111-1111-1111-1111-111111111111", "question": "Hi"})
    assert resp.status_code == 429
    assert resp.headers["X-RateLimit-Limit"] == "20"
    assert resp.headers["Retry-After"] == "10"


# Verifies that list chat sessions rate limited.
def test_list_chat_sessions_rate_limited(client, monkeypatch) -> None:
    rl = rate_limit_module.RateLimitResult(allowed=False, remaining=0, reset_in_seconds=10)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    resp = client.get("/chat/sessions", params={"hub_id": "11111111-1111-1111-1111-111111111111"})

    assert resp.status_code == 429
    assert resp.headers["X-RateLimit-Limit"] == "120"
    assert resp.headers["Retry-After"] == "10"


# Verifies that delete chat session rate limited.
def test_delete_chat_session_rate_limited(client, monkeypatch) -> None:
    rl = rate_limit_module.RateLimitResult(allowed=False, remaining=0, reset_in_seconds=10)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    resp = client.delete("/chat/sessions/11111111-1111-1111-1111-111111111111")

    assert resp.status_code == 429
    assert resp.headers["X-RateLimit-Limit"] == "60"
    assert resp.headers["Retry-After"] == "10"


# Verifies that chat success.
def test_chat_success(client, monkeypatch) -> None:
    # Mocks chat response; expect 200 with answer and citations.
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    response = ChatResponse(
        answer="Answer",
        citations=[Citation(source_id="src-1", snippet="Snippet", chunk_index=0)],
        message_id="msg-1",
        session_id="session-1",
        session_title="Assignment Help",
    )
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=True))
    monkeypatch.setattr(store_module.store, "chat", lambda _client, user_id, payload: response)

    resp = client.post("/chat", json={"hub_id": "11111111-1111-1111-1111-111111111111", "question": "Hi"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["answer"] == "Answer"


# Verifies that chat prompt suggestion success.
def test_chat_prompt_suggestion_success(client, monkeypatch) -> None:
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=True))
    monkeypatch.setattr(
        store_module.store,
        "suggest_chat_prompt",
        lambda _client, hub_id, source_ids=None: "What deadlines matter most here?",
    )

    resp = client.get("/chat/prompt-suggestion", params={"hub_id": "11111111-1111-1111-1111-111111111111"})

    assert resp.status_code == 200
    assert resp.json() == {"prompt": "What deadlines matter most here?"}


# Verifies that submit chat feedback.
def test_submit_chat_feedback(client, monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "create_chat_feedback",
        lambda _client, user_id, message_id, payload: {
            "message_id": message_id,
            "rating": payload.rating,
            "reason": payload.reason,
            "updated_at": "2026-01-01T00:00:00Z",
        },
    )

    resp = client.post(
        "/chat/messages/11111111-1111-1111-1111-111111111111/feedback",
        json={"rating": ChatFeedbackRating.helpful.value},
    )

    assert resp.status_code == 200
    assert resp.json()["rating"] == ChatFeedbackRating.helpful.value


# Verifies that submit citation feedback.
def test_submit_citation_feedback(client, monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "create_citation_feedback",
        lambda _client, user_id, message_id, payload: {
            "message_id": message_id,
            "source_id": payload.source_id,
            "chunk_index": payload.chunk_index,
            "event_type": payload.event_type,
            "created_at": "2026-01-01T00:00:00Z",
        },
    )

    resp = client.post(
        "/chat/messages/11111111-1111-1111-1111-111111111111/citations/feedback",
        json={"source_id": "src-1", "chunk_index": 0, "event_type": CitationFeedbackEventType.opened.value},
    )

    assert resp.status_code == 200
    assert resp.json()["event_type"] == CitationFeedbackEventType.opened.value


# Verifies that create chat event.
def test_create_chat_event(client, monkeypatch) -> None:
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=True))
    monkeypatch.setattr(
        store_module.store,
        "create_chat_event",
        lambda _client, user_id, payload: {
            "event_type": payload.event_type,
            "created_at": "2026-01-01T00:00:00Z",
        },
    )

    resp = client.post(
        "/chat/events",
        json={
            "hub_id": "11111111-1111-1111-1111-111111111111",
            "event_type": ChatEventType.answer_copied.value,
            "metadata": {"answer_length": 42},
        },
    )

    assert resp.status_code == 200
    assert resp.json()["event_type"] == ChatEventType.answer_copied.value


# Verifies that chat accepts source ids.
def test_chat_accepts_source_ids(client, monkeypatch) -> None:
    rl = rate_limit_module.RateLimitResult(allowed=True, remaining=1, reset_in_seconds=60)
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: FixedRateLimiter(rl))

    response = ChatResponse(
        answer="Answer",
        citations=[],
        message_id="msg-2",
        session_id="session-2",
        session_title="Assignment Help",
    )
    captured = {}

    # Helper used by the surrounding test code.
    def fake_chat(_client, user_id, payload):
        captured["source_ids"] = payload.source_ids
        return response

    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=True))
    monkeypatch.setattr(store_module.store, "chat", fake_chat)

    payload = {
        "hub_id": "11111111-1111-1111-1111-111111111111",
        "question": "Hi",
        "source_ids": ["22222222-2222-2222-2222-222222222222"],
    }
    resp = client.post("/chat", json=payload)
    assert resp.status_code == 200
    assert [str(value) for value in captured["source_ids"]] == ["22222222-2222-2222-2222-222222222222"]


# Verifies that chat rejects unaccepted invite.
def test_chat_rejects_unaccepted_invite(client, monkeypatch) -> None:
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=False))

    resp = client.post("/chat", json={"hub_id": "11111111-1111-1111-1111-111111111111", "question": "Hi"})

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Invite not accepted yet."


# Verifies that list chat sessions.
def test_list_chat_sessions(client, monkeypatch) -> None:
    response = [
        ChatSessionSummary(
            id="session-1",
            hub_id="11111111-1111-1111-1111-111111111111",
            title="How do I submit assignments?",
            scope="hub",
            source_ids=["src-1"],
            created_at="2026-01-01T00:00:00Z",
            last_message_at="2026-01-01T00:05:00Z",
        )
    ]
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=True))
    monkeypatch.setattr(store_module.store, "list_chat_sessions", lambda _client, user_id, hub_id: response)

    resp = client.get("/chat/sessions", params={"hub_id": "11111111-1111-1111-1111-111111111111"})
    assert resp.status_code == 200
    assert resp.headers["X-RateLimit-Limit"] == "120"
    data = resp.json()
    assert data[0]["id"] == "session-1"
    assert data[0]["title"] == "How do I submit assignments?"


# Verifies that get chat session messages.
def test_get_chat_session_messages(client, monkeypatch) -> None:
    response = ChatSessionDetail(
        session=ChatSessionSummary(
            id="session-1",
            hub_id="11111111-1111-1111-1111-111111111111",
            title="How do I submit assignments?",
            scope="hub",
            source_ids=["src-1"],
            created_at="2026-01-01T00:00:00Z",
            last_message_at="2026-01-01T00:05:00Z",
        ),
        messages=[
            SessionMessage(
                id="message-1",
                role="assistant",
                content="Hi! How can I help you with this hub?",
                citations=[],
                created_at="2026-01-01T00:00:00Z",
                answer_status="greeting",
            )
        ],
    )
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=True))
    monkeypatch.setattr(
        store_module.store,
        "get_chat_session_with_messages",
        lambda _client, user_id, hub_id, session_id: response,
    )

    resp = client.get(
        "/chat/sessions/11111111-1111-1111-1111-111111111111/messages",
        params={"hub_id": "11111111-1111-1111-1111-111111111111"},
    )
    assert resp.status_code == 200
    assert resp.headers["X-RateLimit-Limit"] == "120"
    data = resp.json()
    assert data["session"]["id"] == "session-1"
    assert data["messages"][0]["content"] == "Hi! How can I help you with this hub?"
    assert data["messages"][0]["answer_status"] == "greeting"


# Verifies that search chat messages.
def test_search_chat_messages(client, monkeypatch) -> None:
    response = [
        ChatSearchResult(
            session_id="session-1",
            session_title="Assignments",
            hub_id="11111111-1111-1111-1111-111111111111",
            message_id="message-2",
            matched_role="assistant",
            snippet="...submit assignments through Moodle before Friday...",
            matched_text="assignments",
            created_at="2026-01-01T00:05:00Z",
        )
    ]
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=True))
    monkeypatch.setattr(store_module.store, "search_chat_messages", lambda _client, user_id, hub_id, q: response)

    resp = client.get(
        "/chat/search",
        params={"hub_id": "11111111-1111-1111-1111-111111111111", "q": "assignments"},
    )

    assert resp.status_code == 200
    assert resp.headers["X-RateLimit-Limit"] == "120"
    data = resp.json()
    assert data[0]["session_id"] == "session-1"
    assert data[0]["message_id"] == "message-2"
    assert data[0]["matched_role"] == "assistant"


# Verifies that search chat messages returns title matches.
def test_search_chat_messages_returns_title_matches(client, monkeypatch) -> None:
    response = [
        ChatSearchResult(
            session_id="session-3",
            session_title="Assignments overview",
            hub_id="11111111-1111-1111-1111-111111111111",
            message_id=None,
            matched_role="title",
            snippet="Assignments overview",
            matched_text="Assignments",
            created_at="2026-01-02T00:05:00Z",
        )
    ]
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=True))
    monkeypatch.setattr(store_module.store, "search_chat_messages", lambda _client, user_id, hub_id, q: response)

    resp = client.get(
        "/chat/search",
        params={"hub_id": "11111111-1111-1111-1111-111111111111", "q": "assignments"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["session_title"] == "Assignments overview"
    assert data[0]["message_id"] is None
    assert data[0]["matched_role"] == "title"


# Verifies that search chat messages rejects unaccepted invite.
def test_search_chat_messages_rejects_unaccepted_invite(client, monkeypatch) -> None:
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=False))

    resp = client.get(
        "/chat/search",
        params={"hub_id": "11111111-1111-1111-1111-111111111111", "q": "assignments"},
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Invite not accepted yet."


# Verifies that list chat sessions rejects unaccepted invite.
def test_list_chat_sessions_rejects_unaccepted_invite(client, monkeypatch) -> None:
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=False))

    resp = client.get("/chat/sessions", params={"hub_id": "11111111-1111-1111-1111-111111111111"})

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Invite not accepted yet."


# Verifies that get chat session messages rejects unaccepted invite.
def test_get_chat_session_messages_rejects_unaccepted_invite(client, monkeypatch) -> None:
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=False))

    resp = client.get(
        "/chat/sessions/11111111-1111-1111-1111-111111111111/messages",
        params={"hub_id": "11111111-1111-1111-1111-111111111111"},
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Invite not accepted yet."


# Verifies that delete chat session.
def test_delete_chat_session(client, monkeypatch) -> None:
    captured = {}

    # Helper used by the surrounding test code.
    def fake_delete(_client, user_id, session_id) -> None:
        captured["session_id"] = session_id

    monkeypatch.setattr(store_module.store, "delete_chat_session", fake_delete)

    resp = client.delete("/chat/sessions/11111111-1111-1111-1111-111111111111")
    assert resp.status_code == 204
    assert captured["session_id"] == "11111111-1111-1111-1111-111111111111"


# Verifies that rename chat session rejects non owner.
def test_rename_chat_session_rejects_non_owner(client, monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "rename_chat_session",
        lambda _client, user_id, session_id, title: (_ for _ in ()).throw(
            PermissionError("Only the chat creator can modify this session.")
        ),
    )

    resp = client.patch(
        "/chat/sessions/11111111-1111-1111-1111-111111111111",
        json={"title": "Updated title"},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Only the chat creator can modify this session."


# Verifies that delete chat session rejects non owner.
def test_delete_chat_session_rejects_non_owner(client, monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "delete_chat_session",
        lambda _client, user_id, session_id: (_ for _ in ()).throw(
            PermissionError("Only the chat creator can modify this session.")
        ),
    )

    resp = client.delete("/chat/sessions/11111111-1111-1111-1111-111111111111")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Only the chat creator can modify this session."
