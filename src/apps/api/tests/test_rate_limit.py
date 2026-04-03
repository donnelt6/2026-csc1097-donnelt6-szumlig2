"""Tests for the fixed-window Redis-backed rate limiter."""

import pytest

from app.services import rate_limit


# Redis stub used to control rate limiter behavior in tests.
# Test helpers and fixtures.
class FakeRedis:

    # Initializes the test helper state used by this class.
    def __init__(self) -> None:
        self.store: dict[str, int] = {}
        self.expirations: list[tuple[str, int]] = []

    # Helper used by the surrounding test code.
    def incr(self, key: str) -> int:
        self.store[key] = self.store.get(key, 0) + 1
        return self.store[key]

    # Helper used by the surrounding test code.
    def expire(self, key: str, ttl: int) -> None:
        self.expirations.append((key, ttl))


# Verifies that rate limiter blocks after limit.
# Rate limiting tests.
def test_rate_limiter_blocks_after_limit(monkeypatch) -> None:

    # Uses FakeRedis; expect third request to be blocked at limit=2.
    fake_redis = FakeRedis()
    monkeypatch.setattr(rate_limit.redis.Redis, "from_url", lambda url: fake_redis)
    monkeypatch.setattr(rate_limit.time, "time", lambda: 120)

    limiter = rate_limit.RateLimiter()
    first = limiter.check("user-1", limit=2, window_seconds=60)
    second = limiter.check("user-1", limit=2, window_seconds=60)
    third = limiter.check("user-1", limit=2, window_seconds=60)

    assert first.allowed is True
    assert second.allowed is True
    assert third.allowed is False
    assert third.remaining == 0


# Verifies that rate limiter fails open on redis error.
def test_rate_limiter_fails_open_on_redis_error(monkeypatch) -> None:
    # Simulates Redis failure; expect allow=True to avoid hard blocking.
    fake_redis = FakeRedis()
    monkeypatch.setattr(rate_limit.redis.Redis, "from_url", lambda url: fake_redis)
    limiter = rate_limit.RateLimiter()

    # Helper used by the surrounding test code.
    def raise_error(key: str) -> int:
        raise rate_limit.RedisError("boom")

    monkeypatch.setattr(limiter.redis, "incr", raise_error)
    result = limiter.check("user-1", limit=1, window_seconds=60)
    assert result.allowed is True
