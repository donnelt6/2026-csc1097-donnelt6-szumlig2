"""config.py: Loads environment-backed settings used by the worker tasks and schedulers."""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

# Loads `.env` values before the settings object reads environment variables.
load_dotenv()


# Groups the worker configuration values into a single reusable settings object.
@dataclass
class Settings:
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    storage_bucket: str = os.getenv("SUPABASE_STORAGE_BUCKET", "sources")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    chunk_size: int = int(os.getenv("CHUNK_SIZE", "800"))
    chunk_overlap: int = int(os.getenv("CHUNK_OVERLAP", "150"))
    default_timezone: str = os.getenv("DEFAULT_TIMEZONE", "Europe/Dublin")
    reminder_lead_hours: int = int(os.getenv("REMINDER_LEAD_HOURS", "24"))
    reminder_dispatch_window_minutes: int = int(os.getenv("REMINDER_DISPATCH_WINDOW_MINUTES", "15"))
    web_user_agent: str = os.getenv("WEB_USER_AGENT", "CaddieBot/1.0")
    web_max_bytes: int = int(os.getenv("WEB_MAX_BYTES", "2000000"))
    web_timeout_seconds: int = int(os.getenv("WEB_TIMEOUT_SECONDS", "20"))
    web_respect_robots: bool = os.getenv("WEB_RESPECT_ROBOTS", "true").lower() in {"1", "true", "yes"}
    youtube_default_language: str = os.getenv("YOUTUBE_DEFAULT_LANGUAGE", "en")
    youtube_allow_auto_captions: bool = os.getenv("YOUTUBE_ALLOW_AUTO_CAPTIONS", "true").lower() in {"1", "true", "yes"}
    youtube_max_bytes: int = int(os.getenv("YOUTUBE_MAX_BYTES", "2000000"))
    youtube_cookies_file: str = os.getenv("YOUTUBE_COOKIES_FILE", "")
    youtube_cookies_b64: str = os.getenv("YOUTUBE_COOKIES_B64", "")
    youtube_cookies_raw: str = os.getenv("YOUTUBE_COOKIES_RAW", "")
    suggested_sources_model: str = os.getenv("SUGGESTED_SOURCES_MODEL", "gpt-4o-mini")
    suggested_sources_scan_interval_minutes: int = int(os.getenv("SUGGESTED_SOURCES_SCAN_INTERVAL_MINUTES", "10"))
    suggested_sources_hub_cooldown_minutes: int = int(os.getenv("SUGGESTED_SOURCES_HUB_COOLDOWN_MINUTES", "60"))
    suggested_sources_active_days: int = int(os.getenv("SUGGESTED_SOURCES_ACTIVE_DAYS", "30"))
    suggested_sources_min_complete_sources: int = int(os.getenv("SUGGESTED_SOURCES_MIN_COMPLETE_SOURCES", "2"))
    suggested_sources_context_limit: int = int(os.getenv("SUGGESTED_SOURCES_CONTEXT_LIMIT", "8"))
    suggested_sources_chunks_per_source: int = int(os.getenv("SUGGESTED_SOURCES_CHUNKS_PER_SOURCE", "2"))
    suggested_sources_batch_limit: int = int(os.getenv("SUGGESTED_SOURCES_BATCH_LIMIT", "3"))
    suggested_sources_lock_ttl_seconds: int = int(os.getenv("SUGGESTED_SOURCES_LOCK_TTL_SECONDS", "540"))


# Builds a fresh settings object from the current environment variables.
def get_settings() -> Settings:
    return Settings()
