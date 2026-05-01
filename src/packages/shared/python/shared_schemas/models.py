from enum import Enum
from typing import List, Optional

from pydantic import BaseModel


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


class FlagCaseStatus(str, Enum):
    open = "open"
    in_review = "in_review"
    resolved = "resolved"
    dismissed = "dismissed"


class MessageFlagStatus(str, Enum):
    none = "none"
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


class ChatAnswerStatus(str, Enum):
    answered = "answered"
    abstained = "abstained"
    greeting = "greeting"


class Citation(BaseModel):
    source_id: str
    snippet: str
    chunk_index: Optional[int] = None


class ChatRequest(BaseModel):
    hub_id: str
    scope: HubScope
    question: str
    source_ids: Optional[List[str]] = None
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    citations: List[Citation]
    message_id: str
    session_id: str
    session_title: str
    active_flag_id: Optional[str] = None
    flag_status: MessageFlagStatus = MessageFlagStatus.none
    answer_status: ChatAnswerStatus = ChatAnswerStatus.answered


class ChatSessionSummary(BaseModel):
    id: str
    hub_id: str
    title: str
    scope: HubScope
    source_ids: List[str]
    created_at: str
    last_message_at: str


class ChatSessionDetail(BaseModel):
    session: ChatSessionSummary
    messages: List["ChatMessage"]


class HistoryMessage(BaseModel):
    role: str
    content: str
    citations: List[Citation]
    created_at: str
    active_flag_id: Optional[str] = None
    flag_status: MessageFlagStatus = MessageFlagStatus.none


class SourceStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    failed = "failed"
    complete = "complete"


class Hub(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: str
    last_accessed_at: Optional[str] = None
    is_favourite: Optional[bool] = None


class Source(BaseModel):
    id: str
    hub_id: str
    original_name: str
    storage_path: Optional[str] = None
    status: SourceStatus
    failure_reason: Optional[str] = None
    created_at: str


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
    reviewed_at: Optional[str] = None
    resolved_revision_id: Optional[str] = None
    created_at: str
    updated_at: str


class MessageRevision(BaseModel):
    id: str
    message_id: str
    flag_case_id: str
    revision_type: MessageRevisionType
    content: str
    citations: List[Citation]
    created_by: Optional[str] = None
    created_at: str
    applied_at: Optional[str] = None
