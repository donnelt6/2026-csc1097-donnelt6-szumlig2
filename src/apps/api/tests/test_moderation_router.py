from datetime import datetime

from app.schemas import (
    Citation,
    FlagCase,
    FlagCaseStatus,
    FlagMessageResponse,
    FlagReason,
    FlaggedChatDetail,
    FlaggedChatQueueItem,
    MessageRevision,
    MessageRevisionType,
    SessionMessage,
)
from app.services import store as store_module


def test_flag_message_returns_created_case(client, monkeypatch) -> None:
    flag_case = FlagCase(
        id="flag-1",
        hub_id="hub-1",
        session_id="session-1",
        message_id="message-1",
        created_by="00000000-0000-0000-0000-000000000001",
        reason=FlagReason.incorrect,
        status=FlagCaseStatus.open,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    monkeypatch.setattr(
        store_module.store,
        "flag_message",
        lambda _client, user_id, message_id, payload: FlagMessageResponse(flag_case=flag_case, created=True),
    )

    resp = client.post(
        "/messages/11111111-1111-1111-1111-111111111111/flag",
        json={"reason": "incorrect"},
    )

    assert resp.status_code == 201
    assert resp.json()["created"] is True
    assert resp.json()["flag_case"]["id"] == "flag-1"


def test_flag_message_returns_existing_case_with_200(client, monkeypatch) -> None:
    flag_case = FlagCase(
        id="flag-1",
        hub_id="hub-1",
        session_id="session-1",
        message_id="message-1",
        created_by="00000000-0000-0000-0000-000000000001",
        reason=FlagReason.incorrect,
        status=FlagCaseStatus.open,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    monkeypatch.setattr(
        store_module.store,
        "flag_message",
        lambda _client, user_id, message_id, payload: FlagMessageResponse(flag_case=flag_case, created=False),
    )

    resp = client.post(
        "/messages/11111111-1111-1111-1111-111111111111/flag",
        json={"reason": "incorrect"},
    )

    assert resp.status_code == 200
    assert resp.json()["created"] is False
    assert resp.json()["flag_case"]["id"] == "flag-1"


def test_flag_message_rejects_user_without_hub_access(client, monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "flag_message",
        lambda _client, user_id, message_id, payload: (_ for _ in ()).throw(PermissionError("Hub access required.")),
    )

    resp = client.post(
        "/messages/11111111-1111-1111-1111-111111111111/flag",
        json={"reason": "incorrect"},
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Hub access required."


def test_list_flagged_chats_returns_queue(client, monkeypatch) -> None:
    queue = [
        FlaggedChatQueueItem(
            id="flag-1",
            hub_id="hub-1",
            hub_name="Hub One",
            session_id="session-1",
            session_title="Chat title",
            message_id="message-1",
            question_preview="How do I start?",
            answer_preview="You should begin with...",
            reason=FlagReason.unsupported,
            status=FlagCaseStatus.open,
            flagged_at=datetime.utcnow(),
        )
    ]
    monkeypatch.setattr(store_module.store, "list_flagged_chat_queue", lambda user_id, hub_id, **kwargs: queue)

    resp = client.get("/hubs/11111111-1111-1111-1111-111111111111/flagged-chats")

    assert resp.status_code == 200
    assert resp.json()[0]["hub_name"] == "Hub One"


def test_get_flagged_chat_rejects_unauthorized_user(client, monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "get_flagged_chat_detail",
        lambda user_id, hub_id, flag_case_id: (_ for _ in ()).throw(PermissionError("Owner or admin role required.")),
    )

    resp = client.get("/hubs/11111111-1111-1111-1111-111111111111/flagged-chats/11111111-1111-1111-1111-111111111111")

    assert resp.status_code == 403


def test_get_flagged_chat_returns_404_for_missing_case(client, monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "get_flagged_chat_detail",
        lambda user_id, hub_id, flag_case_id: (_ for _ in ()).throw(KeyError("Flag case not found")),
    )

    resp = client.get("/hubs/11111111-1111-1111-1111-111111111111/flagged-chats/11111111-1111-1111-1111-111111111111")

    assert resp.status_code == 404


def test_get_flagged_chat_returns_detail(client, monkeypatch) -> None:
    detail = FlaggedChatDetail(
        case=FlagCase(
            id="flag-1",
            hub_id="hub-1",
            session_id="session-1",
            message_id="message-1",
            created_by="00000000-0000-0000-0000-000000000001",
            reason=FlagReason.outdated,
            status=FlagCaseStatus.in_review,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ),
        hub_name="Hub One",
        session_title="Chat title",
        question_message=SessionMessage(
            id="user-1",
            role="user",
            content="How do I start?",
            citations=[],
            created_at=datetime.utcnow(),
        ),
        flagged_message=SessionMessage(
            id="message-1",
            role="assistant",
            content="Old answer",
            citations=[Citation(source_id="src-1", snippet="snippet")],
            created_at=datetime.utcnow(),
            active_flag_id="flag-1",
            flag_status="in_review",
        ),
        revisions=[
            MessageRevision(
                id="revision-1",
                message_id="message-1",
                flag_case_id="flag-1",
                revision_type=MessageRevisionType.manual_edit,
                content="Updated answer",
                citations=[],
                created_at=datetime.utcnow(),
            )
        ],
    )
    monkeypatch.setattr(store_module.store, "get_flagged_chat_detail", lambda user_id, hub_id, flag_case_id: detail)

    resp = client.get("/hubs/11111111-1111-1111-1111-111111111111/flagged-chats/11111111-1111-1111-1111-111111111111")

    assert resp.status_code == 200
    assert resp.json()["flagged_message"]["flag_status"] == "in_review"
