"""Unit tests for activity feed store behavior."""

from types import SimpleNamespace

from app.services import store as store_module


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeActivityQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.hub_id: str | None = None
        self.hub_ids: list[str] | None = None
        self.limit_value: int | None = None

    def select(self, _fields: str):
        return self

    def eq(self, column: str, value: str):
        if column == "hub_id":
            self.hub_id = value
        return self

    def in_(self, column: str, values: list[str]):
        if column == "hub_id":
            self.hub_ids = values
        return self

    def order(self, _column: str, desc: bool = False):
        _ = desc
        return self

    def limit(self, value: int):
        self.limit_value = value
        return self

    def execute(self):
        rows = self.rows
        if self.hub_id is not None:
            rows = [row for row in rows if row["hub_id"] == self.hub_id]
        if self.hub_ids is not None:
            rows = [row for row in rows if row["hub_id"] in self.hub_ids]
        if self.limit_value is not None:
            rows = rows[: self.limit_value]
        return FakeResponse(rows)


class FakeClient:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def table(self, name: str):
        if name == "activity_events":
            return FakeActivityQuery(self.rows)
        raise AssertionError(f"Unexpected table {name}")


class FakeAdmin:
    def __init__(self, pages: list[list[SimpleNamespace]]) -> None:
        self.pages = pages
        self.calls: list[tuple[int, int]] = []

    def list_users(self, *, page: int = 1, per_page: int = 100):
        self.calls.append((page, per_page))
        index = page - 1
        return SimpleNamespace(users=self.pages[index] if index < len(self.pages) else [])


def test_list_activity_resolves_only_needed_actor_labels(monkeypatch) -> None:
    rows = [
        {
            "id": "event-1",
            "hub_id": "hub-1",
            "user_id": "user-2",
            "action": "created",
            "resource_type": "hub",
            "metadata": {"name": "Launch Hub"},
            "created_at": "2026-01-01T00:00:00Z",
        },
        {
            "id": "event-2",
            "hub_id": "hub-1",
            "user_id": "user-3",
            "action": "invited",
            "resource_type": "member",
            "metadata": {"email": "target@example.com", "role": "viewer"},
            "created_at": "2026-01-01T00:01:00Z",
        },
    ]
    fake_admin = FakeAdmin(
        pages=[
            [
                SimpleNamespace(id="user-2", email="owner@example.com", user_metadata={"full_name": "Alice"}),
                *[
                    SimpleNamespace(id=f"filler-{index}", email=f"filler-{index}@example.com", user_metadata={})
                    for index in range(99)
                ],
            ],
            [SimpleNamespace(id="user-3", email="viewer@example.com", user_metadata={})],
        ]
    )
    monkeypatch.setattr(
        store_module.store,
        "service_client",
        SimpleNamespace(auth=SimpleNamespace(admin=fake_admin)),
    )

    events = store_module.store.list_activity(FakeClient(rows), "user-1", hub_ids=["hub-1"], limit=10)

    assert fake_admin.calls == [(1, 100), (2, 100)]
    assert events[0].metadata["actor_label"] == "Alice"
    assert events[1].metadata["actor_label"] == "viewer@example.com"


def test_list_activity_marks_current_user_as_you(monkeypatch) -> None:
    rows = [
        {
            "id": "event-1",
            "hub_id": "hub-1",
            "user_id": "user-1",
            "action": "created",
            "resource_type": "hub",
            "metadata": {"name": "Launch Hub"},
            "created_at": "2026-01-01T00:00:00Z",
        }
    ]
    fake_admin = FakeAdmin(pages=[[]])
    monkeypatch.setattr(
        store_module.store,
        "service_client",
        SimpleNamespace(auth=SimpleNamespace(admin=fake_admin)),
    )

    events = store_module.store.list_activity(FakeClient(rows), "user-1", hub_ids=["hub-1"], limit=10)

    assert events[0].metadata["actor_label"] == "You"
    assert fake_admin.calls == []
