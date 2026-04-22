"""Tests for shared router access helper behavior."""

import pytest
from fastapi import HTTPException

from app.routers.access import require_editor, require_owner, require_owner_or_admin
from app.schemas import HubMember, MembershipRole


def _member(role: MembershipRole) -> HubMember:
    return HubMember(hub_id="hub-1", user_id="user-1", role=role, accepted_at="2026-01-01T00:00:00Z")


def test_require_editor_allows_content_management_roles() -> None:
    for role in (MembershipRole.owner, MembershipRole.admin, MembershipRole.editor):
        require_editor(_member(role))


def test_require_editor_rejects_viewer_with_existing_message() -> None:
    with pytest.raises(HTTPException) as excinfo:
        require_editor(_member(MembershipRole.viewer))

    assert excinfo.value.status_code == 403
    assert excinfo.value.detail == "Owner, admin, or editor role required."


def test_require_owner_or_admin_preserves_route_specific_detail() -> None:
    with pytest.raises(HTTPException) as excinfo:
        require_owner_or_admin(_member(MembershipRole.viewer), detail="Only hub owners and admins can view analytics.")

    assert excinfo.value.status_code == 403
    assert excinfo.value.detail == "Only hub owners and admins can view analytics."


def test_require_owner_rejects_non_owner_with_existing_message() -> None:
    with pytest.raises(HTTPException) as excinfo:
        require_owner(_member(MembershipRole.admin))

    assert excinfo.value.status_code == 403
    assert excinfo.value.detail == "Owner role required."
