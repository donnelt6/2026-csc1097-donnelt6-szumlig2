"""Dependency helpers for Supabase auth + per-request clients."""

from dataclasses import dataclass
from typing import Optional

import httpx
from fastapi import Depends, Header, HTTPException, status
from supabase import Client, create_client

from .core.config import Settings, get_settings


@dataclass
class CurrentUser:
    id: str
    email: Optional[str]


def get_access_token(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Authorization header.")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Authorization header.")
    return authorization.split(" ", 1)[1]


def get_current_user(
    token: str = Depends(get_access_token),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise RuntimeError("Supabase credentials missing. Set SUPABASE_URL and SUPABASE_ANON_KEY.")
    url = f"{settings.supabase_url}/auth/v1/user"
    headers = {"Authorization": f"Bearer {token}", "apikey": settings.supabase_anon_key}
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(url, headers=headers)
    except httpx.HTTPError as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Auth service unreachable.") from exc
    if resp.status_code == status.HTTP_401_UNAUTHORIZED:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token.")
    if not resp.is_success:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Auth lookup failed.")
    data = resp.json()
    user_id = data.get("id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload.")
    return CurrentUser(id=user_id, email=data.get("email"))


def get_supabase_user_client(
    token: str = Depends(get_access_token),
    settings: Settings = Depends(get_settings),
) -> Client:
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise RuntimeError("Supabase credentials missing. Set SUPABASE_URL and SUPABASE_ANON_KEY.")
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(token)
    return client


def get_supabase_service_client(settings: Settings = Depends(get_settings)) -> Client:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase credentials missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
