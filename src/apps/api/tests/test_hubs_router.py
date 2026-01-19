"""Router tests for hubs endpoints using monkeypatched store calls."""

from app.schemas import Hub, MembershipRole
from app.services import store as store_module


def test_list_hubs_returns_hubs(client, monkeypatch) -> None:
    # Mocks list_hubs; expect /hubs returns the mocked hub list.
    hub = Hub(id="hub-1", owner_id="user-1", name="Alpha", description="Test", role=MembershipRole.owner)
    monkeypatch.setattr(store_module.store, "list_hubs", lambda _client, user_id: [hub])

    resp = client.get("/hubs")
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["id"] == "hub-1"
    assert data[0]["role"] == "owner"


def test_create_hub_returns_hub(client, monkeypatch) -> None:
    # Mocks create_hub; expect 201 and returned hub payload.
    hub = Hub(id="hub-2", owner_id="user-1", name="New Hub", description=None, role=MembershipRole.owner)
    monkeypatch.setattr(store_module.store, "create_hub", lambda _client, user_id, payload: hub)

    resp = client.post("/hubs", json={"name": "New Hub"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] == "hub-2"
    assert data["name"] == "New Hub"


def test_create_hub_handles_value_error(client, monkeypatch) -> None:
    # Forces ValueError in store; expect 400 response.
    def raise_value_error(_client, user_id, payload):
        raise ValueError("bad")

    monkeypatch.setattr(store_module.store, "create_hub", raise_value_error)
    resp = client.post("/hubs", json={"name": "Bad Hub"})
    assert resp.status_code == 400
