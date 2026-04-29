"""reminders.py: Manages reminders, reminder candidates, and reminder notification events."""

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import (
    NotificationEvent,
    Reminder,
    ReminderCandidate,
    ReminderCandidateDecision,
    ReminderCandidateDecisionResponse,
    ReminderCandidateStatus,
    ReminderCreate,
    ReminderStatus,
    ReminderUpdate,
    ReminderUpdateAction,
)
from ..services.store import store
from .access import require_accepted, require_hub_member
from .errors import raise_postgrest_error

router = APIRouter(prefix="/reminders", tags=["reminders"])


# Reminder routes.

# Return reminders for the current user with optional hub, status, and date filters.
@router.get(
    "",
    response_model=list[Reminder],
    dependencies=[Depends(rate_limit_user_ip("reminders:read", "rate_limit_read_per_minute"))],
)
def list_reminders(
    hub_id: Optional[UUID] = None,
    status_filter: Optional[ReminderStatus] = Query(default=None, alias="status"),
    due_from: Optional[datetime] = None,
    due_to: Optional[datetime] = None,
    source_id: Optional[UUID] = None,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[Reminder]:
    try:
        return store.list_reminders(
            client,
            current_user.id,
            hub_id=str(hub_id) if hub_id else None,
            status=status_filter.value if status_filter else None,
            due_from=due_from.isoformat() if due_from else None,
            due_to=due_to.isoformat() if due_to else None,
            source_id=str(source_id) if source_id else None,
        )
    except APIError as exc:
        raise_postgrest_error(exc)


# Create a reminder directly from user input.
@router.post(
    "",
    response_model=Reminder,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_user_ip("reminders:write", "rate_limit_write_per_minute"))],
)
def create_reminder(
    payload: ReminderCreate,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> Reminder:
    due_at = payload.due_at
    # Normalise datetimes to UTC so comparisons are consistent.
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=timezone.utc)
        payload = payload.model_copy(update={"due_at": due_at})
    if due_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reminder due time must be in the future.")
    try:
        reminder = store.create_reminder(client, current_user.id, payload)
        store.log_activity(client, reminder.hub_id, current_user.id, "created", "reminder", reminder.id, {"title": reminder.title, "message": reminder.message})
    except APIError as exc:
        raise_postgrest_error(exc)
        return  # unreachable — keeps type checker happy
    return reminder


# Update reminder status, timing, or text fields.
@router.patch(
    "/{reminder_id}",
    response_model=Reminder,
    dependencies=[Depends(rate_limit_user_ip("reminders:write", "rate_limit_write_per_minute"))],
)
def update_reminder(
    reminder_id: UUID,
    payload: ReminderUpdate,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> Reminder:
    updates: dict = {}
    now = datetime.now(timezone.utc)

    # Apply action-driven updates first (status transitions + time shifts).
    if payload.action == ReminderUpdateAction.complete:
        updates["status"] = ReminderStatus.completed.value
        updates["completed_at"] = now.isoformat()
    elif payload.action == ReminderUpdateAction.cancel:
        updates["status"] = ReminderStatus.cancelled.value
    elif payload.action == ReminderUpdateAction.reopen:
        updates["status"] = ReminderStatus.scheduled.value
        updates["completed_at"] = None
    elif payload.action == ReminderUpdateAction.snooze:
        if payload.snooze_minutes is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="snooze_minutes is required.")
        new_due = now + timedelta(minutes=payload.snooze_minutes)
        updates["due_at"] = new_due.isoformat()
        updates["status"] = ReminderStatus.scheduled.value

    # Apply explicit field edits (due time, timezone, message).
    if payload.due_at is not None:
        due_at = payload.due_at
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=timezone.utc)
        if due_at <= now:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reminder due time must be in the future.")
        updates["due_at"] = due_at.isoformat()
    if payload.timezone is not None:
        updates["timezone"] = payload.timezone
    if "color_key" in payload.model_fields_set:
        updates["color_key"] = payload.color_key
    if payload.title is not None:
        updates["title"] = payload.title
    if payload.message is not None:
        updates["message"] = payload.message
    if "notify_before" in payload.model_fields_set:
        updates["notify_before"] = payload.notify_before

    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No updates provided.")

    try:
        existing = store.get_reminder(client, str(reminder_id))
        if existing.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your reminder.")
        reminder = store.update_reminder(client, str(reminder_id), updates)
        if payload.action in (ReminderUpdateAction.complete, ReminderUpdateAction.cancel, ReminderUpdateAction.reopen):
            store.log_activity(client, reminder.hub_id, current_user.id, payload.action.value, "reminder", reminder.id, {"title": reminder.title, "message": reminder.message})
        elif payload.action is None:
            store.log_activity(client, reminder.hub_id, current_user.id, "updated", "reminder", reminder.id, {"title": reminder.title, "message": reminder.message})
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reminder not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)
        return  # unreachable — keeps type checker happy
    return reminder


