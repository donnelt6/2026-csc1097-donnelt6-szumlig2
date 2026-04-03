"""test_analytics_router.py: Contains API tests for analytics router."""
from datetime import datetime


from app.schemas import HubMember, MembershipRole
from app.services import store as store_module


# Builds a hub member record used by membership-related tests.
# Test helpers and fixtures.
def _member(role: MembershipRole, *, accepted: bool = True) -> HubMember:

    return HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="user-1",
        role=role,
        invited_at=datetime.utcnow(),
        accepted_at=datetime.utcnow() if accepted else None,
    )


# Verifies that hub analytics summary requires owner or admin.
# Endpoint behavior tests.
def test_hub_analytics_summary_requires_owner_or_admin(client, monkeypatch) -> None:

    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(MembershipRole.viewer))

    resp = client.get("/hubs/11111111-1111-1111-1111-111111111111/analytics/summary")

    assert resp.status_code == 403
    assert "Only hub owners and admins" in resp.json()["detail"]


# Verifies that hub analytics summary success.
def test_hub_analytics_summary_success(client, monkeypatch) -> None:
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(MembershipRole.owner))
    monkeypatch.setattr(
        store_module.store,
        "get_hub_chat_analytics_summary",
        lambda hub_id, days=None: {
            "window_days": 30,
            "total_questions": 10,
            "total_answers": 10,
            "helpful_count": 6,
            "not_helpful_count": 2,
            "helpful_rate": 0.75,
            "average_citations_per_answer": 1.8,
            "citation_open_count": 4,
            "citation_open_rate": 0.4,
            "citation_flag_count": 1,
            "citation_flag_rate": 0.1,
            "average_latency_ms": 1800,
            "total_tokens": 2400,
            "rewrite_usage_rate": 0.3,
            "zero_hit_rate": 0.1,
            "top_sources": [],
        },
    )

    resp = client.get("/hubs/11111111-1111-1111-1111-111111111111/analytics/summary")

    assert resp.status_code == 200
    assert resp.json()["total_questions"] == 10


# Verifies that hub analytics trends success.
def test_hub_analytics_trends_success(client, monkeypatch) -> None:
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: _member(MembershipRole.admin))
    monkeypatch.setattr(
        store_module.store,
        "get_hub_chat_analytics_trends",
        lambda hub_id, days=None: {
            "window_days": 14,
            "points": [
                {"date": "2026-03-20", "questions": 1, "answers": 1, "helpful": 1, "citation_opens": 0, "citation_flags": 0}
            ],
        },
    )

    resp = client.get("/hubs/11111111-1111-1111-1111-111111111111/analytics/trends")

    assert resp.status_code == 200
    assert resp.json()["points"][0]["questions"] == 1
