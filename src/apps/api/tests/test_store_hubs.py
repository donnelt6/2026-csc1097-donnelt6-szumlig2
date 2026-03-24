"""Unit tests for store hub behavior."""

from postgrest.exceptions import APIError

from app.schemas import HubCreate, HubUpdate, MembershipRole
from app.services import store as store_module


class FakeRpcResponse:
    def __init__(self, data):
        self.data = data


class FakeRpcCall:
    def __init__(self, client: "FakeServiceClient", name: str, payload: dict) -> None:
        self.client = client
        self.name = name
        self.payload = payload

    def execute(self) -> FakeRpcResponse:
        self.client.rpc_calls.append((self.name, self.payload))
        return FakeRpcResponse(
            [
                {
                    "id": "hub-1",
                    "owner_id": self.payload["p_owner_id"],
                    "name": self.payload["p_name"],
                    "description": self.payload["p_description"],
                    "icon_key": self.payload["p_icon_key"],
                    "color_key": self.payload["p_color_key"],
                    "created_at": "2026-03-22T12:00:00Z",
                    "archived_at": None,
                    "role": MembershipRole.owner.value,
                    "last_accessed_at": "2026-03-22T12:00:00Z",
                    "is_favourite": True,
                }
            ]
        )


class FakeServiceClient:
    def __init__(self) -> None:
        self.rpc_calls: list[tuple[str, dict]] = []
        self.auth = type(
            "FakeAuth",
            (),
            {
                "admin": type(
                    "FakeAdmin",
                    (),
                    {"list_users": staticmethod(lambda: [])},
                )()
            },
        )()

    def rpc(self, name: str, payload: dict) -> FakeRpcCall:
        return FakeRpcCall(self, name, payload)


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, data):
        self.data = data

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value: str):
        return self

    @property
    def not_(self):
        return self

    def is_(self, _column: str, _value: str):
        return self

    def order(self, _column: str, desc: bool = False):
        _ = desc
        return self

    def in_(self, _column: str, _values: list[str]):
        return self

    def execute(self):
        return FakeResponse(self.data)


class FakeClient:
    def __init__(self, memberships: list[dict], members: list[dict]) -> None:
        self.memberships = memberships
        self.members = members

    def table(self, name: str):
        if name == "hub_members":
            if self.members and not self.memberships:
                return FakeQuery(self.members)
            if self.memberships:
                data = self.memberships
                self.memberships = []
                return FakeQuery(data)
            return FakeQuery(self.members)
        raise AssertionError(f"Unexpected table {name}")


class FallbackHubMembersQuery(FakeQuery):
    def __init__(self, responses: list[object]) -> None:
        super().__init__([])
        self.responses = responses

    def execute(self):
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return FakeResponse(response)


class FallbackClient:
    def __init__(self, responses: list[object]) -> None:
        self.responses = responses

    def table(self, name: str):
        if name == "hub_members":
            return FallbackHubMembersQuery(self.responses)
        raise AssertionError(f"Unexpected table {name}")


class FakeHubsQuery:
    def __init__(self, client: "FakeUpdateClient") -> None:
        self.client = client
        self.mode: str | None = None
        self.payload: dict | None = None

    def update(self, payload: dict):
        self.mode = "update"
        self.payload = payload
        return self

    def select(self, _fields: str):
        self.mode = "select"
        return self

    def eq(self, _column: str, _value: str):
        return self

    def execute(self):
        if self.mode == "update":
            self.client.update_calls.append(self.payload or {})
            return FakeResponse([{"id": "hub-1"}])
        if self.mode == "select":
            return FakeResponse(
                [
                    {
                        "id": "hub-1",
                        "owner_id": "user-1",
                        "name": "Launch Hub",
                        "description": "Docs",
                        "icon_key": "rocket",
                        "color_key": "blue",
                        "created_at": "2026-03-22T12:00:00Z",
                        "members_count": 2,
                        "sources_count": 5,
                    }
                ]
            )
        raise AssertionError("Unexpected hubs query mode")


class FakeUpdateClient:
    def __init__(self) -> None:
        self.update_calls: list[dict] = []

    def table(self, name: str):
        if name == "hubs":
            return FakeHubsQuery(self)
        raise AssertionError(f"Unexpected table {name}")


class FakeArchiveHubsQuery:
    def __init__(self, client: "FakeArchiveClient") -> None:
        self.client = client
        self.mode: str | None = None
        self.payload: dict | None = None

    def select(self, _fields: str):
        self.mode = "select"
        return self

    def update(self, payload: dict):
        self.mode = "update"
        self.payload = payload
        return self

    def eq(self, _column: str, _value: str):
        return self

    def execute(self):
        if self.mode == "select":
            if not self.client.exists:
                return FakeResponse([])
            return FakeResponse(
                [
                    {
                        "id": "hub-1",
                        "owner_id": "user-1",
                        "name": "Launch Hub",
                        "description": "Docs",
                        "icon_key": "rocket",
                        "color_key": "blue",
                        "created_at": "2026-03-22T12:00:00Z",
                        "archived_at": self.client.archived_at,
                        "members_count": 2,
                        "sources_count": 5,
                    }
                ]
            )
        if self.mode == "update":
            self.client.update_calls.append(self.payload or {})
            self.client.archived_at = (self.payload or {}).get("archived_at")
            return FakeResponse([{"id": "hub-1"}])
        raise AssertionError("Unexpected hubs archive query mode")


class FakeArchiveClient:
    def __init__(self, exists: bool = True) -> None:
        self.exists = exists
        self.update_calls: list[dict] = []
        self.archived_at: str | None = None

    def table(self, name: str):
        if name == "hubs":
            return FakeArchiveHubsQuery(self)
        raise AssertionError(f"Unexpected table {name}")