# Delete one of the current user's reminders.
@router.delete(
    "/{reminder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit_user_ip("reminders:write", "rate_limit_write_per_minute"))],
)
def delete_reminder(
    reminder_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    try:
        reminder = store.get_reminder(client, str(reminder_id))
        if reminder.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your reminder.")
        store.delete_reminder(client, str(reminder_id))
        store.log_activity(client, reminder.hub_id, current_user.id, "deleted", "reminder", reminder.id, {"title": reminder.title, "message": reminder.message})
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reminder not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Return reminder candidates that were extracted from source content.
@router.get(
    "/candidates",
    response_model=list[ReminderCandidate],
    dependencies=[Depends(rate_limit_user_ip("reminders:read", "rate_limit_read_per_minute"))],
)
def list_candidates(
    hub_id: Optional[UUID] = None,
    source_id: Optional[UUID] = None,
    status_filter: Optional[ReminderCandidateStatus] = Query(default=ReminderCandidateStatus.pending, alias="status"),
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[ReminderCandidate]:
    if not hub_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="hub_id is required.")
    member = require_hub_member(client, str(hub_id), current_user.id)
    require_accepted(member)
    try:
        return store.list_candidates(
            client,
            hub_id=str(hub_id),
            source_id=str(source_id) if source_id else None,
            status=status_filter.value if status_filter else None,
        )
    except APIError as exc:
        raise_postgrest_error(exc)


# Accept or decline a reminder candidate and optionally create a real reminder.
@router.patch(
    "/candidates/{candidate_id}",
    response_model=ReminderCandidateDecisionResponse,
    dependencies=[Depends(rate_limit_user_ip("reminders:write", "rate_limit_write_per_minute"))],
)
def decide_candidate(
    candidate_id: UUID,
    decision: ReminderCandidateDecision,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReminderCandidateDecisionResponse:
    # Load candidate and ensure it's still pending.
    try:
        candidate = store.get_candidate(client, str(candidate_id))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)

    # Verify the caller is an accepted member of the candidate's hub.
    member = require_hub_member(client, candidate.hub_id, current_user.id)
    require_accepted(member)

    if candidate.status != ReminderCandidateStatus.pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Candidate already reviewed.")
    if decision.action not in (ReminderCandidateStatus.accepted, ReminderCandidateStatus.declined):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid candidate action.")

    review_payload = {
        "status": decision.action.value,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_by": current_user.id,
    }

    # For accepted candidates, create a scheduled reminder tied to the source.
    reminder: Optional[Reminder] = None
    if decision.action == ReminderCandidateStatus.accepted:
        due_at = decision.edited_due_at or candidate.due_at
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=timezone.utc)
        if due_at <= datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reminder due time must be in the future.")
        message = decision.edited_message or _auto_message(candidate) or "Reminder from Caddie"
        timezone_value = decision.timezone or candidate.timezone
        create_payload = ReminderCreate(
            hub_id=UUID(candidate.hub_id),
            source_id=UUID(candidate.source_id),
            due_at=due_at,
            timezone=timezone_value,
            message=message,
        )
        reminder = store.create_reminder(client, current_user.id, create_payload)
        store.log_activity(client, reminder.hub_id, current_user.id, "created", "reminder", reminder.id, {"title": reminder.title, "message": reminder.message})

    # Persist review status and user feedback (accept/decline edits).
    try:
        candidate = store.update_candidate(client, str(candidate_id), review_payload)
        store.create_candidate_feedback(client, str(candidate_id), current_user.id, decision)
    except APIError as exc:
        raise_postgrest_error(exc)

    return ReminderCandidateDecisionResponse(candidate=candidate, reminder=reminder)


# Return reminder notification events for the current user.
@router.get(
    "/notifications",
    response_model=list[NotificationEvent],
    dependencies=[Depends(rate_limit_user_ip("reminders:read", "rate_limit_read_per_minute"))],
)
def list_notifications(
    reminder_id: Optional[UUID] = None,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[NotificationEvent]:
    try:
        return store.list_notifications(client, current_user.id, str(reminder_id) if reminder_id else None)
    except APIError as exc:
        raise_postgrest_error(exc)

# Mark a reminder notification as dismissed.
@router.post(
    "/notifications/{notification_id}/dismiss",
    response_model=NotificationEvent,
    dependencies=[Depends(rate_limit_user_ip("reminders:write", "rate_limit_write_per_minute"))],
)
def dismiss_notification(
    notification_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> NotificationEvent:
    try:
        return store.dismiss_notification(client, current_user.id, str(notification_id))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found") from exc
    except APIError as exc:
        raise_postgrest_error(exc)


# Build a fallback reminder message from candidate text when the user does not provide one.
def _auto_message(candidate: ReminderCandidate) -> str:
    source = candidate.snippet or candidate.title_suggestion or ""
    cleaned = " ".join(source.split()).strip()
    if len(cleaned) > 220:
        cleaned = f"{cleaned[:217].rstrip()}..."
    return cleaned
