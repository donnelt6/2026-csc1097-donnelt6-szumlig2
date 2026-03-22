"""Unit tests for store moderation behaviors."""

from datetime import datetime, timezone

import pytest

from app.schemas import FlagCaseStatus, FlagReason
from app.services import store as store_module


class FakeAPIError(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeRpcCall:
    def __init__(self, client: "FakeServiceClient", name: str, payload: dict) -> None:
        self.client = client
        self.name = name
        self.payload = payload

    def execute(self) -> FakeResponse:
        self.client.rpc_calls.append((self.name, self.payload))
        if self.name == "create_message_flag_case_with_original_revision":
            if self.client.raise_unique_on_flag_insert:
                self.client.flag_cases = [dict(self.client.race_existing_case)]
                raise FakeAPIError("duplicate key value violates unique constraint", "23505")
            row = {
                "id": f"flag-{len(self.client.flag_cases) + 1}",
                "hub_id": self.client.flag_create_hub_id,
                "session_id": self.client.flag_create_session_id,
                "message_id": self.payload["p_message_id"],
                "created_by": self.payload["p_created_by"],
                "reason": self.payload["p_reason"],
                "notes": self.payload.get("p_notes"),
                "status": FlagCaseStatus.open.value,
                "reviewed_by": None,
                "reviewed_at": None,
                "resolved_revision_id": None,
                "created_at": "2026-03-22T10:00:00Z",
                "updated_at": "2026-03-22T10:00:00Z",
            }
            self.client.flag_cases.append(row)
            self.client.message_revision_inserts.append(
                {
                    "id": f"revision-{len(self.client.message_revision_inserts) + 1}",
                    "message_id": self.payload["p_message_id"],
                    "flag_case_id": row["id"],
                    "revision_type": "original",
                    "created_by": self.payload["p_created_by"],
                }
            )
            return FakeResponse([row])
        if self.name == "apply_message_revision_and_resolve_flag_case":
            if self.client.apply_rpc_result is not None:
                return FakeResponse([dict(self.client.apply_rpc_result)])
        return FakeResponse([])


class FakeTable:
    def __init__(self, client: "FakeServiceClient", name: str) -> None:
        self.client = client
        self.name = name
        self._op: str | None = None
        self._payload = None
        self._eq_filters: dict[str, str] = {}
        self._in_filters: dict[str, list[str]] = {}
        self._limit: int | None = None
        self._order_desc = False

    def select(self, _fields: str) -> "FakeTable":
        self._op = "select"
        return self

    def insert(self, payload: dict) -> "FakeTable":
        self._op = "insert"
        self._payload = payload
        return self

    def eq(self, column: str, value: str) -> "FakeTable":
        self._eq_filters[column] = value
        return self

    def in_(self, column: str, values: list[str]) -> "FakeTable":
        self._in_filters[column] = values
        return self

    def order(self, _column: str, desc: bool = False) -> "FakeTable":
        self._order_desc = desc
        return self

    def limit(self, value: int) -> "FakeTable":
        self._limit = value
        return self

    def execute(self) -> FakeResponse:
        if self.name == "message_flag_cases":
            if self._op == "select":
                rows = [dict(row) for row in self.client.flag_cases]
                for key, value in self._eq_filters.items():
                    rows = [row for row in rows if str(row.get(key)) == str(value)]
                for key, values in self._in_filters.items():
                    rows = [row for row in rows if str(row.get(key)) in {str(item) for item in values}]
                rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=self._order_desc)
                if self._limit is not None:
                    rows = rows[: self._limit]
                return FakeResponse(rows)
            if self._op == "insert":
                if self.client.raise_unique_on_flag_insert:
                    self.client.flag_cases = [dict(self.client.race_existing_case)]
                    raise FakeAPIError("duplicate key value violates unique constraint", "23505")
                row = dict(self._payload or {})
                row.setdefault("id", f"flag-{len(self.client.flag_case_inserts) + 1}")
                row.setdefault("created_at", "2026-03-22T10:00:00Z")
                row.setdefault("updated_at", row["created_at"])
                self.client.flag_case_inserts.append(row)
                self.client.flag_cases.append(row)
                return FakeResponse([row])
        if self.name == "message_revisions" and self._op == "insert":
            row = dict(self._payload or {})
            row.setdefault("id", f"revision-{len(self.client.message_revision_inserts) + 1}")
            self.client.message_revision_inserts.append(row)
            return FakeResponse([row])
        if self.name == "hubs" and self._op == "select":
            rows = [dict(row) for row in self.client.hubs]
            for key, value in self._eq_filters.items():
                rows = [row for row in rows if str(row.get(key)) == str(value)]
            if self._limit is not None:
                rows = rows[: self._limit]
            return FakeResponse(rows)
        return FakeResponse([])


