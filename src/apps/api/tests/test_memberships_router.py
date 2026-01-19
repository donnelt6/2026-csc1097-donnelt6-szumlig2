"""Router tests for membership and invite flows with mocked store calls."""

from datetime import datetime

from app.routers import memberships as memberships_router
from app.schemas import HubMember, HubMemberUpdate, HubInviteRequest, MembershipRole
from app.services import store as store_module


def test_list_members_requires_accepted_invite(client, monkeypatch) -> None:
    # Mocks a pending member; expect 403 for unaccepted invite.
    member = HubMember(hub_id="hub-1", user_id="user-1", role=MembershipRole.viewer, accepted_at=None)
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: member)

    resp = client.get("/hubs/hub-1/members")
    assert resp.status_code == 403


def test_list_members_returns_members_for_owner(client, monkeypatch) -> None:
    # Mocks owner role; expect list of members returned.
    owner = HubMember(
        hub_id="hub-1",
        user_id="user-1",
        role=MembershipRole.owner,
        accepted_at=datetime.utcnow(),
    )
    members = [
        owner,
        HubMember(
            hub_id="hub-1",
            user_id="user-2",
            role=MembershipRole.viewer,
            accepted_at=datetime.utcnow(),
        ),
    ]
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: owner)
    monkeypatch.setattr(store_module.store, "list_members", lambda _client, hub_id, include_pending: members)
    monkeypatch.setattr(memberships_router, "_attach_emails", lambda items: items)

    resp = client.get("/hubs/hub-1/members")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_invite_member_blocks_self_invite(client) -> None:
    # Uses current user's email; expect 400 to prevent self-invite.
    resp = client.post(
        "/hubs/hub-1/members/invite",
        json={"email": "user@example.com", "role": "viewer"},
    )
    assert resp.status_code == 400


def test_invite_member_requires_owner(client, monkeypatch) -> None:
    # Mocks viewer role; expect 403 when inviting without owner role.
    member = HubMember(
        hub_id="hub-1",
        user_id="user-1",
        role=MembershipRole.viewer,
        accepted_at=datetime.utcnow(),
    )
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: member)

    resp = client.post(
        "/hubs/hub-1/members/invite",
        json={"email": "other@example.com", "role": "viewer"},
    )
    assert resp.status_code == 403
