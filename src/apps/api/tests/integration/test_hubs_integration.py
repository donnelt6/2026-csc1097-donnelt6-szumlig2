"""Integration tests that exercise hub routes through the full FastAPI app."""

import pytest


pytestmark = pytest.mark.integration


def test_list_hubs_returns_seeded_hub(integration_client) -> None:
    response = integration_client.get("/hubs")

    assert response.status_code == 200
    payload = response.json()
    assert payload == [
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "owner_id": "00000000-0000-0000-0000-000000000001",
            "name": "Integration Hub",
            "description": "Critical path fixture hub.",
            "icon_key": "stack",
            "color_key": "slate",
            "created_at": "2026-04-10T10:00:00Z",
            "archived_at": None,
            "last_accessed_at": None,
            "role": "owner",
            "members_count": None,
            "sources_count": None,
            "is_favourite": None,
            "member_emails": None,
            "member_profiles": None,
        }
    ]
