import logging

from fastapi import APIRouter, Depends, HTTPException, status
from openai import OpenAIError
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import ChatRequest, ChatResponse
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
