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


class Source(BaseModel):
    id: str
    hub_id: str
    original_name: str
    storage_path: Optional[str] = None
    status: SourceStatus
    failure_reason: Optional[str] = None
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


class SourceEnqueueResponse(BaseModel):
    source: Source
    upload_url: str


class SourceStatusResponse(BaseModel):
    id: str
    status: SourceStatus
    failure_reason: Optional[str] = None


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
