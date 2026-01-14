from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class HubScope(str, Enum):
    hub = "hub"
    global_scope = "global"


class Hub(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class HubCreate(BaseModel):
    name: str
    description: Optional[str] = None


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


class SourceCreate(BaseModel):
    hub_id: str
    original_name: str


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


class ChatRequest(BaseModel):
    hub_id: str
    scope: HubScope = HubScope.hub
    question: str


class ChatResponse(BaseModel):
    answer: str
    citations: List[Citation] = []
    message_id: str
