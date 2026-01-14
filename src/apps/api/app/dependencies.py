"""Dependency helpers for future per-request Supabase client injection."""

from typing import Optional

from fastapi import Depends
from supabase import Client, create_client

from .core.config import Settings, get_settings


def get_supabase_client(settings: Settings = Depends(get_settings)) -> Optional[Client]:
    """Returns a Supabase client when credentials exist; otherwise None for local stubs."""
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
