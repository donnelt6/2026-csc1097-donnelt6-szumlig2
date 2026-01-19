"""Tests for auth dependency helpers using fake HTTP client responses."""

import pytest
from fastapi import HTTPException

from app import dependencies as deps
from app.core.config import get_settings


class FakeResponse:
    def __init__(self, status_code: int, json_data: dict | None = None) -> None:
        self.status_code = status_code
        self._json_data = json_data or {}

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return self._json_data


class FakeClient:
    def __init__(self, response: FakeResponse) -> None:
        self._response = response

    def __enter__(self) -> "FakeClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def get(self, url: str, headers: dict) -> FakeResponse:
        return self._response


def test_get_access_token_missing_header() -> None:
    # Passes None; expect 401 for missing Authorization header.
    with pytest.raises(HTTPException) as excinfo:
        deps.get_access_token(None)
    assert excinfo.value.status_code == 401


def test_get_access_token_invalid_header() -> None:
    # Passes wrong scheme; expect 401 for invalid header format.
    with pytest.raises(HTTPException) as excinfo:
        deps.get_access_token("Token abc")
    assert excinfo.value.status_code == 401


def test_get_access_token_success() -> None:
    # Passes a Bearer token; expect token string to be returned.
    assert deps.get_access_token("Bearer abc") == "abc"


def test_get_current_user_success(monkeypatch) -> None:
    # Fakes a 200 response; expect CurrentUser with id/email from payload.
    settings = get_settings()
    response = FakeResponse(200, {"id": "user-1", "email": "user@example.com"})
    monkeypatch.setattr(deps.httpx, "Client", lambda timeout: FakeClient(response))

    user = deps.get_current_user("token-123", settings)
    assert user.id == "user-1"
    assert user.email == "user@example.com"


def test_get_current_user_invalid_token(monkeypatch) -> None:
    # Fakes a 401 response; expect unauthorized HTTPException.
    settings = get_settings()
    response = FakeResponse(401, {})
    monkeypatch.setattr(deps.httpx, "Client", lambda timeout: FakeClient(response))

    with pytest.raises(HTTPException) as excinfo:
        deps.get_current_user("bad-token", settings)
    assert excinfo.value.status_code == 401


def test_get_current_user_bad_payload(monkeypatch) -> None:
    # Fakes a 200 without user id; expect invalid token payload error.
    settings = get_settings()
    response = FakeResponse(200, {"email": "user@example.com"})
    monkeypatch.setattr(deps.httpx, "Client", lambda timeout: FakeClient(response))

    with pytest.raises(HTTPException) as excinfo:
        deps.get_current_user("token-123", settings)
    assert excinfo.value.status_code == 401
