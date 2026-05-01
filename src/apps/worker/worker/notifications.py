"""Reminder dispatch tasks and notification helpers."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from supabase import Client

from . import common as _common
from .app import settings


def dispatch_reminders() -> dict:
    # Scan both "due now" and "lead reminder" windows in one pass so beat only
    # needs a single scheduled task for reminder dispatch.
    client = _common._get_supabase_client()
    now = datetime.now(timezone.utc)
    lead_hours = max(1, settings.reminder_lead_hours)
    window = max(1, settings.reminder_dispatch_window_minutes)
    lead_start = now + timedelta(hours=lead_hours) - timedelta(minutes=window)
    lead_end = now + timedelta(hours=lead_hours) + timedelta(minutes=window)

    lead_candidates = (
        client.table("reminders")
        .select("*")
        .eq("status", "scheduled")
        .gte("due_at", lead_start.isoformat())
        .lte("due_at", lead_end.isoformat())
        .execute()
        .data
    )
    due_candidates = (
        client.table("reminders")
        .select("*")
        .eq("status", "scheduled")
        .lte("due_at", now.isoformat())
        .execute()
        .data
    )

    hub_policy_cache: dict[str, dict] = {}
    sent = 0

    for reminder in lead_candidates:
        sent += _dispatch_for_reminder(
            client,
            reminder,
            "lead",
            now,
            hub_policy_cache,
        )

    for reminder in due_candidates:
        sent += _dispatch_for_reminder(
            client,
            reminder,
            "due",
            now,
            hub_policy_cache,
        )
        _mark_reminder_sent(client, reminder["id"], now)

    return {"notifications_sent": sent}


def _dispatch_for_reminder(
    client: Client,
    reminder: dict,
    kind: str,
    now: datetime,
    hub_policy_cache: dict[str, dict],
) -> int:
    # Expand one reminder into one or more channel notifications using the
    # hub-level reminder policy and per-reminder overrides.
    hub_id = reminder.get("hub_id")
    if not hub_id:
        return 0
    policy = _get_hub_policy(client, hub_id, hub_policy_cache)
    channels = _normalize_channels(policy.get("channels"))
    if not channels:
        return 0
    due_at = _common._parse_iso(reminder.get("due_at"))
    if not due_at:
        return 0
    scheduled_for = due_at
    if kind == "lead":
        if "notify_before" in reminder and reminder["notify_before"] is None:
            return 0
        notify_before = reminder.get("notify_before")
        if notify_before is not None:
            scheduled_for = due_at - timedelta(minutes=notify_before)
        else:
            lead_hours = int(policy.get("lead_hours") or settings.reminder_lead_hours)
            scheduled_for = due_at - timedelta(hours=lead_hours)
    sent = 0
    for channel in channels:
        if _create_notification_if_needed(
            client, reminder, channel, kind, scheduled_for, now
        ):
            sent += 1
    return sent


def _create_notification_if_needed(
    client: Client,
    reminder: dict,
    channel: str,
    kind: str,
    scheduled_for: datetime,
    now: datetime,
) -> bool:
    # Use an idempotency key so overlapping beat windows do not duplicate
    # notifications for the same reminder/channel/schedule combination.
    key = f"{reminder['id']}:{kind}:{scheduled_for.isoformat()}:{channel}"
    existing = (
        client.table("notifications")
        .select("id")
        .eq("idempotency_key", key)
        .limit(1)
        .execute()
        .data
    )
    if existing:
        return False

    payload = {
        "user_id": reminder["user_id"],
        "reminder_id": reminder["id"],
        "channel": channel,
        "status": "queued",
        "scheduled_for": scheduled_for.isoformat(),
        "idempotency_key": key,
    }
    response = client.table("notifications").insert(payload).execute()
    if not response.data:
        return False
    notification_id = response.data[0]["id"]

    _update_notification(client, notification_id, "sent", now, None, None)
    return True


def _update_notification(
    client: Client,
    notification_id: str,
    status_value: str,
    now: datetime,
    provider_id: Optional[str],
    error: Optional[str],
) -> None:
    payload = {"status": status_value, "sent_at": now.isoformat(), "provider_id": provider_id, "error": error}
    client.table("notifications").update(payload).eq("id", notification_id).execute()


def _mark_reminder_sent(client: Client, reminder_id: str, now: datetime) -> None:
    # Only due-time notifications mark the reminder itself as sent; lead
    # notifications are advisory and should not complete the lifecycle.
    client.table("reminders").update({"status": "sent", "sent_at": now.isoformat()}).eq("id", reminder_id).execute()


def _get_hub_policy(client: Client, hub_id: str, cache: dict[str, dict]) -> dict:
    # Cache hub policies within one dispatch run because many reminders may
    # belong to the same hub during a beat interval.
    cached = cache.get(hub_id)
    if cached is not None:
        return cached
    response = client.table("hubs").select("reminder_policy").eq("id", hub_id).limit(1).execute()
    policy = response.data[0].get("reminder_policy") if response.data else {}
    if not isinstance(policy, dict):
        policy = {}
    if "lead_hours" not in policy:
        policy["lead_hours"] = settings.reminder_lead_hours
    cache[hub_id] = policy
    return policy


def _normalize_channels(value: Optional[list]) -> list[str]:
    # Default to in-app delivery so older hubs without explicit policy still
    # produce visible reminder notifications.
    if not value:
        return ["in_app"]
    channels: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        key = item.lower()
        if key == "in_app":
            channels.append(key)
    return channels or ["in_app"]


__all__ = [
    "dispatch_reminders",
]
