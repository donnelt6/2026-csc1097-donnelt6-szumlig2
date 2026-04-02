import logging

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core.config import get_settings
from .dependencies import rate_limit_ip_only
from .routers.errors import raise_upstream_http_error
from .routers import activity, analytics, chat, faqs, guides, hubs, memberships, moderation, reminders, sources, users

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    try:
        settings = get_settings()
    except Exception:
        logger.exception("api.startup.config_invalid")
        raise

    app = FastAPI(
        title="Caddie API",
        version="0.1.0",
        description="FastAPI backend for Caddie.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=bool(settings.cors_allowed_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def log_startup() -> None:
        logger.info(
            "api.startup.ready",
            extra={
                "environment": settings.environment,
                "allowed_origins": settings.cors_allowed_origins,
                "trust_proxy_headers": settings.trust_proxy_headers,
            },
        )

    app.include_router(activity.router)

    @app.exception_handler(httpx.HTTPError)
    def handle_upstream_http_error(_request: Request, exc: httpx.HTTPError) -> JSONResponse:
        try:
            raise_upstream_http_error(exc)
        except Exception as mapped:
            if hasattr(mapped, "status_code") and hasattr(mapped, "detail"):
                return JSONResponse(status_code=mapped.status_code, content={"detail": mapped.detail})
            raise

    app.include_router(hubs.router)
    app.include_router(analytics.router)
    app.include_router(sources.router)
    app.include_router(chat.router)
    app.include_router(moderation.router)
    app.include_router(faqs.router)
    app.include_router(guides.router)
    app.include_router(memberships.router)
    app.include_router(users.router)
    app.include_router(reminders.router)


    @app.get("/health", dependencies=[Depends(rate_limit_ip_only("health", "rate_limit_health_per_minute"))])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
