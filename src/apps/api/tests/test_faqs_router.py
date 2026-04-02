"""Router tests for FAQ endpoints with mocked store calls."""

from app.main import app
from app.schemas import FaqEntry, HubMember, MembershipRole
from app.services import store as store_module

OWNER = HubMember(
    hub_id="11111111-1111-1111-1111-111111111111",
    user_id="00000000-0000-0000-0000-000000000001",
    role=MembershipRole.owner,
    accepted_at="2026-01-01T00:00:00Z",
)


def test_faq_generate_requires_editor(client, monkeypatch) -> None:
    member = HubMember(
        hub_id="11111111-1111-1111-1111-111111111111",
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.viewer,
        accepted_at="2026-01-01T00:00:00Z",
    )

    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: member)

    resp = client.post(
        "/faqs/generate",
        json={
            "hub_id": "11111111-1111-1111-1111-111111111111",
            "source_ids": ["22222222-2222-2222-2222-222222222222"],
        },
    )

    assert resp.status_code == 403


def test_faq_list_returns_entries(client, monkeypatch) -> None:
    entry = FaqEntry(
        id="faq-1",
        hub_id="11111111-1111-1111-1111-111111111111",
        question="What is Caddie?",
        answer="Answer [1]",
        citations=[{"source_id": "src-1", "snippet": "Snippet"}],
        source_ids=["src-1"],
        confidence=0.82,
        is_pinned=False,
        created_at="2026-01-01T00:00:00Z",
    )

    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: OWNER)
    monkeypatch.setattr(store_module.store, "list_faqs", lambda _client, hub_id: [entry])

    resp = client.get("/faqs", params={"hub_id": entry.hub_id})
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["question"] == "What is Caddie?"


def test_faq_patch_updates(client, monkeypatch) -> None:
    entry = FaqEntry(
        id="22222222-2222-2222-2222-222222222222",
        hub_id="11111111-1111-1111-1111-111111111111",
        question="Old question?",
        answer="Old answer [1]",
        citations=[{"source_id": "src-1", "snippet": "Snippet"}],
        source_ids=["src-1"],
        confidence=0.7,
        is_pinned=False,
        created_at="2026-01-01T00:00:00Z",
    )
    updated = entry.model_copy(update={"question": "New question?"})

    owner = HubMember(
        hub_id=entry.hub_id,
        user_id="00000000-0000-0000-0000-000000000001",
        role=MembershipRole.owner,
        accepted_at="2026-01-01T00:00:00Z",
    )

    monkeypatch.setattr(store_module.store, "get_faq", lambda _client, faq_id: entry)
    monkeypatch.setattr(store_module.store, "get_member_role", lambda _client, hub_id, user_id: owner)
    monkeypatch.setattr(store_module.store, "update_faq", lambda _client, faq_id, payload: updated)

    resp = client.patch(f"/faqs/{entry.id}", json={"question": "New question?"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["question"] == "New question?"
