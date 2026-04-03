"""Shared fixtures that stub auth and Supabase clients for API tests."""

import os

os.environ.setdefault("SUPABASE_URL", "http://test.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

import pytest
from fastapi.testclient import TestClient

from app.core import config as config_module

config_module.get_settings.cache_clear()

from app.dependencies import CurrentUser, get_current_user, get_rate_limiter, get_supabase_user_client
from app.main import app
from app.services.rate_limit import RateLimitResult


# Minimal client stub used by dependency overrides.
# Test helpers and fixtures.
class DummyClient:

    pass


# Test rate limiter that always allows the request.
class AllowAllRateLimiter:
    # Returns the configured rate-limit result for each check.
    def check(self, key: str, limit: int, window_seconds: int = 60) -> RateLimitResult:
        return RateLimitResult(allowed=True, remaining=limit, reset_in_seconds=window_seconds)


# Creates a FastAPI test client with shared dependency overrides.
@pytest.fixture
def client() -> TestClient:
    # Overrides auth/client dependencies so router tests run offline.
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id="00000000-0000-0000-0000-000000000001",
        email="user@example.com",
    )
    app.dependency_overrides[get_rate_limiter] = lambda: AllowAllRateLimiter()
    app.dependency_overrides[get_supabase_user_client] = lambda: DummyClient()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides = {}
