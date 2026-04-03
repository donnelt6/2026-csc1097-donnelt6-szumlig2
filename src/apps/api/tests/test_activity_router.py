"""Router tests for activity feed visibility and accepted-invite enforcement."""

from datetime import datetime

from app.schemas import ActivityEvent, Hub, HubMember, MembershipRole
from app.services import store as store_module


# Builds a hub member record used by membership-related tests.
# Test helpers and fixtures.
def _member(*, accepted: bool) -> HubMember:

    return HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="user-1",
        role=MembershipRole.viewer,
        invited_at=datetime.utcnow(),
        accepted_at=datetime.utcnow() if accepted else None,
    )


# Verifies that list activity filters to accepted hubs.
# Endpoint behavior tests.
def test_list_activity_filters_to_accepted_hubs(client, monkeypatch) -> None:

    accepted_hubs = [
        Hub(
            id="hub-1",
            owner_id="owner-1",
            name="Accepted Hub",
            description=None,
            created_at="2026-01-01T00:00:00Z",
            role=MembershipRole.viewer,
        )
    ]
    activity = [
        ActivityEvent(
            id="event-1",
            hub_id="hub-1",
            user_id="user-2",
            action="created",
            resource_type="hub",
            metadata={"name": "Accepted Hub", "actor_label": "Alice"},
            created_at="2026-01-01T01:00:00Z",
        )
    ]

    monkeypatch.setattr(store_module.store, "list_hubs", lambda _client, user_id: accepted_hubs)
    captured = {}

    # Helper used by the surrounding test code.
    def fake_list_activity(_client, user_id, hub_id=None, hub_ids=None, limit=50):
        captured["user_id"] = user_id
        captured["hub_id"] = hub_id
        captured["hub_ids"] = hub_ids
        captured["limit"] = limit
        return activity

    monkeypatch.setattr(store_module.store, "list_activity", fake_list_activity)

    resp = client.get("/activity", params={"limit": 10})

    assert resp.status_code == 200
    assert captured == {
        "user_id": "00000000-0000-0000-0000-000000000001",
        "hub_id": None,
        "hub_ids": ["hub-1"],
        "limit": 10,
    }
    assert resp.json()[0]["id"] == "event-1"


# Verifies that list activity rejects unaccepted hub filter.
def test_list_activity_rejects_unaccepted_hub_filter(client, monkeypatch) -> None:
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=False))

    resp = client.get("/activity", params={"hub_id": "11111111-1111-1111-1111-111111111111"})

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Invite not accepted yet."


# Verifies that list activity allows accepted hub filter.
def test_list_activity_allows_accepted_hub_filter(client, monkeypatch) -> None:
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(accepted=True))
    monkeypatch.setattr(
        store_module.store,
        "list_activity",
        lambda _client, user_id, hub_id=None, hub_ids=None, limit=50: [
            ActivityEvent(
                id="event-2",
                hub_id=str(hub_id),
                user_id="user-2",
                action="invited",
                resource_type="member",
                metadata={"email": "target@example.com", "role": "viewer", "actor_label": "Owner"},
                created_at="2026-01-01T01:00:00Z",
            )
        ],
    )

    resp = client.get("/activity", params={"hub_id": "11111111-1111-1111-1111-111111111111"})

    assert resp.status_code == 200
    assert resp.json()[0]["id"] == "event-2"
