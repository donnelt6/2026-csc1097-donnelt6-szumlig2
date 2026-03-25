"""Tests for API settings parsing and environment-sensitive CORS validation."""

import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def clear_settings_cache() -> None:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_local_environment_defaults_localhost_origins(monkeypatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "local")
    monkeypatch.setenv("ALLOWED_ORIGINS", "")

    settings = get_settings()

    assert settings.cors_allowed_origins == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_non_local_environment_requires_origins(monkeypatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ALLOWED_ORIGINS", "")

    with pytest.raises(ValueError, match="ALLOWED_ORIGINS must be configured"):
        get_settings()


def test_allowed_origins_are_normalized_from_comma_separated_string(monkeypatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ALLOWED_ORIGINS", " https://app.example.com,https://admin.example.com ")

    settings = get_settings()

    assert settings.cors_allowed_origins == [
        "https://app.example.com",
        "https://admin.example.com",
    ]
