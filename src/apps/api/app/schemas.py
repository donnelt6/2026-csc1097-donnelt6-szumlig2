from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class HubScope(str, Enum):
    hub = "hub"
    global_scope = "global"


class MembershipRole(str, Enum):
    owner = "owner"
    editor = "editor"
    viewer = "viewer"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Hub(BaseModel):
    id: str
    owner_id: str
    name: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    role: Optional[MembershipRole] = None
    members_count: Optional[int] = None
    sources_count: Optional[int] = None


class HubCreate(StrictModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)


class CurrentUser(BaseModel):
    id: str
    email: Optional[str] = None


class HubMember(BaseModel):
    hub_id: str
    user_id: str
    role: MembershipRole
    invited_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    email: Optional[str] = None


class HubInviteRequest(StrictModel):
    email: EmailStr
    role: MembershipRole = MembershipRole.viewer

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> EmailStr:
        return value.lower()


class HubInviteResponse(BaseModel):
    member: HubMember


class HubMemberUpdate(StrictModel):
    role: MembershipRole


class PendingInvite(BaseModel):
    hub: Hub
    role: MembershipRole
    invited_at: Optional[datetime] = None


class SourceStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    failed = "failed"
    complete = "complete"


class SourceType(str, Enum):
    file = "file"
    web = "web"


class Source(BaseModel):
    id: str
    hub_id: str
    type: SourceType = SourceType.file
    original_name: str
    storage_path: Optional[str] = None
    status: SourceStatus
    failure_reason: Optional[str] = None
    ingestion_metadata: Optional[dict] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SourceCreate(StrictModel):
    hub_id: UUID
    original_name: str = Field(..., min_length=1, max_length=255)

    @field_validator("original_name")
    @classmethod
    def validate_original_name(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("File name contains invalid characters.")
        if "/" in value or "\\" in value:
            raise ValueError("File name must not include path separators.")
        return value


class WebSourceCreate(StrictModel):
    hub_id: UUID
    url: str = Field(..., min_length=1, max_length=2000)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        lower = value.strip()
        if not lower.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return lower


class SourceEnqueueResponse(BaseModel):
    source: Source
    upload_url: str


class SourceUploadUrlResponse(BaseModel):
    upload_url: str


class SourceStatusResponse(BaseModel):
    id: str
    status: SourceStatus
    failure_reason: Optional[str] = None


class SourceFailureRequest(StrictModel):
    failure_reason: str = Field(..., min_length=1, max_length=500)


class Citation(BaseModel):
    source_id: str
    snippet: str
    chunk_index: Optional[int] = None


class ChatRequest(StrictModel):
    hub_id: UUID
    scope: HubScope = HubScope.hub
    question: str = Field(..., min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    answer: str
    citations: List[Citation] = []
    message_id: str


class ReminderStatus(str, Enum):
    scheduled = "scheduled"
    sent = "sent"
    completed = "completed"
    cancelled = "cancelled"


class ReminderCandidateStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    declined = "declined"
    expired = "expired"


class NotificationStatus(str, Enum):
    queued = "queued"
    sent = "sent"
    failed = "failed"


class NotificationChannel(str, Enum):
    in_app = "in_app"


class Reminder(BaseModel):
    id: str
    user_id: str
    hub_id: str
    source_id: Optional[str] = None
    due_at: datetime
    timezone: str
    message: Optional[str] = None
    status: ReminderStatus
    created_at: datetime = Field(default_factory=datetime.utcnow)
    sent_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class ReminderCreate(StrictModel):
    hub_id: UUID
    source_id: Optional[UUID] = None
    due_at: datetime
    timezone: str = Field(..., min_length=1, max_length=64)
    message: Optional[str] = Field(default=None, max_length=500)


class ReminderUpdateAction(str, Enum):
    complete = "complete"
    cancel = "cancel"
    snooze = "snooze"


class ReminderUpdate(StrictModel):
    due_at: Optional[datetime] = None
    timezone: Optional[str] = Field(default=None, min_length=1, max_length=64)
    message: Optional[str] = Field(default=None, max_length=500)
    action: Optional[ReminderUpdateAction] = None
    snooze_minutes: Optional[int] = Field(default=None, ge=1, le=60 * 24 * 30)


class ReminderCandidate(BaseModel):
    id: str
    hub_id: str
    source_id: str
    snippet: str
    due_at: datetime
    timezone: str
    title_suggestion: Optional[str] = None
    confidence: float
    status: ReminderCandidateStatus
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ReminderCandidateDecision(StrictModel):
    action: ReminderCandidateStatus
    edited_due_at: Optional[datetime] = None
    edited_message: Optional[str] = Field(default=None, max_length=500)
    timezone: Optional[str] = Field(default=None, min_length=1, max_length=64)


class ReminderCandidateDecisionResponse(BaseModel):
    candidate: ReminderCandidate
    reminder: Optional[Reminder] = None


class Notification(BaseModel):
    id: str
    user_id: str
    reminder_id: str
    channel: NotificationChannel
    status: NotificationStatus
    scheduled_for: datetime
    sent_at: Optional[datetime] = None
    provider_id: Optional[str] = None


class ReminderSummary(BaseModel):
    id: str
    hub_id: str
    source_id: Optional[str] = None
    due_at: datetime
    message: Optional[str] = None
    status: ReminderStatus


class NotificationEvent(BaseModel):
    id: str
    reminder_id: str
    channel: NotificationChannel
    status: NotificationStatus
    scheduled_for: datetime
    sent_at: Optional[datetime] = None
    reminder: ReminderSummary
