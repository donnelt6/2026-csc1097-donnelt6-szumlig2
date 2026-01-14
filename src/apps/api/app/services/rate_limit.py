import time
from dataclasses import dataclass

import redis
from redis.exceptions import RedisError

from ..core.config import get_settings


@dataclass
class RateLimitResult:
    allowed: bool
    remaining: int
    reset_in_seconds: int


class RateLimiter:
    def __init__(self) -> None:
        settings = get_settings()
        self.redis = redis.Redis.from_url(settings.redis_url)

    def check(self, key: str, limit: int, window_seconds: int = 60) -> RateLimitResult:
        """
        Fixed-window rate limiter with Redis INCR + EXPIRE.
        """
        now = int(time.time())
        window = now // window_seconds
        redis_key = f"rl:{key}:{window}"
        try:
            count = self.redis.incr(redis_key)
            if count == 1:
                self.redis.expire(redis_key, window_seconds)

            remaining = max(limit - count, 0)
            reset_in = window_seconds - (now % window_seconds)
            return RateLimitResult(allowed=count <= limit, remaining=remaining, reset_in_seconds=reset_in)
        except RedisError:
            # Fail open if Redis is unavailable.
            return RateLimitResult(allowed=True, remaining=limit, reset_in_seconds=window_seconds)


rate_limiter = RateLimiter()
