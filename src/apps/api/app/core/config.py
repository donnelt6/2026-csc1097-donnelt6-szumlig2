from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "sources"
    dev_user_id: str = ""
    redis_url: str = "redis://localhost:6379/0"
    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    chat_model: str = "gpt-4o-mini"
    top_k: int = 6
    min_similarity: float = 0.55
    max_citations: int = 3
    rate_limit_chat_per_minute: int = 20
    rate_limit_sources_per_minute: int = 30
    environment: str = "local"
    allowed_origins: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    # Normalize comma-separated origins from env into a list for CORS.
    if isinstance(settings.allowed_origins, str):
        origins = [item.strip() for item in settings.allowed_origins.split(",") if item.strip()]
        settings.allowed_origins = origins
    return settings
