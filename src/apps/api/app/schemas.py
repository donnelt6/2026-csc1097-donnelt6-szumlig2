from datetime import datetime
from enum import Enum
from typing import List, Optional
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

HUB_ICON_KEYS = {
    "stack",
    "book",
    "chat",
    "cap",
    "briefcase",
    "beaker",
    "folder",
    "rocket",
    "globe",
    "bolt",
    "sparkles",
    "shield",
}

HUB_COLOR_KEYS = {
    "slate",
    "violet",
    "cyan",
    "blue",
    "emerald",
    "amber",
    "rose",
    "orange",
    "pink",
    "indigo",
    "teal",
    "red",
}

DEFAULT_HUB_ICON_KEY = "stack"
DEFAULT_HUB_COLOR_KEY = "slate"


class HubScope(str, Enum):
    hub = "hub"
    global_scope = "global"


class MembershipRole(str, Enum):
    owner = "owner"
    admin = "admin"
    editor = "editor"
    viewer = "viewer"


class AssignableMembershipRole(str, Enum):
    admin = "admin"
    editor = "editor"
    viewer = "viewer"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _trim_and_reject_blank(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("Value cannot be blank.")
    return trimmed


class Hub(BaseModel):
    id: str
    owner_id: str
    name: str
    description: Optional[str] = None
    icon_key: Optional[str] = None
    color_key: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    archived_at: Optional[datetime] = None
    last_accessed_at: Optional[datetime] = None
    role: Optional[MembershipRole] = None
    members_count: Optional[int] = None
    sources_count: Optional[int] = None
    is_favourite: Optional[bool] = None
    member_emails: Optional[List[str]] = None


class HubCreate(StrictModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    icon_key: Optional[str] = Field(default=None)
    color_key: Optional[str] = Field(default=None)


class HubUpdate(StrictModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    icon_key: Optional[str] = Field(default=None)
    color_key: Optional[str] = Field(default=None)

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value: Optional[str]) -> Optional[str]:
        return _trim_and_reject_blank(value)


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
    role: AssignableMembershipRole = AssignableMembershipRole.viewer

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> EmailStr:
        return value.lower()


class HubInviteResponse(BaseModel):
    member: HubMember


class HubMemberUpdate(StrictModel):
    role: AssignableMembershipRole


class HubFavouriteToggle(StrictModel):
    is_favourite: bool


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
    youtube = "youtube"


class SourceSuggestionType(str, Enum):
    web = "web"
    youtube = "youtube"


class SourceSuggestionStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    declined = "declined"


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


class YouTubeSourceCreate(StrictModel):
    hub_id: UUID
    url: str = Field(..., min_length=1, max_length=2000)
    language: Optional[str] = Field(default=None, min_length=2, max_length=16)
    allow_auto_captions: bool = False

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        lower = value.strip()
        if not lower.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        parsed = urlparse(lower)
        host = (parsed.hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        if not host:
            raise ValueError("URL must include a host")
        if host == "youtu.be" or host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
            return lower
        raise ValueError("URL must be a YouTube domain")

    @field_validator("language")
    @classmethod
    def normalize_language(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        return cleaned


class SourceEnqueueResponse(BaseModel):
    source: Source
    upload_url: str


class SourceUploadUrlResponse(BaseModel):
    upload_url: str


class SourceStatusResponse(BaseModel):
    id: str
    status: SourceStatus
    failure_reason: Optional[str] = None


class SourceChunk(BaseModel):
    chunk_index: int
    text: str


class SourceFailureRequest(StrictModel):
    failure_reason: str = Field(..., min_length=1, max_length=500)


class SourceSuggestion(BaseModel):
    id: str
    hub_id: str
    type: SourceSuggestionType
    status: SourceSuggestionStatus
    url: str
    canonical_url: Optional[str] = None
    video_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    rationale: Optional[str] = None
    confidence: float
    seed_source_ids: List[str] = Field(default_factory=list)
    search_metadata: Optional[dict] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None
    accepted_source_id: Optional[str] = None


class SourceSuggestionDecision(StrictModel):
    action: SourceSuggestionStatus


class SourceSuggestionDecisionResponse(BaseModel):
    suggestion: SourceSuggestion
    source: Optional[Source] = None


class Citation(BaseModel):
    source_id: str
    snippet: str
    chunk_index: Optional[int] = None
    relevant_quotes: Optional[List[str]] = None
    paraphrased_quotes: Optional[List[str]] = None


class ChatRequest(StrictModel):
    hub_id: UUID
    scope: HubScope = HubScope.hub
    question: str = Field(..., min_length=1, max_length=4000)
    source_ids: Optional[List[UUID]] = None
    session_id: Optional[UUID] = None


class ChatResponse(BaseModel):
    answer: str
    citations: List[Citation] = Field(default_factory=list)
    message_id: str
    session_id: str
    session_title: str
    active_flag_id: Optional[str] = None
    flag_status: str = "none"


class HistoryMessage(BaseModel):
    role: str
    content: str
    citations: List[Citation] = Field(default_factory=list)
    created_at: str
    active_flag_id: Optional[str] = None
    flag_status: str = "none"


class ChatSessionSummary(BaseModel):
    id: str
    hub_id: str
    title: str
    scope: HubScope
    source_ids: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_message_at: datetime = Field(default_factory=datetime.utcnow)


class SessionMessage(BaseModel):
    id: str
    role: str
    content: str
    citations: List[Citation] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    active_flag_id: Optional[str] = None
    flag_status: str = "none"


class ChatSessionDetail(BaseModel):
    session: ChatSessionSummary
    messages: List[SessionMessage] = Field(default_factory=list)


class MessageFlagStatus(str, Enum):
    none = "none"
    open = "open"
    in_review = "in_review"
    resolved = "resolved"
    dismissed = "dismissed"


class FlagCaseStatus(str, Enum):
    open = "open"
    in_review = "in_review"
    resolved = "resolved"
    dismissed = "dismissed"


class FlagReason(str, Enum):
    incorrect = "incorrect"
    unsupported = "unsupported"
    harmful = "harmful"
    outdated = "outdated"
    other = "other"


class MessageRevisionType(str, Enum):
    original = "original"
    regenerated = "regenerated"
    manual_edit = "manual_edit"


class FlagMessageRequest(StrictModel):
    reason: FlagReason
    notes: Optional[str] = Field(default=None, max_length=1000)


class FlagCase(BaseModel):
    id: str
    hub_id: str
    session_id: str
    message_id: str
    created_by: str
    reason: FlagReason
    notes: Optional[str] = None
    status: FlagCaseStatus
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    resolved_revision_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class FlagMessageResponse(BaseModel):
    flag_case: FlagCase
    created: bool


class MessageRevision(BaseModel):
    id: str
    message_id: str
    flag_case_id: str
    revision_type: MessageRevisionType
    content: str
    citations: List[Citation] = Field(default_factory=list)
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    applied_at: Optional[datetime] = None


class CreateRevisionRequest(StrictModel):
    content: str = Field(..., min_length=1, max_length=12000)
    citations: List[Citation] = Field(default_factory=list)


class ApplyRevisionRequest(StrictModel):
    revision_id: UUID


class FlaggedChatQueueItem(BaseModel):
    id: str
    hub_id: str
    hub_name: str
    session_id: str
    session_title: str
    message_id: str
    question_preview: str
    answer_preview: str
    reason: FlagReason
    status: FlagCaseStatus
    flagged_at: datetime = Field(default_factory=datetime.utcnow)
    reviewed_at: Optional[datetime] = None


class FlaggedChatDetail(BaseModel):
    case: FlagCase
    hub_name: str
    session_title: str
    question_message: SessionMessage
    flagged_message: SessionMessage
    revisions: List[MessageRevision] = Field(default_factory=list)


class ChatSessionRenameRequest(StrictModel):
    title: str = Field(..., min_length=1, max_length=80)

    @field_validator("title", mode="before")
    @classmethod
    def validate_title(cls, value: str) -> str:
        trimmed = _trim_and_reject_blank(value)
        assert trimmed is not None
        return trimmed


class FaqEntry(BaseModel):
    id: str
    hub_id: str
    question: str
    answer: str
    citations: List[Citation] = Field(default_factory=list)
    source_ids: List[str] = Field(default_factory=list)
    confidence: float
    is_pinned: bool = False
    archived_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    created_by: Optional[str] = None
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None
    generation_batch_id: Optional[str] = None


class FaqGenerateRequest(StrictModel):
    hub_id: UUID
    source_ids: List[UUID]
    count: Optional[int] = Field(default=None, ge=1, le=20)


class FaqGenerateResponse(BaseModel):
    entries: List[FaqEntry] = Field(default_factory=list)


class FaqUpdateRequest(StrictModel):
    question: Optional[str] = Field(default=None, min_length=1, max_length=4000)
    answer: Optional[str] = Field(default=None, min_length=1, max_length=8000)
    is_pinned: Optional[bool] = None
    archived: Optional[bool] = None


class GuideStep(BaseModel):
    id: str
    guide_id: str
    step_index: int
    title: Optional[str] = None
    instruction: str
    citations: List[Citation] = Field(default_factory=list)
    confidence: float
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = None


class GuideStepWithProgress(GuideStep):
    is_complete: bool = False
    completed_at: Optional[datetime] = None


class GuideStepProgress(BaseModel):
    id: str
    guide_step_id: str
    guide_id: str
    user_id: str
    is_complete: bool = False
    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = None


class GuideEntry(BaseModel):
    id: str
    hub_id: str
    title: str
    topic: Optional[str] = None
    summary: Optional[str] = None
    source_ids: List[str] = Field(default_factory=list)
    archived_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    created_by: Optional[str] = None
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None
    generation_batch_id: Optional[str] = None
    steps: List[GuideStepWithProgress] = Field(default_factory=list)


class GuideGenerateRequest(StrictModel):
    hub_id: UUID
    source_ids: List[UUID]
    topic: Optional[str] = Field(default=None, max_length=240)
    step_count: Optional[int] = Field(default=None, ge=1, le=20)


class GuideGenerateResponse(BaseModel):
    entry: Optional[GuideEntry] = None


class GuideUpdateRequest(StrictModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=240)
    topic: Optional[str] = Field(default=None, max_length=240)
    summary: Optional[str] = Field(default=None, max_length=2000)
    archived: Optional[bool] = None


class GuideStepUpdateRequest(StrictModel):
    title: Optional[str] = Field(default=None, max_length=240)
    instruction: Optional[str] = Field(default=None, min_length=1, max_length=4000)


class GuideStepCreateRequest(StrictModel):
    title: Optional[str] = Field(default=None, max_length=240)
    instruction: str = Field(..., min_length=1, max_length=4000)


class GuideStepReorderRequest(StrictModel):
    ordered_step_ids: List[UUID]


class GuideStepProgressUpdate(StrictModel):
    is_complete: bool


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


class ActivityEvent(BaseModel):
    id: str
    hub_id: str
    user_id: str
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    metadata: dict = Field(default_factory=dict)
    created_at: datetime
