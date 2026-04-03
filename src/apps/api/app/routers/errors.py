"""errors.py: Converts database and upstream HTTP errors into FastAPI HTTP exceptions."""

import httpx
from fastapi import HTTPException, status
from postgrest.exceptions import APIError


# Error mapping helpers.

# Translate PostgREST database errors into user-facing API responses.
def raise_postgrest_error(exc: APIError) -> None:
    message = (exc.message or "Database error.").strip()
    lowered = message.lower()
    if exc.code == "42501" or "row level security" in lowered or "permission" in lowered:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized.") from exc
    if exc.code == "23505":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Resource already exists.") from exc
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message) from exc


# Wrap upstream HTTP failures in a gateway error for API clients.
def raise_upstream_http_error(exc: httpx.HTTPError) -> None:
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Upstream Supabase request failed. Please retry.",
    ) from exc
