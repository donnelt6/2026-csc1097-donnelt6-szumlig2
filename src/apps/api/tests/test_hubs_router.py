"""Router tests for hubs endpoints using monkeypatched store calls."""

from app.schemas import Hub, MembershipRole
from app.services import store as store_module


def test_list_hubs_returns_hubs(client, monkeypatch) -> None:
    # Mocks list_hubs; expect /hubs returns the mocked hub list.
    hub = Hub(
        id="hub-1",
        owner_id="user-1",
        name="Alpha",
        description="Test",
        icon_key="stack",
        color_key="slate",
        role=MembershipRole.owner,
    )
    monkeypatch.setattr(store_module.store, "list_hubs", lambda _client, user_id: [hub])

    resp = client.get("/hubs")
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["id"] == "hub-1"
    assert data[0]["role"] == "owner"
    assert data[0]["icon_key"] == "stack"
    assert data[0]["color_key"] == "slate"


def test_create_hub_returns_hub(client, monkeypatch) -> None:
    # Mocks create_hub; expect 201 and returned hub payload.
    hub = Hub(
        id="hub-2",
        owner_id="user-1",
        name="New Hub",
        description=None,
        icon_key="rocket",
        color_key="blue",
        role=MembershipRole.owner,
    )
    monkeypatch.setattr(store_module.store, "create_hub", lambda _client, user_id, payload: hub)

    resp = client.post("/hubs", json={"name": "New Hub", "icon_key": "rocket", "color_key": "blue"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] == "hub-2"
    assert data["name"] == "New Hub"
    assert data["icon_key"] == "rocket"
    assert data["color_key"] == "blue"


def test_create_hub_handles_value_error(client, monkeypatch) -> None:
    # Forces ValueError in store; expect 400 response.
    def raise_value_error(_client, user_id, payload):
        raise ValueError("bad")

    monkeypatch.setattr(store_module.store, "create_hub", raise_value_error)
    resp = client.post("/hubs", json={"name": "Bad Hub"})
    assert resp.status_code == 400


def test_create_hub_rejects_invalid_appearance_keys(client) -> None:
    resp = client.post("/hubs", json={"name": "Bad Hub", "icon_key": "bad-icon", "color_key": "blue"})
    assert resp.status_code == 400


def test_update_hub_returns_updated_hub(client, monkeypatch) -> None:
    hub = Hub(
        id="hub-2",
        owner_id="user-1",
        name="New Hub",
        description=None,
        icon_key="sparkles",
        color_key="pink",
        role=MembershipRole.owner,
    )
    monkeypatch.setattr(store_module.store, "update_hub", lambda _client, hub_id, payload: hub)

    resp = client.patch("/hubs/hub-2", json={"icon_key": "sparkles", "color_key": "pink"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["icon_key"] == "sparkles"
    assert data["color_key"] == "pink"


def test_update_hub_rejects_invalid_appearance_keys(client) -> None:
    resp = client.patch("/hubs/hub-2", json={"icon_key": "bad-icon"})
    assert resp.status_code == 400


def test_archive_hub_returns_archived_hub(client, monkeypatch) -> None:
    hub = Hub(
        id="hub-2",
        owner_id="user-1",
        name="New Hub",
        description=None,
        icon_key="sparkles",
        color_key="pink",
        role=MembershipRole.owner,
        archived_at="2026-03-24T12:00:00Z",
    )
    monkeypatch.setattr(store_module.store, "archive_hub", lambda _client, hub_id: hub)

    resp = client.post("/hubs/hub-2/archive")
    assert resp.status_code == 200
    data = resp.json()
    assert data["archived_at"] == "2026-03-24T12:00:00Z"


def test_unarchive_hub_returns_unarchived_hub(client, monkeypatch) -> None:
    hub = Hub(
        id="hub-2",
        owner_id="user-1",
        name="New Hub",
        description=None,
        icon_key="sparkles",
        color_key="pink",
        role=MembershipRole.owner,
        archived_at=None,
    )
    monkeypatch.setattr(store_module.store, "unarchive_hub", lambda _client, hub_id: hub)

    resp = client.post("/hubs/hub-2/unarchive")
    assert resp.status_code == 200
    data = resp.json()
    assert data["archived_at"] is None
