"""config.py: Loads environment-backed settings used by the worker tasks and schedulers."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_WORKER_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def _clean_env_value(name: str, default: str = "") -> str:
    # Normalizes quoted or whitespace-padded env values so worker restarts do not
    # silently preserve malformed config such as `"gpt-4o-mini"`.
    value = os.getenv(name)
    if value is None:
        return default
    cleaned = value.strip().strip("'\"").strip()
    return cleaned or default


def _clean_int_env(name: str, default: int) -> int:
    return int(_clean_env_value(name, str(default)))


# Loads `.env` values from the worker app directory rather than the process cwd.
load_dotenv(dotenv_path=_WORKER_ENV_PATH)


# Groups the worker configuration values into a single reusable settings object.
@dataclass
class Settings:
    redis_url: str = _clean_env_value("REDIS_URL", "redis://localhost:6379/0")
    supabase_url: str = _clean_env_value("SUPABASE_URL", "")
    supabase_service_role_key: str = _clean_env_value("SUPABASE_SERVICE_ROLE_KEY", "")
    storage_bucket: str = _clean_env_value("SUPABASE_STORAGE_BUCKET", "sources")
    openai_api_key: str = _clean_env_value("OPENAI_API_KEY", "")
    embedding_model: str = _clean_env_value("EMBEDDING_MODEL", "text-embedding-3-small")
    chunk_size: int = _clean_int_env("CHUNK_SIZE", 800)
    chunk_overlap: int = _clean_int_env("CHUNK_OVERLAP", 150)
    default_timezone: str = os.getenv("DEFAULT_TIMEZONE", "Europe/Dublin")
    reminder_lead_hours: int = _clean_int_env("REMINDER_LEAD_HOURS", 24)
    reminder_dispatch_window_minutes: int = _clean_int_env("REMINDER_DISPATCH_WINDOW_MINUTES", 15)
    web_user_agent: str = _clean_env_value("WEB_USER_AGENT", "CaddieBot/1.0")
    web_max_bytes: int = _clean_int_env("WEB_MAX_BYTES", 2000000)
    web_timeout_seconds: int = _clean_int_env("WEB_TIMEOUT_SECONDS", 20)
    web_respect_robots: bool = os.getenv("WEB_RESPECT_ROBOTS", "true").lower() in {"1", "true", "yes"}
    youtube_default_language: str = _clean_env_value("YOUTUBE_DEFAULT_LANGUAGE", "en")
    youtube_allow_auto_captions: bool = os.getenv("YOUTUBE_ALLOW_AUTO_CAPTIONS", "true").lower() in {"1", "true", "yes"}
    youtube_max_bytes: int = _clean_int_env("YOUTUBE_MAX_BYTES", 2000000)
    youtube_request_timeout_seconds: int = _clean_int_env("YOUTUBE_REQUEST_TIMEOUT_SECONDS", _clean_int_env("WEB_TIMEOUT_SECONDS", 20))
    youtube_metadata_retries: int = _clean_int_env("YOUTUBE_METADATA_RETRIES", 2)
    youtube_task_soft_time_limit_seconds: int = _clean_int_env("YOUTUBE_TASK_SOFT_TIME_LIMIT_SECONDS", 600)
    youtube_task_time_limit_seconds: int = _clean_int_env("YOUTUBE_TASK_TIME_LIMIT_SECONDS", 660)
    youtube_cookies_file: str = _clean_env_value("YOUTUBE_COOKIES_FILE", "")
    youtube_cookies_b64: str = _clean_env_value("YOUTUBE_COOKIES_B64", "")
    youtube_cookies_raw: str = _clean_env_value("YOUTUBE_COOKIES_RAW", "")
    media_upload_max_bytes: int = _clean_int_env("MEDIA_UPLOAD_MAX_BYTES", 50 * 1024 * 1024)
    ffmpeg_binary: str = _clean_env_value("FFMPEG_BINARY", "ffmpeg")
    transcription_model: str = _clean_env_value(
        "OPENAI_TRANSCRIPTION_MODEL",
        _clean_env_value("TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"),
    )
    transcription_max_bytes: int = _clean_int_env("TRANSCRIPTION_MAX_BYTES", 25000000)
    suggested_sources_model: str = _clean_env_value("SUGGESTED_SOURCES_MODEL", "gpt-4o-mini")
    suggested_sources_scan_interval_minutes: int = _clean_int_env("SUGGESTED_SOURCES_SCAN_INTERVAL_MINUTES", 10)
    suggested_sources_hub_cooldown_minutes: int = _clean_int_env("SUGGESTED_SOURCES_HUB_COOLDOWN_MINUTES", 60)
    suggested_sources_active_days: int = _clean_int_env("SUGGESTED_SOURCES_ACTIVE_DAYS", 30)
    suggested_sources_min_complete_sources: int = _clean_int_env("SUGGESTED_SOURCES_MIN_COMPLETE_SOURCES", 2)
    suggested_sources_context_limit: int = _clean_int_env("SUGGESTED_SOURCES_CONTEXT_LIMIT", 8)
    suggested_sources_chunks_per_source: int = _clean_int_env("SUGGESTED_SOURCES_CHUNKS_PER_SOURCE", 2)
    suggested_sources_batch_limit: int = _clean_int_env("SUGGESTED_SOURCES_BATCH_LIMIT", 3)
    suggested_sources_lock_ttl_seconds: int = _clean_int_env("SUGGESTED_SOURCES_LOCK_TTL_SECONDS", 540)


# Builds a fresh settings object from the current environment variables.
def get_settings() -> Settings:
    return Settings()
