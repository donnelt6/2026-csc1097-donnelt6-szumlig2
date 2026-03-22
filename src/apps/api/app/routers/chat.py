import logging
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from openai import OpenAIError
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import ChatRequest, ChatResponse, ChatSessionDetail, ChatSessionSummary, HistoryMessage
from ..services.store import store
from .errors import raise_postgrest_error

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)


@router.post(
    "",
    response_model=ChatResponse,
    dependencies=[Depends(rate_limit_user_ip("chat", "rate_limit_chat_per_minute"))],
)
def ask(
    payload: ChatRequest,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> ChatResponse:
    try:
        return store.chat(client, current_user.id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.") from exc
    except OpenAIError as exc:
        status_code = getattr(exc, "status_code", None)
        logger.exception("OpenAI error during chat")
        if status_code == 429:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="OpenAI quota or rate limit exceeded.",
            ) from exc
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OpenAI request failed.") from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.get("/sessions", response_model=List[ChatSessionSummary])
def list_sessions(
    hub_id: UUID = Query(...),
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> List[ChatSessionSummary]:
    try:
        return store.list_chat_sessions(client, current_user.id, str(hub_id))
    except APIError as exc:
        raise_postgrest_error(exc)


@router.get("/sessions/{session_id}/messages", response_model=ChatSessionDetail)
def get_session_messages(
    session_id: UUID,
    hub_id: UUID = Query(...),
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> ChatSessionDetail:
    try:
        return store.get_chat_session_with_messages(client, current_user.id, str(hub_id), str(session_id))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.") from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: UUID,
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    try:
        store.delete_chat_session(client, current_user.id, str(session_id))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.") from exc
    except APIError as exc:
        raise_postgrest_error(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/history", response_model=List[HistoryMessage])
def chat_history(
    hub_id: UUID = Query(...),
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> List[HistoryMessage]:
    try:
        return store.chat_history(client, current_user.id, str(hub_id))
    except APIError as exc:
        raise_postgrest_error(exc)
