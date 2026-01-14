import logging

from fastapi import APIRouter, HTTPException, status
from openai import OpenAIError

from ..schemas import ChatRequest, ChatResponse
from ..services.rate_limit import rate_limiter
from ..services.store import store
from ..core.config import get_settings

router = APIRouter(prefix="/chat", tags=["chat"])
settings = get_settings()
logger = logging.getLogger(__name__)


@router.post("", response_model=ChatResponse)
def ask(payload: ChatRequest) -> ChatResponse:
    limit = settings.rate_limit_chat_per_minute
    rl = rate_limiter.check(f"chat:{store.dev_user_id}", limit)
    if not rl.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Try again in {rl.reset_in_seconds}s.",
        )
    try:
        return store.chat(payload)
    except OpenAIError as exc:
        status_code = getattr(exc, "status_code", None)
        logger.exception("OpenAI error during chat")
        if status_code == 429:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="OpenAI quota or rate limit exceeded.",
            ) from exc
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OpenAI request failed.") from exc
