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

from app.dependencies import CurrentUser, get_current_user, get_supabase_user_client
from app.main import app


class DummyClient:
    pass


@pytest.fixture
def client() -> TestClient:
    # Overrides auth/client dependencies so router tests run offline.
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id="user-1", email="user@example.com")
    app.dependency_overrides[get_supabase_user_client] = lambda: DummyClient()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides = {}
