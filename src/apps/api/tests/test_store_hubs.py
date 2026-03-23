"""Unit tests for store hub creation behavior."""

from app.schemas import HubCreate, MembershipRole
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
                    "created_at": "2026-03-22T12:00:00Z",
                    "role": MembershipRole.owner.value,
                    "last_accessed_at": "2026-03-22T12:00:00Z",
                    "is_favourite": True,
                }
            ]
        )


class FakeServiceClient:
    def __init__(self) -> None:
        self.rpc_calls: list[tuple[str, dict]] = []

    def rpc(self, name: str, payload: dict) -> FakeRpcCall:
        return FakeRpcCall(self, name, payload)


def test_create_hub_uses_atomic_service_role_rpc(monkeypatch) -> None:
    fake_service_client = FakeServiceClient()
    monkeypatch.setattr(store_module.store, "service_client", fake_service_client)

    hub = store_module.store.create_hub(
        object(),
        "00000000-0000-0000-0000-000000000001",
        HubCreate(name="New Hub", description="Test hub"),
    )

    assert fake_service_client.rpc_calls == [
        (
            "create_hub_with_owner_membership",
            {
                "p_owner_id": "00000000-0000-0000-0000-000000000001",
                "p_name": "New Hub",
                "p_description": "Test hub",
            },
        )
    ]
    assert hub.id == "hub-1"
    assert hub.role == MembershipRole.owner
    assert hub.is_favourite is True
