"""schemas.py: Defines shared request and response models, enums, and validators for the API."""

from datetime import datetime
from enum import Enum
from typing import List, Literal, Optional
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


# Core enums and shared base models.
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


# Trim optional strings and reject values that are only whitespace.
def _trim_and_reject_blank(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("Value cannot be blank.")
    return trimmed


def _is_youtube_host(hostname: str) -> bool:
    host = (hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host == "youtu.be" or host.endswith("youtube.com") or host.endswith("youtube-nocookie.com")


# Hub, user, and membership models.
class UserProfileSummary(BaseModel):
    user_id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar_mode: Optional[str] = None
    avatar_key: Optional[str] = None
    avatar_color: Optional[str] = None


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
    member_profiles: Optional[List["UserProfileSummary"]] = None


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

    # Normalize the name field before standard validation runs.
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
    display_name: Optional[str] = None
    avatar_mode: Optional[str] = None
    avatar_key: Optional[str] = None
    avatar_color: Optional[str] = None


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


# Source and ingestion models.
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
    file_kind: Optional[Literal["document", "media"]] = Field(default=None)

    # Reject filenames that contain null bytes or path separators.
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

    # Require a normal HTTP(S) URL for generic web sources.
    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        lower = value.strip()
        if not lower.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        parsed = urlparse(lower)
        if _is_youtube_host(parsed.hostname or ""):
            raise ValueError("Use the YouTube import flow for YouTube links.")
        return lower


class YouTubeSourceCreate(StrictModel):
    hub_id: UUID
    url: str = Field(..., min_length=1, max_length=2000)
    language: Optional[str] = Field(default=None, min_length=2, max_length=16)
    allow_auto_captions: bool = False

    # Require a supported YouTube-domain URL for YouTube sources.
    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        lower = value.strip()
        if not lower.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        parsed = urlparse(lower)
        if not parsed.hostname:
            raise ValueError("URL must include a host")
        if _is_youtube_host(parsed.hostname):
            return lower
        raise ValueError("URL must be a YouTube domain")

    # Normalize blank language values back to None.
    @field_validator("language")
    @classmethod
    def normalize_language(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        return cleaned


class YouTubeFallbackSourceCreate(StrictModel):
    hub_id: UUID
    youtube_source_id: UUID
    original_name: str = Field(..., min_length=1, max_length=255)

    # Reuse the same filename validation as normal file uploads.
    @field_validator("original_name")
    @classmethod
    def validate_original_name(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("File name contains invalid characters.")
        if "/" in value or "\\" in value:
            raise ValueError("File name must not include path separators.")
        return value

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


# Chat, citation, and analytics models.
class ChatRequest(StrictModel):
    hub_id: UUID
    scope: HubScope = HubScope.hub
    question: str = Field(..., min_length=1, max_length=4000)
    source_ids: Optional[List[UUID]] = None
    session_id: Optional[UUID] = None


class ChatPromptSuggestionResponse(BaseModel):
    prompt: str


class ChatResponse(BaseModel):
    answer: str
    citations: List[Citation] = Field(default_factory=list)
    message_id: str
    session_id: str
    session_title: str
    active_flag_id: Optional[str] = None
    flag_status: str = "none"
    feedback_rating: Optional[str] = None
    answer_status: Literal["answered", "abstained", "greeting"] = "answered"


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
    feedback_rating: Optional[str] = None
    answer_status: Optional[Literal["answered", "abstained", "greeting"]] = None


class ChatSessionDetail(BaseModel):
    session: ChatSessionSummary
    messages: List[SessionMessage] = Field(default_factory=list)


class ChatSearchResult(BaseModel):
    session_id: str
    session_title: str
    hub_id: str
    message_id: Optional[str] = None
    matched_role: str
    snippet: str
    matched_text: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


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


class ChatFeedbackRating(str, Enum):
    helpful = "helpful"
    not_helpful = "not_helpful"


class CitationFeedbackEventType(str, Enum):
    opened = "opened"
    flagged_incorrect = "flagged_incorrect"


class ChatEventType(str, Enum):
    question_asked = "question_asked"
    answer_received = "answer_received"
    answer_copied = "answer_copied"
    answer_feedback_submitted = "answer_feedback_submitted"
    citation_opened = "citation_opened"
    citation_flagged = "citation_flagged"
    source_filter_changed = "source_filter_changed"


class ChatFeedbackRequest(StrictModel):
    rating: ChatFeedbackRating
    reason: Optional[str] = Field(default=None, max_length=500)


class ChatFeedbackResponse(BaseModel):
    message_id: str
    rating: ChatFeedbackRating
    reason: Optional[str] = None
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CitationFeedbackRequest(StrictModel):
    source_id: str = Field(..., min_length=1, max_length=255)
    chunk_index: Optional[int] = Field(default=None, ge=0)
    event_type: CitationFeedbackEventType
    note: Optional[str] = Field(default=None, max_length=500)


class CitationFeedbackResponse(BaseModel):
    message_id: str
    source_id: str
    chunk_index: Optional[int] = None
    event_type: CitationFeedbackEventType
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ChatEventCreate(StrictModel):
    hub_id: UUID
    session_id: Optional[UUID] = None
    message_id: Optional[UUID] = None
    event_type: ChatEventType
    metadata: dict = Field(default_factory=dict)


class ChatEventResponse(BaseModel):
    event_type: ChatEventType
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AnalyticsTopSource(BaseModel):
    source_id: str
    source_name: Optional[str] = None
    citation_returns: int = 0
    citation_opens: int = 0
    citation_flags: int = 0


class NeverCitedSource(BaseModel):
    source_id: str
    source_name: Optional[str] = None


class ChatAnalyticsSummary(BaseModel):
    window_days: int
    total_questions: int = 0
    total_answers: int = 0
    helpful_count: int = 0
    not_helpful_count: int = 0
    helpful_rate: float = 0.0
    average_citations_per_answer: float = 0.0
    citation_open_count: int = 0
    citation_open_rate: float = 0.0
    citation_flag_count: int = 0
    citation_flag_rate: float = 0.0
    average_latency_ms: float = 0.0
    total_tokens: int = 0
    rewrite_usage_rate: float = 0.0
    zero_hit_rate: float = 0.0
    top_sources: List[AnalyticsTopSource] = Field(default_factory=list)
    never_cited_sources: List[NeverCitedSource] = Field(default_factory=list)
    never_cited_count: int = 0
    total_complete_sources: int = 0


class ChatAnalyticsTrendPoint(BaseModel):
    date: str
    questions: int = 0
    answers: int = 0
    helpful: int = 0
    not_helpful: int = 0
    citation_opens: int = 0
    citation_flags: int = 0


class ChatAnalyticsTrends(BaseModel):
    window_days: int
    points: List[ChatAnalyticsTrendPoint] = Field(default_factory=list)


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

    # Trim the revision content and reject blank submissions.
    @field_validator("content", mode="before")
    @classmethod
    def validate_content(cls, value: str) -> str:
        trimmed = _trim_and_reject_blank(value)
        if trimmed is None:
            raise ValueError("Value cannot be blank.")
        return trimmed


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

    # Trim the chat title and reject blank submissions.
    @field_validator("title", mode="before")
    @classmethod
    def validate_title(cls, value: str) -> str:
        trimmed = _trim_and_reject_blank(value)
        if trimmed is None:
            raise ValueError("Value cannot be blank.")
        return trimmed


class FaqEntry(BaseModel):
    id: str
    hub_id: str
    question: str
    answer: str
    topic_label: Optional[str] = None
    topic_labels: List[str] = Field(default_factory=list)
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


class FaqCreateRequest(StrictModel):
    hub_id: UUID
    question: str = Field(..., min_length=1, max_length=4000)
    answer: str = Field(..., min_length=1, max_length=8000)


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


# FAQ and guide content models.
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
    topic_label: Optional[str] = None
    topic_labels: List[str] = Field(default_factory=list)
    summary: Optional[str] = None
    source_ids: List[str] = Field(default_factory=list)
    is_favourited: bool = False
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
    is_favourited: Optional[bool] = None
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


# Reminder, notification, and activity models.
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
    color_key: Optional[str] = None
    due_at: datetime
    timezone: str
    title: Optional[str] = None
    message: Optional[str] = None
    notify_before: Optional[int] = None
    status: ReminderStatus
    created_at: datetime = Field(default_factory=datetime.utcnow)
    sent_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class ReminderCreate(StrictModel):
    hub_id: UUID
    source_id: Optional[UUID] = None
    color_key: Optional[str] = Field(default=None)
    due_at: datetime
    timezone: str = Field(..., min_length=1, max_length=64)
    title: Optional[str] = Field(default=None, max_length=100)
    message: Optional[str] = Field(default=None, max_length=500)
    notify_before: Optional[int] = Field(default=None, ge=0, le=60 * 24 * 7)

    # Keep reminder colours aligned with the shared hub colour palette.
    @field_validator("color_key")
    @classmethod
    def validate_color_key(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if value not in HUB_COLOR_KEYS:
            raise ValueError("Unsupported reminder color.")
        return value


class ReminderUpdateAction(str, Enum):
    complete = "complete"
    cancel = "cancel"
    snooze = "snooze"
    reopen = "reopen"


class ReminderUpdate(StrictModel):
    due_at: Optional[datetime] = None
    color_key: Optional[str] = Field(default=None)
    timezone: Optional[str] = Field(default=None, min_length=1, max_length=64)
    title: Optional[str] = Field(default=None, max_length=100)
    message: Optional[str] = Field(default=None, max_length=500)
    notify_before: Optional[int] = Field(default=None, ge=0, le=60 * 24 * 7)
    action: Optional[ReminderUpdateAction] = None
    snooze_minutes: Optional[int] = Field(default=None, ge=1, le=60 * 24 * 30)

    # Reuse the hub colour palette for reminder colour edits.
    @field_validator("color_key")
    @classmethod
    def validate_color_key(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if value not in HUB_COLOR_KEYS:
            raise ValueError("Unsupported reminder color.")
        return value


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
    dismissed_at: Optional[datetime] = None
    provider_id: Optional[str] = None


class ReminderSummary(BaseModel):
    id: str
    hub_id: str
    hub_name: Optional[str] = None
    source_id: Optional[str] = None
    color_key: Optional[str] = None
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
    dismissed_at: Optional[datetime] = None
    reminder: ReminderSummary


class ContentFlagType(str, Enum):
    faq = "faq"
    guide = "guide"


class ContentFlagStatus(str, Enum):
    open = "open"
    resolved = "resolved"
    dismissed = "dismissed"


class ContentFlagRequest(StrictModel):
    reason: FlagReason
    notes: Optional[str] = Field(default=None, max_length=1000)


class ContentFlag(BaseModel):
    id: str
    hub_id: str
    content_type: ContentFlagType
    content_id: str
    created_by: str
    reason: FlagReason
    notes: Optional[str] = None
    status: ContentFlagStatus
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ContentFlagResponse(BaseModel):
    flag: ContentFlag
    created: bool


class FlaggedContentQueueItem(BaseModel):
    id: str
    hub_id: str
    content_type: ContentFlagType
    content_id: str
    title: str
    preview: str
    reason: FlagReason
    status: ContentFlagStatus
    flagged_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    reviewed_at: Optional[datetime] = None


class ActivityEvent(BaseModel):
    id: str
    hub_id: str
    user_id: str
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    metadata: dict = Field(default_factory=dict)
    created_at: datetime
