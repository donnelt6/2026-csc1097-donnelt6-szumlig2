import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


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


def get_settings() -> Settings:
    return Settings()
