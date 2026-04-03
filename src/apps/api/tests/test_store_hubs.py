"""Unit tests for store hub behavior."""

from postgrest.exceptions import APIError

from app.schemas import HubCreate, HubUpdate, MembershipRole
from app.services import store as store_module


# Response stub used by the surrounding tests.
# Test helpers and fixtures.
class FakeRpcResponse:

    # Initializes the test helper state used by this class.
    def __init__(self, data):
        self.data = data


# Test double used by the surrounding tests.
class FakeRpcCall:
    # Initializes the test helper state used by this class.
    def __init__(self, client: "FakeServiceClient", name: str, payload: dict) -> None:
        self.client = client
        self.name = name
        self.payload = payload

    # Returns the prepared fake response for the current operation.
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


# Service-role client stub used by the surrounding tests.
class FakeServiceClient:
    # Initializes the test helper state used by this class.
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

    # Returns a stub RPC call object for the requested procedure.
    def rpc(self, name: str, payload: dict) -> FakeRpcCall:
        return FakeRpcCall(self, name, payload)


# Simple response stub used by the surrounding tests.
class FakeResponse:
    # Initializes the test helper state used by this class.
    def __init__(self, data):
        self.data = data


# Query stub used to capture chained store operations in tests.
class FakeQuery:
    # Initializes the test helper state used by this class.
    def __init__(self, data):
        self.data = data

    # Captures the requested select clause for later execution.
    def select(self, _fields: str):
        return self

    # Captures an equality filter for the current query stub.
    def eq(self, _column: str, _value: str):
        return self

    # Helper used by the surrounding test code.
    @property
    def not_(self):
        return self

    # Helper used by the surrounding test code.
    def is_(self, _column: str, _value: str):
        return self

    # Captures ordering details for the current query stub.
    def order(self, _column: str, desc: bool = False):
        _ = desc
        return self

    # Captures an inclusion filter for the current query stub.
    def in_(self, _column: str, _values: list[str]):
        return self

    # Returns the prepared fake response for the current operation.
    def execute(self):
        return FakeResponse(self.data)


# Simple client stub used by the surrounding tests.
class FakeClient:
    # Initializes the test helper state used by this class.
    def __init__(self, memberships: list[dict], members: list[dict]) -> None:
        self.memberships = memberships
        self.members = members

    # Returns a stub table object for the requested table name.
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


# Query stub used to capture chained store operations in tests.
class FallbackHubMembersQuery(FakeQuery):
    # Initializes the test helper state used by this class.
    def __init__(self, responses: list[object]) -> None:
        super().__init__([])
        self.responses = responses

    # Returns the prepared fake response for the current operation.
    def execute(self):
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return FakeResponse(response)


# Client stub used by the surrounding tests.
class FallbackClient:
    # Initializes the test helper state used by this class.
    def __init__(self, responses: list[object]) -> None:
        self.responses = responses

    # Returns a stub table object for the requested table name.
    def table(self, name: str):
        if name == "hub_members":
            return FallbackHubMembersQuery(self.responses)
        raise AssertionError(f"Unexpected table {name}")


# Query stub used to capture chained store operations in tests.
class FakeHubsQuery:
    # Initializes the test helper state used by this class.
    def __init__(self, client: "FakeUpdateClient") -> None:
        self.client = client
        self.mode: str | None = None
        self.payload: dict | None = None

    # Captures an update payload for the current query stub.
    def update(self, payload: dict):
        self.mode = "update"
        self.payload = payload
        return self

    # Captures the requested select clause for later execution.
    def select(self, _fields: str):
        self.mode = "select"
        return self

    # Captures an equality filter for the current query stub.
    def eq(self, _column: str, _value: str):
        return self

    # Returns the prepared fake response for the current operation.
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


# Client stub used by the surrounding tests.
class FakeUpdateClient:
    # Initializes the test helper state used by this class.
    def __init__(self) -> None:
        self.update_calls: list[dict] = []

    # Returns a stub table object for the requested table name.
    def table(self, name: str):
        if name == "hubs":
            return FakeHubsQuery(self)
        raise AssertionError(f"Unexpected table {name}")


# Query stub used to capture chained store operations in tests.
class FakeArchiveHubsQuery:
    # Initializes the test helper state used by this class.
    def __init__(self, client: "FakeArchiveClient") -> None:
        self.client = client
        self.mode: str | None = None
        self.payload: dict | None = None

    # Captures the requested select clause for later execution.
    def select(self, _fields: str):
        self.mode = "select"
        return self

    # Captures an update payload for the current query stub.
    def update(self, payload: dict):
        self.mode = "update"
        self.payload = payload
        return self

    # Captures an equality filter for the current query stub.
    def eq(self, _column: str, _value: str):
        return self

    # Returns the prepared fake response for the current operation.
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


# Client stub used by the surrounding tests.
class FakeArchiveClient:
    # Initializes the test helper state used by this class.
    def __init__(self, exists: bool = True) -> None:
        self.exists = exists
        self.update_calls: list[dict] = []
        self.archived_at: str | None = None

    # Returns a stub table object for the requested table name.
    def table(self, name: str):
        if name == "hubs":
            return FakeArchiveHubsQuery(self)
        raise AssertionError(f"Unexpected table {name}")


# Verifies that create hub uses atomic service role rpc.
# Store service tests.
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


# Verifies that list hubs returns appearance fields.
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


# Verifies that list hubs falls back when appearance columns are missing.
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


# Verifies that list hubs falls back when archived at column is missing.
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


# Verifies that update hub updates then reads back hub.
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


# Verifies that archive hub sets archived at for existing hub.
def test_archive_hub_sets_archived_at_for_existing_hub(monkeypatch) -> None:
    fake_service_client = FakeServiceClient()
    monkeypatch.setattr(store_module.store, "service_client", fake_service_client)
    client = FakeArchiveClient()

    hub = store_module.store.archive_hub(client, "hub-1")

    assert len(client.update_calls) == 1
    assert "archived_at" in client.update_calls[0]
    assert hub.archived_at is not None


# Verifies that unarchive hub clears archived at for existing hub.
def test_unarchive_hub_clears_archived_at_for_existing_hub(monkeypatch) -> None:
    fake_service_client = FakeServiceClient()
    monkeypatch.setattr(store_module.store, "service_client", fake_service_client)
    client = FakeArchiveClient()
    client.archived_at = "2026-03-22T12:00:00Z"

    hub = store_module.store.unarchive_hub(client, "hub-1")

    assert client.update_calls == [{"archived_at": None}]
    assert hub.archived_at is None