def test_create_hub_uses_atomic_service_role_rpc(monkeypatch) -> None:
    fake_service_client = FakeServiceClient()
    monkeypatch.setattr(store_module.store, "service_client", fake_service_client)

    hub = store_module.store.create_hub(
        object(),
        "00000000-0000-0000-0000-000000000001",
        HubCreate(name="New Hub", description="Test hub", icon_key="rocket", color_key="blue"),
    )

    assert fake_service_client.rpc_calls == [
        (
            "create_hub_with_owner_membership",
            {
                "p_owner_id": "00000000-0000-0000-0000-000000000001",
                "p_name": "New Hub",
                "p_description": "Test hub",
                "p_icon_key": "rocket",
                "p_color_key": "blue",
            },
        )
    ]
    assert hub.id == "hub-1"
    assert hub.role == MembershipRole.owner
    assert hub.is_favourite is True
    assert hub.icon_key == "rocket"
    assert hub.color_key == "blue"


def test_list_hubs_returns_appearance_fields(monkeypatch) -> None:
    fake_service_client = FakeServiceClient()
    monkeypatch.setattr(store_module.store, "service_client", fake_service_client)
    client = FakeClient(
        memberships=[
            {
                "role": MembershipRole.owner.value,
                "last_accessed_at": "2026-03-22T12:00:00Z",
                "is_favourite": True,
                "hubs": {
                    "id": "hub-1",
                    "owner_id": "user-1",
                    "name": "Launch Hub",
                    "description": "Docs",
                    "icon_key": "rocket",
                    "color_key": "blue",
                    "created_at": "2026-03-22T12:00:00Z",
                    "archived_at": None,
                    "members_count": 2,
                    "sources_count": 5,
                },
            }
        ],
        members=[],
    )

    hubs = store_module.store.list_hubs(client, "user-1")

    assert len(hubs) == 1
    assert hubs[0].icon_key == "rocket"
    assert hubs[0].color_key == "blue"


def test_list_hubs_falls_back_when_appearance_columns_are_missing(monkeypatch) -> None:
    fake_service_client = FakeServiceClient()
    monkeypatch.setattr(store_module.store, "service_client", fake_service_client)
    client = FallbackClient(
        responses=[
            APIError({"message": "column hubs_1.icon_key does not exist", "code": "42703"}),
            [
                {
                    "role": MembershipRole.owner.value,
                    "last_accessed_at": "2026-03-22T12:00:00Z",
                    "is_favourite": True,
                    "hubs": {
                        "id": "hub-legacy",
                        "owner_id": "user-1",
                        "name": "Legacy Hub",
                        "description": "Docs",
                        "created_at": "2026-03-22T12:00:00Z",
                        "archived_at": None,
                        "members_count": 2,
                        "sources_count": 5,
                    },
                }
            ],
        ]
    )

    hubs = store_module.store.list_hubs(client, "user-1")

    assert len(hubs) == 1
    assert hubs[0].id == "hub-legacy"
    assert hubs[0].icon_key == "stack"
    assert hubs[0].color_key == "slate"


def test_list_hubs_falls_back_when_archived_at_column_is_missing(monkeypatch) -> None:
    fake_service_client = FakeServiceClient()
    monkeypatch.setattr(store_module.store, "service_client", fake_service_client)
    client = FallbackClient(
        responses=[
            APIError({"message": "column hubs_1.archived_at does not exist", "code": "42703"}),
            [
                {
                    "role": MembershipRole.owner.value,
                    "last_accessed_at": "2026-03-22T12:00:00Z",
                    "is_favourite": True,
                    "hubs": {
                        "id": "hub-legacy",
                        "owner_id": "user-1",
                        "name": "Legacy Hub",
                        "description": "Docs",
                        "icon_key": "rocket",
                        "color_key": "blue",
                        "created_at": "2026-03-22T12:00:00Z",
                        "members_count": 2,
                        "sources_count": 5,
                    },
                }
            ],
        ]
    )

    hubs = store_module.store.list_hubs(client, "user-1")

    assert len(hubs) == 1
    assert hubs[0].id == "hub-legacy"
    assert hubs[0].icon_key == "rocket"
    assert hubs[0].color_key == "blue"
    assert hubs[0].archived_at is None


def test_update_hub_updates_then_reads_back_hub(monkeypatch) -> None:
    fake_service_client = FakeServiceClient()
    monkeypatch.setattr(store_module.store, "service_client", fake_service_client)
    client = FakeUpdateClient()

    hub = store_module.store.update_hub(
        client,
        "hub-1",
        HubUpdate(icon_key="rocket", color_key="blue"),
    )

    assert client.update_calls == [{"icon_key": "rocket", "color_key": "blue"}]
    assert hub.id == "hub-1"
    assert hub.icon_key == "rocket"
    assert hub.color_key == "blue"


def test_archive_hub_sets_archived_at_for_existing_hub(monkeypatch) -> None:
    fake_service_client = FakeServiceClient()
    monkeypatch.setattr(store_module.store, "service_client", fake_service_client)
    client = FakeArchiveClient()

    hub = store_module.store.archive_hub(client, "hub-1")

    assert len(client.update_calls) == 1
    assert "archived_at" in client.update_calls[0]
    assert hub.archived_at is not None


def test_unarchive_hub_clears_archived_at_for_existing_hub(monkeypatch) -> None:
    fake_service_client = FakeServiceClient()
    monkeypatch.setattr(store_module.store, "service_client", fake_service_client)
    client = FakeArchiveClient()
    client.archived_at = "2026-03-22T12:00:00Z"

    hub = store_module.store.unarchive_hub(client, "hub-1")

    assert client.update_calls == [{"archived_at": None}]
    assert hub.archived_at is None
