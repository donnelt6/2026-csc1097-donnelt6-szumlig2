"""rate_limit.py: Implements Redis-backed rate limiting and exposes a shared limiter instance."""

import time
from dataclasses import dataclass
import logging

import redis
from redis.exceptions import RedisError

from ..core.config import get_settings

logger = logging.getLogger(__name__)


# Result object returned after each rate-limit check.
@dataclass
class RateLimitResult:
    allowed: bool
    remaining: int
    reset_in_seconds: int


# Service that tracks request counts in Redis using a fixed time window.
class RateLimiter:
    # Connect to Redis using the configured application URL.
    def __init__(self) -> None:
        settings = get_settings()
        self.redis = redis.Redis.from_url(settings.redis_url)

    # Check whether a key is still within its request allowance for the current window.
    def check(self, key: str, limit: int, window_seconds: int = 60) -> RateLimitResult:
        """
        Fixed-window rate limiter with Redis INCR + EXPIRE.
        """
        now = int(time.time())
        window = now // window_seconds
        redis_key = f"rl:{key}:{window}"
        try:
            # Increment the current window counter and set its expiry on first use.
            count = self.redis.incr(redis_key)
            if count == 1:
                self.redis.expire(redis_key, window_seconds)

            remaining = max(limit - count, 0)
            reset_in = window_seconds - (now % window_seconds)
            return RateLimitResult(allowed=count <= limit, remaining=remaining, reset_in_seconds=reset_in)
        except RedisError:
            # Fail open if Redis is unavailable.
            logger.warning("rate_limit.redis_unavailable", exc_info=True)
            return RateLimitResult(allowed=True, remaining=limit, reset_in_seconds=window_seconds)


# Shared limiter used by request dependency helpers.
rate_limiter = RateLimiter()
