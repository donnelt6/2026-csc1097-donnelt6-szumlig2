"""Router tests for reminders endpoints with mocked store calls."""

from datetime import datetime, timedelta, timezone

from app.schemas import (
    NotificationEvent,
    NotificationStatus,
    Reminder,
    ReminderCandidate,
    ReminderCandidateStatus,
    ReminderStatus,
    ReminderSummary,
)
from app.services import store as store_module


def test_list_reminders_returns_reminders(client, monkeypatch) -> None:
    reminder = Reminder(
        id="rem-1",
        user_id="00000000-0000-0000-0000-000000000001",
        hub_id="11111111-1111-1111-1111-111111111111",
        due_at=datetime.now(timezone.utc) + timedelta(days=1),
        timezone="UTC",
        status=ReminderStatus.scheduled,
    )
    monkeypatch.setattr(store_module.store, "list_reminders", lambda _client, user_id, **_: [reminder])

    resp = client.get("/reminders?hub_id=11111111-1111-1111-1111-111111111111")
    assert resp.status_code == 200
    assert resp.json()[0]["id"] == "rem-1"


def test_create_reminder_rejects_past_due(client) -> None:
    resp = client.post(
        "/reminders",
        json={
            "hub_id": "11111111-1111-1111-1111-111111111111",
            "due_at": "2000-01-01T00:00:00Z",
            "timezone": "UTC",
            "message": "past",
        },
    )
    assert resp.status_code == 400


def test_update_reminder_requires_snooze_minutes(client) -> None:
    resp = client.patch(
        "/reminders/11111111-1111-1111-1111-111111111111",
        json={"action": "snooze"},
    )
    assert resp.status_code == 400


def test_accept_candidate_creates_reminder(client, monkeypatch) -> None:
    candidate = ReminderCandidate(
        id="22222222-2222-2222-2222-222222222222",
        hub_id="11111111-1111-1111-1111-111111111111",
        source_id="33333333-3333-3333-3333-333333333333",
        snippet="Submit the form by 1 March 2026.",
        due_at=datetime.now(timezone.utc) + timedelta(days=10),
        timezone="UTC",
        confidence=0.8,
        status=ReminderCandidateStatus.pending,
    )
    reminder = Reminder(
        id="rem-2",
        user_id="00000000-0000-0000-0000-000000000001",
        hub_id=candidate.hub_id,
        source_id=candidate.source_id,
        due_at=candidate.due_at,
        timezone="UTC",
        status=ReminderStatus.scheduled,
    )

    monkeypatch.setattr(store_module.store, "get_candidate", lambda _client, candidate_id: candidate)
    monkeypatch.setattr(store_module.store, "create_reminder", lambda _client, user_id, payload: reminder)
    monkeypatch.setattr(store_module.store, "update_candidate", lambda _client, candidate_id, payload: candidate)
    monkeypatch.setattr(store_module.store, "create_candidate_feedback", lambda *_args, **_kwargs: None)

    resp = client.patch(
        "/reminders/candidates/22222222-2222-2222-2222-222222222222",
        json={"action": "accepted"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["reminder"]["id"] == "rem-2"


def test_dismiss_notification_returns_notification(client, monkeypatch) -> None:
    due_at = datetime.now(timezone.utc) + timedelta(days=1)
    notification = NotificationEvent(
        id="44444444-4444-4444-4444-444444444444",
        reminder_id="55555555-5555-5555-5555-555555555555",
        channel="in_app",
        status=NotificationStatus.sent,
        scheduled_for=due_at,
        sent_at=due_at,
        dismissed_at=due_at,
        reminder=ReminderSummary(
            id="55555555-5555-5555-5555-555555555555",
            hub_id="11111111-1111-1111-1111-111111111111",
            source_id=None,
            due_at=due_at,
            message="Submit project",
            status=ReminderStatus.scheduled,
        ),
    )
    monkeypatch.setattr(store_module.store, "dismiss_notification", lambda _client, user_id, notification_id: notification)

    resp = client.post("/reminders/notifications/44444444-4444-4444-4444-444444444444/dismiss")

    assert resp.status_code == 200
    assert resp.json()["id"] == notification.id
