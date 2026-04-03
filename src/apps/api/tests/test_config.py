"""Tests for API settings parsing and environment-sensitive CORS validation."""

import pytest

from app.core.config import get_settings


# Clears cached settings so each configuration test starts clean.
# Test helpers and fixtures.
@pytest.fixture(autouse=True)

def clear_settings_cache() -> None:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# Verifies that local environment defaults localhost origins.
# Configuration parsing tests.
def test_local_environment_defaults_localhost_origins(monkeypatch) -> None:

    monkeypatch.setenv("ENVIRONMENT", "local")
    monkeypatch.setenv("ALLOWED_ORIGINS", "")

    settings = get_settings()

    assert settings.cors_allowed_origins == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


# Verifies that non local environment requires origins.
def test_non_local_environment_requires_origins(monkeypatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ALLOWED_ORIGINS", "")

    with pytest.raises(ValueError, match="ALLOWED_ORIGINS must be configured"):
        get_settings()


# Verifies that allowed origins are normalized from comma separated string.
def test_allowed_origins_are_normalized_from_comma_separated_string(monkeypatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ALLOWED_ORIGINS", " https://app.example.com,https://admin.example.com ")

    settings = get_settings()

    assert settings.cors_allowed_origins == [
        "https://app.example.com",
        "https://admin.example.com",
    ]


# Verifies that cors allowed origins are stored after initial parse.
def test_cors_allowed_origins_are_stored_after_initial_parse(monkeypatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example.com")

    settings = get_settings()

    assert settings.cors_allowed_origins is settings.cors_allowed_origins
