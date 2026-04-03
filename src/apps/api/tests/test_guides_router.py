"""Router tests for guide endpoints with mocked store calls."""

from app.main import app
from app.schemas import GuideEntry, HubMember, MembershipRole
from app.services import store as store_module


# Verifies that guide generate requires editor.
# Endpoint behavior tests.
def test_guide_generate_requires_editor(client, monkeypatch) -> None:

    member = HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.viewer,
        accepted_at="2026-01-01T00:00:00Z",
    )

    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: member)

    resp = client.post(
        "/guides/generate",
        json={
            "hub_id": "11111111-1111-1111-1111-111111111111",
            "source_ids": ["22222222-2222-2222-2222-222222222222"],
            "topic": "Onboarding",
        },
    )

    assert resp.status_code == 403


# Verifies that guides list returns entries.
def test_guides_list_returns_entries(client, monkeypatch) -> None:
    entry = GuideEntry(
        id="guide-1",
        hub_id="11111111-1111-1111-1111-111111111111",
        title="Onboarding Guide",
        topic="Onboarding",
        summary=None,
        source_ids=["src-1"],
        created_at="2026-01-01T00:00:00Z",
        steps=[],
    )

    monkeypatch.setattr(store_module.store, "list_guides", lambda _client, user_id, hub_id: [entry])

    resp = client.get("/guides", params={"hub_id": entry.hub_id})
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["title"] == "Onboarding Guide"


# Verifies that guides patch updates.
def test_guides_patch_updates(client, monkeypatch) -> None:
    entry = GuideEntry(
        id="22222222-2222-2222-2222-222222222222",
        hub_id="11111111-1111-1111-1111-111111111111",
        title="Old title",
        topic=None,
        summary=None,
        source_ids=["src-1"],
        created_at="2026-01-01T00:00:00Z",
        steps=[],
    )
    updated = entry.model_copy(update={"title": "New title"})

    owner = HubMember(
        hub_id=entry.hub_id,
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.owner,
        accepted_at="2026-01-01T00:00:00Z",
    )

    monkeypatch.setattr(store_module.store, "get_guide", lambda _client, guide_id: entry)
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: owner)
    monkeypatch.setattr(store_module.store, "update_guide", lambda _client, guide_id, payload: updated)

    resp = client.patch(f"/guides/{entry.id}", json={"title": "New title"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "New title"


# Verifies that guide step create requires editor.
def test_guide_step_create_requires_editor(client, monkeypatch) -> None:
    entry = GuideEntry(
        id="22222222-2222-2222-2222-222222222222",
        hub_id="11111111-1111-1111-1111-111111111111",
        title="Guide",
        topic=None,
        summary=None,
        source_ids=["src-1"],
        created_at="2026-01-01T00:00:00Z",
        steps=[],
    )

    viewer = HubMember(
        hub_id=entry.hub_id,
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.viewer,
        accepted_at="2026-01-01T00:00:00Z",
    )

    monkeypatch.setattr(store_module.store, "get_guide", lambda _client, guide_id: entry)
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: viewer)

    resp = client.post(f"/guides/{entry.id}/steps", json={"instruction": "New step"})
    assert resp.status_code == 403
