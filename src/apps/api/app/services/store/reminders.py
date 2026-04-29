"""ReminderStoreMixin: manages reminders, reminder candidates, and in-app reminder notifications."""

from datetime import datetime, timezone
from typing import List, Optional

from supabase import Client

from ...schemas import (
    NotificationEvent,
    Reminder,
    ReminderCandidate,
    ReminderCandidateDecision,
    ReminderCreate,
    ReminderStatus,
    ReminderSummary,
)


class ReminderStoreMixin:
    # Return reminders for the current user with optional hub, status, source, and date filters.
    def list_reminders(
        self,
        client: Client,
        user_id: str,
        hub_id: Optional[str] = None,
        status: Optional[str] = None,
        due_from: Optional[str] = None,
        due_to: Optional[str] = None,
        source_id: Optional[str] = None,
    ) -> List[Reminder]:
        query = client.table("reminders").select("*").eq("user_id", user_id)
        if hub_id:
            query = query.eq("hub_id", hub_id)
        if status:
            query = query.eq("status", status)
        if source_id:
            query = query.eq("source_id", source_id)
        if due_from:
            query = query.gte("due_at", due_from)
        if due_to:
            query = query.lte("due_at", due_to)
        response = query.order("due_at").execute()
        return [Reminder(**row) for row in response.data]

    # Create a scheduled reminder from the API payload.
    def create_reminder(self, client: Client, user_id: str, payload: ReminderCreate) -> Reminder:
        response = (
            client.table("reminders")
            .insert(
                {
                    "user_id": user_id,
                    "hub_id": str(payload.hub_id),
                    "source_id": str(payload.source_id) if payload.source_id else None,
                    "color_key": payload.color_key or "slate",
                    "due_at": payload.due_at.isoformat(),
                    "timezone": payload.timezone,
                    "title": payload.title,
                    "message": payload.message,
                    "notify_before": payload.notify_before,
                    "status": ReminderStatus.scheduled.value,
                }
            )
            .execute()
        )
        return Reminder(**response.data[0])

    # Apply partial updates to one reminder and return the updated row.
    def update_reminder(self, client: Client, reminder_id: str, payload: dict) -> Reminder:
        response = client.table("reminders").update(payload).eq("id", reminder_id).execute()
        if not response.data:
            raise KeyError("Reminder not found")
        return Reminder(**response.data[0])

    # Fetch one reminder by id.
    def get_reminder(self, client: Client, reminder_id: str) -> Reminder:
        response = client.table("reminders").select("*").eq("id", reminder_id).execute()
        if not response.data:
            raise KeyError("Reminder not found")
        return Reminder(**response.data[0])

    # Delete one reminder by id.
    def delete_reminder(self, client: Client, reminder_id: str) -> None:
        response = client.table("reminders").delete().eq("id", reminder_id).execute()
        if not response.data:
            raise KeyError("Reminder not found")

    # List generated reminder candidates, optionally filtered by hub, source, or status.
    def list_candidates(
        self,
        client: Client,
        hub_id: Optional[str] = None,
        source_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[ReminderCandidate]:
        query = client.table("reminder_candidates").select("*")
        if hub_id:
            query = query.eq("hub_id", hub_id)
        if source_id:
            query = query.eq("source_id", source_id)
        if status:
            query = query.eq("status", status)
        response = query.order("created_at", desc=True).execute()
        return [ReminderCandidate(**row) for row in response.data]

    # Fetch one reminder candidate by id.
    def get_candidate(self, client: Client, candidate_id: str) -> ReminderCandidate:
        response = client.table("reminder_candidates").select("*").eq("id", candidate_id).limit(1).execute()
        if not response.data:
            raise KeyError("Candidate not found")
        return ReminderCandidate(**response.data[0])

    # Apply a partial update to a reminder candidate.
    def update_candidate(self, client: Client, candidate_id: str, payload: dict) -> ReminderCandidate:
        response = client.table("reminder_candidates").update(payload).eq("id", candidate_id).execute()
        if not response.data:
            raise KeyError("Candidate not found")
        return ReminderCandidate(**response.data[0])

    # Record how a user handled a generated reminder candidate.
    def create_candidate_feedback(
        self,
        client: Client,
        candidate_id: str,
        user_id: str,
        decision: ReminderCandidateDecision,
    ) -> None:
        client.table("reminder_feedback").insert(
            {
                "candidate_id": candidate_id,
                "user_id": user_id,
                "action": decision.action.value,
                "edited_due_at": decision.edited_due_at.isoformat() if decision.edited_due_at else None,
                "edited_message": decision.edited_message,
            }
        ).execute()

    # Return active in-app reminder notifications and hydrate the embedded reminder summary.
    def list_notifications(self, client: Client, user_id: str, reminder_id: Optional[str] = None) -> List[NotificationEvent]:
        select = "id, reminder_id, channel, status, scheduled_for, sent_at, dismissed_at, reminders (id, hub_id, source_id, color_key, due_at, message, status, hubs (name))"
        query = (
            client.table("notifications")
            .select(select)
            .eq("user_id", user_id)
            .is_("dismissed_at", "null")
            .not_.in_("reminders.status", [ReminderStatus.completed.value, ReminderStatus.cancelled.value])
        )
        if reminder_id:
            query = query.eq("reminder_id", reminder_id)
        response = query.order("scheduled_for", desc=True).execute()
        events: List[NotificationEvent] = []
        for row in response.data:
            reminder_row = row.get("reminders") or {}
            if isinstance(reminder_row, list):
                reminder_row = reminder_row[0] if reminder_row else {}
            if not reminder_row or row.get("channel") != "in_app":
                continue
            hub_row = reminder_row.get("hubs") or {}
            if isinstance(hub_row, list):
                hub_row = hub_row[0] if hub_row else {}
            events.append(
                NotificationEvent(
                    id=row["id"],
                    reminder_id=row["reminder_id"],
                    channel=row["channel"],
                    status=row["status"],
                    scheduled_for=row["scheduled_for"],
                    sent_at=row.get("sent_at"),
                    dismissed_at=row.get("dismissed_at"),
                    reminder=ReminderSummary(**{**reminder_row, "hub_name": hub_row.get("name")}),
                )
            )
        return events

    # Dismiss an in-app notification and return the refreshed notification payload.
    def dismiss_notification(self, client: Client, user_id: str, notification_id: str) -> NotificationEvent:
        now = datetime.now(timezone.utc).isoformat()
        response = (
            client.table("notifications")
            .update({"dismissed_at": now})
            .eq("id", notification_id)
            .eq("user_id", user_id)
            .is_("dismissed_at", "null")
            .execute()
        )
        if not response.data:
            raise KeyError("Notification not found")
        reminder_response = (
            client.table("notifications")
            .select("id, reminder_id, channel, status, scheduled_for, sent_at, dismissed_at, reminders (id, hub_id, source_id, color_key, due_at, message, status, hubs (name))")
            .eq("id", notification_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not reminder_response.data:
            raise KeyError("Notification not found")
        row = reminder_response.data[0]
        reminder_row = row.get("reminders") or {}
        if isinstance(reminder_row, list):
            reminder_row = reminder_row[0] if reminder_row else {}
        if not reminder_row:
            raise KeyError("Notification reminder not found")
        hub_row = reminder_row.get("hubs") or {}
        if isinstance(hub_row, list):
            hub_row = hub_row[0] if hub_row else {}
        return NotificationEvent(
            id=row["id"],
            reminder_id=row["reminder_id"],
            channel=row["channel"],
            status=row["status"],
            scheduled_for=row["scheduled_for"],
            sent_at=row.get("sent_at"),
            dismissed_at=row.get("dismissed_at"),
            reminder=ReminderSummary(**{**reminder_row, "hub_name": hub_row.get("name")}),
        )
