"""Router tests for membership and invite flows with mocked store calls."""

from datetime import datetime

from app.routers import memberships as memberships_router
from app.schemas import HubMember, MembershipRole, UserProfileSummary
from app.services import store as store_module


def test_list_members_requires_accepted_invite(client, monkeypatch) -> None:
    # Mocks a pending member; expect 403 for unaccepted invite.
    member = HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.viewer,
        accepted_at=None,
    )
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: member)

    resp = client.get("/hubs/11111111-1111-1111-1111-111111111111/members")
    assert resp.status_code == 403


def test_list_members_returns_members_for_owner(client, monkeypatch) -> None:
    # Mocks owner role; expect list of members returned.
    owner = HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.owner,
        accepted_at=datetime.utcnow(),
    )
    members = [
        owner,
        HubMember(
            hub_id="11111111-1111-1111-1111-111111111111",
            user_id="00000000-0000-0000-0000-000000000002",
            role=MembershipRole.viewer,
            accepted_at=datetime.utcnow(),
        ),
    ]
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: owner)
    monkeypatch.setattr(store_module.store, "list_members", lambda _client, hub_id, include_pending: members)
    monkeypatch.setattr(memberships_router, "_attach_profiles", lambda items: items)

    resp = client.get("/hubs/11111111-1111-1111-1111-111111111111/members")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_attach_profiles_includes_metadata_fields(client, monkeypatch) -> None:
    owner = HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.owner,
        accepted_at=datetime.utcnow(),
    )
    members = [owner]
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: owner)
    monkeypatch.setattr(store_module.store, "list_members", lambda _client, hub_id, include_pending: members)
    monkeypatch.setattr(
        store_module.store,
        "_resolve_user_profiles_by_ids",
        lambda user_ids: {
            "00000000-0000-0000-0000-000000000001": UserProfileSummary(
                user_id="00000000-0000-0000-0000-000000000001",
                email="owner@example.com",
                display_name="Owner Name",
                avatar_mode="preset",
                avatar_key="rocket",
                avatar_color=None,
            )
        },
    )

    resp = client.get("/hubs/11111111-1111-1111-1111-111111111111/members")

    assert resp.status_code == 200
    payload = resp.json()[0]
    assert payload["display_name"] == "Owner Name"
    assert payload["avatar_mode"] == "preset"
    assert payload["avatar_key"] == "rocket"


def test_invite_member_blocks_self_invite(client) -> None:
    # Uses current user's email; expect 400 to prevent self-invite.
    resp = client.post(
        "/hubs/11111111-1111-1111-1111-111111111111/members/invite",
        json={"email": "user@example.com", "role": "viewer"},
    )
    assert resp.status_code == 400


def test_invite_member_requires_owner(client, monkeypatch) -> None:
    # Mocks viewer role; expect 403 when inviting without owner role.
    member = HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.viewer,
        accepted_at=datetime.utcnow(),
    )
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: member)

    resp = client.post(
        "/hubs/11111111-1111-1111-1111-111111111111/members/invite",
        json={"email": "other@example.com", "role": "viewer"},
    )
    assert resp.status_code == 403


def test_update_member_role_rejects_owner_assignment(client) -> None:
    resp = client.patch(
        "/hubs/11111111-1111-1111-1111-111111111111/members/00000000-0000-0000-0000-000000000002",
        json={"role": "owner"},
    )
    assert resp.status_code == 422


def test_update_member_role_rejects_direct_owner_change(client, monkeypatch) -> None:
    owner = HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.owner,
        accepted_at=datetime.utcnow(),
    )
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: owner)
    monkeypatch.setattr(
        store_module.store,
        "update_member_role",
        lambda _client, _hub_id, _user_id, _role: (_ for _ in ()).throw(
            ValueError("Transfer ownership before removing or changing the owner.")
        ),
    )

    resp = client.patch(
        "/hubs/11111111-1111-1111-1111-111111111111/members/00000000-0000-0000-0000-000000000001",
        json={"role": "admin"},
    )

    assert resp.status_code == 400


def test_remove_member_rejects_direct_owner_removal(client, monkeypatch) -> None:
    owner = HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.owner,
        accepted_at=datetime.utcnow(),
    )
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: owner)
    monkeypatch.setattr(
        store_module.store,
        "remove_member",
        lambda _client, _hub_id, _user_id: (_ for _ in ()).throw(
            ValueError("Transfer ownership before removing or changing the owner.")
        ),
    )

    resp = client.delete(
        "/hubs/11111111-1111-1111-1111-111111111111/members/00000000-0000-0000-0000-000000000001"
    )

    assert resp.status_code == 400


def test_transfer_ownership_requires_admin_target(client, monkeypatch) -> None:
    owner = HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.owner,
        accepted_at=datetime.utcnow(),
    )
    viewer = HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="00000000-0000-0000-0000-000000000002",
        role=MembershipRole.viewer,
        accepted_at=datetime.utcnow(),
    )
    monkeypatch.setattr(
        store_module.store,
        "get_member_role",
        lambda _client, hub_id, user_id: owner if str(user_id).endswith("1") else viewer,
    )

    resp = client.post(
        "/hubs/11111111-1111-1111-1111-111111111111/members/00000000-0000-0000-0000-000000000002/transfer-ownership",
    )

    assert resp.status_code == 400
