"""Tests for PostgREST error mapping to HTTP responses."""

import httpx
import pytest
from fastapi import HTTPException, status

from app.routers.errors import raise_postgrest_error, raise_upstream_http_error


class FakeAPIError(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def test_raise_postgrest_error_maps_rls() -> None:
    # Simulates RLS error; expect 403 Not authorized.
    exc = FakeAPIError("row level security violation", "42501")
    with pytest.raises(HTTPException) as excinfo:
        raise_postgrest_error(exc)
    assert excinfo.value.status_code == status.HTTP_403_FORBIDDEN


def test_raise_postgrest_error_maps_unique() -> None:
    # Simulates unique constraint error; expect 409 conflict.
    exc = FakeAPIError("duplicate key value violates unique constraint", "23505")
    with pytest.raises(HTTPException) as excinfo:
        raise_postgrest_error(exc)
    assert excinfo.value.status_code == status.HTTP_409_CONFLICT


def test_raise_postgrest_error_defaults_to_400() -> None:
    # Uses unknown error code; expect 400 with message passed through.
    exc = FakeAPIError("bad input", "99999")
    with pytest.raises(HTTPException) as excinfo:
        raise_postgrest_error(exc)
    assert excinfo.value.status_code == status.HTTP_400_BAD_REQUEST


def test_raise_upstream_http_error_maps_transport_failure() -> None:
    exc = httpx.RemoteProtocolError("Server disconnected")
    with pytest.raises(HTTPException) as excinfo:
        raise_upstream_http_error(exc)
    assert excinfo.value.status_code == status.HTTP_502_BAD_GATEWAY
    assert excinfo.value.detail == "Upstream Supabase request failed. Please retry."
