from enum import Enum
from typing import List, Optional

from pydantic import BaseModel


class HubScope(str, Enum):
    hub = "hub"
    global_scope = "global"


class Citation(BaseModel):
    source_id: str
    snippet: str
    chunk_index: Optional[int] = None


class ChatRequest(BaseModel):
    hub_id: str
    scope: HubScope
    question: str


class ChatResponse(BaseModel):
    answer: str
    citations: List[Citation]
    message_id: str


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
