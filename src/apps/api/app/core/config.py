"""config.py: Defines application settings, validates environment values, and exposes a cached settings loader."""

from functools import lru_cache
from typing import List
from urllib.parse import urlparse

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings


# Application settings model and defaults.
class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "sources"
    redis_url: str = "redis://localhost:6379/0"
    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    chat_model: str = "gpt-4o-mini"
    top_k: int = 6
    min_similarity: float = 0.50
    max_citations: int = 3
    chat_rewrite_enabled: bool = True
    chat_rewrite_history_messages: int = 5
    retrieval_candidate_pool: int = 18
    retrieval_mmr_lambda: float = 0.75
    retrieval_same_source_penalty: float = 0.10
    chat_rerank_relative_cutoff: float = 0.82
    chat_diversity_confidence_gap: float = 0.08
    rate_limit_chat_per_minute: int = 20
    rate_limit_sources_per_minute: int = 30
    rate_limit_read_per_minute: int = 120
    rate_limit_write_per_minute: int = 60
    rate_limit_health_per_minute: int = 60
    rate_limit_ip_multiplier: float = 3.0
    trust_proxy_headers: bool = False
    environment: str = "local"
    allowed_origins: str = ""
    faq_default_count: int = 6
    faq_context_chunks_per_source: int = 4
    faq_max_citations: int = 3
    faq_min_similarity: float = 0.55
    guide_default_steps: int = 8
    guide_context_chunks_per_source: int = 5
    guide_max_citations: int = 3
    guide_min_similarity: float = 0.3
    analytics_summary_days: int = 30
    analytics_trend_days: int = 14
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://cloud.langfuse.com"
    cors_allowed_origins: List[str] = Field(default_factory=list)

    class Config:
        env_file = ".env"
        extra = "ignore"

    # Normalise the environment name so the rest of the config logic can rely on a consistent value.
    @field_validator("environment", mode="before")
    @classmethod
    def normalize_environment(cls, value: object) -> str:
        cleaned = str(value or "local").strip().lower()
        return cleaned or "local"

    # Apply CORS defaults for local development and require explicit origins elsewhere.
    @model_validator(mode="after")
    def apply_environment_origin_rules(self) -> "Settings":
        # Parse any configured origins first so validation happens before fallback logic is applied.
        origins = self._parse_and_validate_origins(self.allowed_origins)
        if self.environment == "local" and not origins:
            self.allowed_origins = "http://localhost:3000,http://127.0.0.1:3000"
            origins = self._parse_and_validate_origins(self.allowed_origins)
        if self.environment != "local" and not origins:
            raise ValueError("ALLOWED_ORIGINS must be configured when ENVIRONMENT is not local.")
        self.cors_allowed_origins = origins
        return self

    # Split the allowed origins string and reject values that are not valid HTTP(S) origins.
    @staticmethod
    def _parse_and_validate_origins(value: str) -> List[str]:
        origins = [item.strip() for item in value.split(",") if item.strip()]
        for origin in origins:
            parsed = urlparse(origin)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError(f"Invalid CORS origin: {origin}")
        return origins


# Return a cached Settings instance so the app reuses one validated config object.
@lru_cache
def get_settings() -> Settings:
    return Settings()