class FakeServiceClient:
    def __init__(self) -> None:
        self.flag_cases: list[dict] = []
        self.flag_case_inserts: list[dict] = []
        self.message_revision_inserts: list[dict] = []
        self.hubs: list[dict] = []
        self.rpc_calls: list[tuple[str, dict]] = []
        self.raise_unique_on_flag_insert = False
        self.race_existing_case: dict = {}
        self.flag_create_hub_id = "hub-1"
        self.flag_create_session_id = "session-1"
        self.apply_rpc_result: dict | None = None

    def table(self, name: str) -> FakeTable:
        return FakeTable(self, name)

    def rpc(self, name: str, payload: dict) -> FakeRpcCall:
        return FakeRpcCall(self, name, payload)


@pytest.fixture
def fake_service_client(monkeypatch) -> FakeServiceClient:
    client = FakeServiceClient()
    monkeypatch.setattr(store_module.store, "service_client", client)
    return client


def test_flag_message_creates_case_and_original_revision_on_first_flag(fake_service_client, monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "_visible_message_for_user",
        lambda _client, _message_id: {
            "id": "message-1",
            "session_id": "session-1",
            "role": "assistant",
            "content": "Original answer",
            "citations": [],
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_get_chat_session_row",
        lambda _client, _session_id, include_deleted=False: {"id": "session-1", "hub_id": "hub-1"},
    )

    result = store_module.store.flag_message(
        object(),
        "user-1",
        "message-1",
        store_module.FlagMessageRequest(reason=FlagReason.incorrect),
    )

    assert result.created is True
    assert fake_service_client.rpc_calls == [
        (
            "create_message_flag_case_with_original_revision",
            {
                "p_message_id": "message-1",
                "p_created_by": "user-1",
                "p_reason": "incorrect",
                "p_notes": None,
            },
        )
    ]
    assert len(fake_service_client.message_revision_inserts) == 1
    assert fake_service_client.message_revision_inserts[0]["revision_type"] == "original"


def test_flag_message_returns_existing_active_case_without_new_insert(fake_service_client, monkeypatch) -> None:
    existing_case = {
        "id": "flag-1",
        "hub_id": "hub-1",
        "session_id": "session-1",
        "message_id": "message-1",
        "created_by": "user-2",
        "reason": "incorrect",
        "notes": None,
        "status": FlagCaseStatus.open.value,
        "reviewed_by": None,
        "reviewed_at": None,
        "resolved_revision_id": None,
        "created_at": "2026-03-22T10:00:00Z",
        "updated_at": "2026-03-22T10:00:00Z",
    }
    fake_service_client.flag_cases = [existing_case]
    monkeypatch.setattr(
        store_module.store,
        "_visible_message_for_user",
        lambda _client, _message_id: {"id": "message-1", "session_id": "session-1", "role": "assistant"},
    )
    monkeypatch.setattr(
        store_module.store,
        "_get_chat_session_row",
        lambda _client, _session_id, include_deleted=False: {"id": "session-1", "hub_id": "hub-1"},
    )

    result = store_module.store.flag_message(
        object(),
        "user-1",
        "message-1",
        store_module.FlagMessageRequest(reason=FlagReason.incorrect),
    )

    assert result.created is False
    assert result.flag_case.id == "flag-1"
    assert fake_service_client.rpc_calls == []
    assert fake_service_client.message_revision_inserts == []


def test_flag_message_recovers_from_unique_race_and_returns_existing_case(fake_service_client, monkeypatch) -> None:
    fake_service_client.raise_unique_on_flag_insert = True
    fake_service_client.race_existing_case = {
        "id": "flag-race",
        "hub_id": "hub-1",
        "session_id": "session-1",
        "message_id": "message-1",
        "created_by": "user-2",
        "reason": "incorrect",
        "notes": None,
        "status": FlagCaseStatus.open.value,
        "reviewed_by": None,
        "reviewed_at": None,
        "resolved_revision_id": None,
        "created_at": "2026-03-22T10:00:00Z",
        "updated_at": "2026-03-22T10:00:00Z",
    }
    monkeypatch.setattr(
        store_module.store,
        "_visible_message_for_user",
        lambda _client, _message_id: {
            "id": "message-1",
            "session_id": "session-1",
            "role": "assistant",
            "content": "Original answer",
            "citations": [],
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_get_chat_session_row",
        lambda _client, _session_id, include_deleted=False: {"id": "session-1", "hub_id": "hub-1"},
    )

    result = store_module.store.flag_message(
        object(),
        "user-1",
        "message-1",
        store_module.FlagMessageRequest(reason=FlagReason.incorrect),
    )

    assert result.created is False
    assert result.flag_case.id == "flag-race"
    assert fake_service_client.message_revision_inserts == []


def test_apply_flagged_chat_revision_uses_atomic_rpc(fake_service_client, monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "_get_flag_case_for_hub",
        lambda _user_id, _hub_id, _flag_case_id: {
            "id": "flag-1",
            "hub_id": "hub-1",
            "session_id": "session-1",
            "message_id": "message-1",
            "status": "in_review",
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_get_revision_row",
        lambda _revision_id: {
            "id": "revision-2",
            "flag_case_id": "flag-1",
            "revision_type": "manual_edit",
            "content": "Updated answer",
            "citations": [],
        },
    )
    fake_service_client.apply_rpc_result = {
        "id": "flag-1",
        "hub_id": "hub-1",
        "session_id": "session-1",
        "message_id": "message-1",
        "created_by": "user-2",
        "reason": "incorrect",
        "notes": None,
        "status": "resolved",
        "reviewed_by": "user-1",
        "reviewed_at": "2026-03-22T10:10:00Z",
        "resolved_revision_id": "revision-2",
        "created_at": "2026-03-22T10:00:00Z",
        "updated_at": "2026-03-22T10:10:00Z",
    }

    result = store_module.store.apply_flagged_chat_revision("user-1", "hub-1", "flag-1", "revision-2")

    assert result.status == FlagCaseStatus.resolved
    assert result.resolved_revision_id == "revision-2"
    assert fake_service_client.rpc_calls[-1] == (
        "apply_message_revision_and_resolve_flag_case",
        {
            "p_flag_case_id": "flag-1",
            "p_revision_id": "revision-2",
            "p_reviewed_by": "user-1",
        },
    )


def test_apply_flagged_chat_revision_rejects_revision_from_other_case(monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "_get_flag_case_for_hub",
        lambda _user_id, _hub_id, _flag_case_id: {
            "id": "flag-1",
            "hub_id": "hub-1",
            "session_id": "session-1",
            "message_id": "message-1",
            "status": "open",
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_get_revision_row",
        lambda _revision_id: {
            "id": "revision-2",
            "flag_case_id": "flag-2",
            "revision_type": "manual_edit",
        },
    )

    with pytest.raises(ValueError, match="Revision does not belong to this flag case."):
        store_module.store.apply_flagged_chat_revision("user-1", "hub-1", "flag-1", "revision-2")


def test_apply_flagged_chat_revision_rejects_original_revision(monkeypatch) -> None:
    monkeypatch.setattr(
        store_module.store,
        "_get_flag_case_for_hub",
        lambda _user_id, _hub_id, _flag_case_id: {
            "id": "flag-1",
            "hub_id": "hub-1",
            "session_id": "session-1",
            "message_id": "message-1",
            "status": "open",
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_get_revision_row",
        lambda _revision_id: {
            "id": "revision-1",
            "flag_case_id": "flag-1",
            "revision_type": "original",
        },
    )

    with pytest.raises(ValueError, match="Original snapshots cannot be applied."):
        store_module.store.apply_flagged_chat_revision("user-1", "hub-1", "flag-1", "revision-1")


def test_list_flagged_chat_queue_includes_deleted_sessions(fake_service_client, monkeypatch) -> None:
    fake_service_client.flag_cases = [
        {
            "id": "flag-1",
            "hub_id": "hub-1",
            "session_id": "session-deleted",
            "message_id": "message-1",
            "reason": "incorrect",
            "status": "open",
            "created_at": "2026-03-22T10:00:00Z",
            "reviewed_at": None,
        }
    ]
    fake_service_client.hubs = [{"id": "hub-1", "name": "Hub One"}]
    include_deleted_calls: list[bool] = []
    monkeypatch.setattr(store_module.store, "_require_moderation_access", lambda _user_id, _hub_id: None)
    monkeypatch.setattr(
        store_module.store,
        "_get_chat_session_row",
        lambda _client, _session_id, include_deleted=False: include_deleted_calls.append(include_deleted) or {
            "id": "session-deleted",
            "title": "Deleted chat",
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_service_message_row",
        lambda _message_id: {"content": "Answer content"},
    )
    monkeypatch.setattr(
        store_module.store,
        "_question_for_flagged_message",
        lambda _session_id, _message_id: {"content": "Question content"},
    )

    items = store_module.store.list_flagged_chat_queue("user-1", "hub-1")

    assert len(items) == 1
    assert items[0].id == "flag-1"
    assert include_deleted_calls == [True]


def test_list_flagged_chat_queue_skips_unreadable_cases(fake_service_client, monkeypatch) -> None:
    fake_service_client.flag_cases = [
        {
            "id": "flag-bad",
            "hub_id": "hub-1",
            "session_id": "missing-session",
            "message_id": "message-bad",
            "reason": "incorrect",
            "status": "open",
            "created_at": "2026-03-22T09:00:00Z",
            "reviewed_at": None,
        },
        {
            "id": "flag-good",
            "hub_id": "hub-1",
            "session_id": "session-2",
            "message_id": "message-2",
            "reason": "outdated",
            "status": "open",
            "created_at": "2026-03-22T10:00:00Z",
            "reviewed_at": None,
        },
    ]
    fake_service_client.hubs = [{"id": "hub-1", "name": "Hub One"}]
    monkeypatch.setattr(store_module.store, "_require_moderation_access", lambda _user_id, _hub_id: None)

    def fake_get_chat_session_row(_client, session_id, include_deleted=False):
        if session_id == "missing-session":
            raise KeyError("Chat session not found")
        return {"id": session_id, "title": "Available chat"}

    monkeypatch.setattr(store_module.store, "_get_chat_session_row", fake_get_chat_session_row)
    monkeypatch.setattr(store_module.store, "_service_message_row", lambda _message_id: {"content": "Answer"})
    monkeypatch.setattr(store_module.store, "_question_for_flagged_message", lambda _session_id, _message_id: {"content": "Question"})

    items = store_module.store.list_flagged_chat_queue("user-1", "hub-1")

    assert [item.id for item in items] == ["flag-good"]


def test_get_flagged_chat_detail_loads_deleted_session(fake_service_client, monkeypatch) -> None:
    fake_service_client.hubs = [{"id": "hub-1", "name": "Hub One"}]
    include_deleted_calls: list[bool] = []
    monkeypatch.setattr(
        store_module.store,
        "_get_flag_case_for_hub",
        lambda _user_id, _hub_id, _flag_case_id: {
            "id": "flag-1",
            "hub_id": "hub-1",
            "session_id": "session-deleted",
            "message_id": "message-1",
            "created_by": "user-2",
            "reason": "incorrect",
            "notes": None,
            "status": "open",
            "reviewed_by": None,
            "reviewed_at": None,
            "resolved_revision_id": None,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_get_chat_session_row",
        lambda _client, _session_id, include_deleted=False: include_deleted_calls.append(include_deleted) or {
            "id": "session-deleted",
            "title": "Deleted chat",
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_question_for_flagged_message",
        lambda _session_id, _message_id: {
            "id": "question-1",
            "role": "user",
            "content": "Question",
            "citations": [],
            "created_at": datetime.now(timezone.utc),
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_service_message_row",
        lambda _message_id: {
            "id": "message-1",
            "role": "assistant",
            "content": "Answer",
            "citations": [],
            "created_at": datetime.now(timezone.utc),
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_message_flag_metadata",
        lambda _message_ids: {"message-1": {"active_flag_id": "flag-1", "flag_status": "open"}},
    )
    monkeypatch.setattr(store_module.store, "_list_flag_case_revisions", lambda _flag_case_id: [])

    detail = store_module.store.get_flagged_chat_detail("user-1", "hub-1", "flag-1")

    assert detail.case.id == "flag-1"
    assert detail.session_title == "Deleted chat"
    assert include_deleted_calls == [True]


def test_flag_case_generation_context_loads_deleted_session(monkeypatch) -> None:
    include_deleted_calls: list[bool] = []
    monkeypatch.setattr(
        store_module.store,
        "_get_chat_session_row",
        lambda _client, _session_id, include_deleted=False: include_deleted_calls.append(include_deleted) or {
            "id": "session-deleted",
            "scope": "hub",
            "source_ids": ["src-1"],
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_service_message_row",
        lambda _message_id: {
            "id": "message-1",
            "role": "assistant",
            "content": "Flagged answer",
            "citations": [],
            "created_at": "2026-03-22T10:00:02Z",
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_question_for_flagged_message",
        lambda _session_id, _message_id: {
            "id": "question-1",
            "role": "user",
            "content": "Question",
            "citations": [],
            "created_at": "2026-03-22T10:00:01Z",
        },
    )
    monkeypatch.setattr(
        store_module.store,
        "_list_session_messages",
        lambda _client, _session_id, fields="id, role, content, citations, created_at", limit=None: [
            {"id": "prior-1", "role": "user", "content": "Earlier question", "citations": [], "created_at": "2026-03-22T09:59:00Z"},
            {"id": "prior-2", "role": "assistant", "content": "Earlier answer", "citations": [], "created_at": "2026-03-22T09:59:30Z"},
            {"id": "question-1", "role": "user", "content": "Question", "citations": [], "created_at": "2026-03-22T10:00:01Z"},
            {"id": "message-1", "role": "assistant", "content": "Flagged answer", "citations": [], "created_at": "2026-03-22T10:00:02Z"},
        ],
    )

    session_row, question_row, history_messages, retrieval_history, source_ids = store_module.store._flag_case_generation_context(
        {
            "session_id": "session-deleted",
            "message_id": "message-1",
        }
    )

    assert session_row["id"] == "session-deleted"
    assert question_row["id"] == "question-1"
    assert include_deleted_calls == [True]
    assert [message["content"] for message in history_messages] == ["Earlier question", "Earlier answer"]
    assert source_ids == ["src-1"]
