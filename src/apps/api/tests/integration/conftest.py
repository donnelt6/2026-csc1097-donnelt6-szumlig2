"""Integration fixtures for API routes exercised through the real FastAPI app."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import os
from typing import Any

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("SUPABASE_URL", "http://test.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from app.core import config as config_module

config_module.get_settings.cache_clear()

from app.dependencies import CurrentUser, get_current_user, get_rate_limiter, get_supabase_user_client
from app.main import app
from app.routers import chat as chat_router
from app.routers import sources as sources_router
from app.schemas import ChatResponse, Citation, Hub, HubMember, HubScope, MembershipRole, Source, SourceStatus, SourceType
from app.services.rate_limit import RateLimitResult
from app.services.store import store as store_module


class DummyClient:
    """Opaque client stub used by the route layer during integration tests."""


class AllowAllRateLimiter:
    """Rate-limiter double that keeps integration tests focused on route flow."""

    def check(self, key: str, limit: int, window_seconds: int = 60) -> RateLimitResult:
        _ = key
        return RateLimitResult(allowed=True, remaining=limit, reset_in_seconds=window_seconds)


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass
class FakeApiServices:
    """Small fake service layer shared across integration tests."""

    hubs: list[Hub] = field(default_factory=list)
    sources: dict[str, Source] = field(default_factory=dict)
    activity_log: list[dict[str, Any]] = field(default_factory=list)
    queued_tasks: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.hubs:
            return
        hub = Hub(
            id="11111111-1111-1111-1111-111111111111",
            owner_id="00000000-0000-0000-0000-000000000001",
            name="Integration Hub",
            description="Critical path fixture hub.",
            icon_key="stack",
            color_key="slate",
            created_at=_utc("2026-04-10T10:00:00Z"),
            role=MembershipRole.owner,
        )
        file_source = Source(
            id="22222222-2222-2222-2222-222222222222",
            hub_id=hub.id,
            type=SourceType.file,
            original_name="Existing notes.txt",
            storage_path=f"{hub.id}/22222222-2222-2222-2222-222222222222/existing-notes.txt",
            status=SourceStatus.complete,
            created_at=_utc("2026-04-10T10:05:00Z"),
        )
        web_source = Source(
            id="33333333-3333-3333-3333-333333333333",
            hub_id=hub.id,
            type=SourceType.web,
            original_name="example.com",
            storage_path=f"{hub.id}/33333333-3333-3333-3333-333333333333/web.md",
            status=SourceStatus.complete,
            ingestion_metadata={"url": "https://example.com/docs"},
            created_at=_utc("2026-04-10T10:06:00Z"),
        )
        self.hubs = [hub]
        self.sources = {file_source.id: file_source, web_source.id: web_source}

    def require_member(self, client: object, hub_id: str, user_id: str) -> HubMember:
        _ = client
        return HubMember(
            hub_id=hub_id,
            user_id=user_id,
            role=MembershipRole.owner,
            invited_at=_utc("2026-04-10T09:55:00Z"),
            accepted_at=_utc("2026-04-10T10:00:00Z"),
        )

    def list_hubs(self, client: object, user_id: str) -> list[Hub]:
        _ = (client, user_id)
        return self.hubs

    def list_sources(self, client: object, hub_id: str) -> list[Source]:
        _ = client
        return [source for source in self.sources.values() if source.hub_id == str(hub_id)]

    def create_source(self, client: object, payload: Any) -> tuple[Source, str]:
        _ = client
        source_id = "44444444-4444-4444-4444-444444444444"
        source = Source(
            id=source_id,
            hub_id=str(payload.hub_id),
            type=SourceType.file,
            original_name=payload.original_name,
            storage_path=f"{payload.hub_id}/{source_id}/{payload.original_name}",
            status=SourceStatus.queued,
            created_at=datetime.now(timezone.utc),
        )
        self.sources[source.id] = source
        return source, f"https://upload.test/{source.id}"

    def get_source(self, client: object, source_id: Any) -> Source:
        _ = client
        key = str(source_id)
        if key not in self.sources:
            raise KeyError("Source not found")
        return self.sources[key]

    def set_source_status(
        self,
        client: object,
        source_id: Any,
        status: SourceStatus,
        failure_reason: str | None = None,
    ) -> Source:
        _ = client
        source = self.get_source(client, source_id)
        updated = source.model_copy(update={"status": status, "failure_reason": failure_reason})
        self.sources[source.id] = updated
        return updated

    def refresh_source(self, client: object, source_id: Any) -> tuple[Source, dict[str, Any]]:
        _ = client
        source = self.get_source(client, source_id)
        if source.type != SourceType.web:
            raise ValueError("Refresh not supported for source type")
        refreshed = source.model_copy(update={"status": SourceStatus.queued, "failure_reason": None})
        self.sources[source.id] = refreshed
        return refreshed, {"type": "web", "url": "https://example.com/docs"}

    def chat(self, client: object, user_id: str, payload: Any) -> ChatResponse:
        _ = (client, user_id)
        selected_source_id = str(payload.source_ids[0]) if payload.source_ids else "22222222-2222-2222-2222-222222222222"
        return ChatResponse(
            answer=f"Integration answer for: {payload.question}",
            citations=[
                Citation(
                    source_id=selected_source_id,
                    snippet="The seeded source contains the cited integration snippet.",
                    chunk_index=0,
                )
            ],
            message_id="55555555-5555-5555-5555-555555555555",
            session_id=str(payload.session_id or "66666666-6666-6666-6666-666666666666"),
            session_title="Integration session",
            flag_status="none",
        )

    def log_activity(
        self,
        client: object,
        hub_id: str,
        user_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        metadata: dict[str, Any],
    ) -> None:
        _ = client
        self.activity_log.append(
            {
                "hub_id": hub_id,
                "user_id": user_id,
                "action": action,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "metadata": metadata,
            }
        )

    def queue_task(self, task_name: str, args: list[Any]) -> None:
        self.queued_tasks.append({"task_name": task_name, "args": args})


@pytest.fixture
def integration_services(monkeypatch: pytest.MonkeyPatch) -> FakeApiServices:
    """Patch route-edge collaborators with one shared in-memory fake service layer."""

    services = FakeApiServices()

    monkeypatch.setattr(store_module, "list_hubs", services.list_hubs)
    monkeypatch.setattr(store_module, "list_sources", services.list_sources)
    monkeypatch.setattr(store_module, "create_source", services.create_source)
    monkeypatch.setattr(store_module, "get_source", services.get_source)
    monkeypatch.setattr(store_module, "set_source_status", services.set_source_status)
    monkeypatch.setattr(store_module, "refresh_source", services.refresh_source)
    monkeypatch.setattr(store_module, "chat", services.chat)
    monkeypatch.setattr(store_module, "log_activity", services.log_activity)
    monkeypatch.setattr(chat_router, "require_hub_member", services.require_member)
    monkeypatch.setattr(sources_router.celery_app, "send_task", lambda task_name, args: services.queue_task(task_name, args))
    return services


@pytest.fixture
def integration_client(integration_services: FakeApiServices) -> TestClient:
    """Create a real FastAPI test client with shared integration doubles applied."""

    _ = integration_services
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id="00000000-0000-0000-0000-000000000001",
        email="integration@example.com",
    )
    app.dependency_overrides[get_rate_limiter] = lambda: AllowAllRateLimiter()
    app.dependency_overrides[get_supabase_user_client] = lambda: DummyClient()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides = {}
