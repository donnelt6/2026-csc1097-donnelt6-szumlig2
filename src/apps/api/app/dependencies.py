"""dependencies.py: Provides auth, client, and rate-limit dependencies for FastAPI routes."""

from dataclasses import dataclass
import logging
from typing import Optional

import httpx
from fastapi import Depends, Header, HTTPException, Request, Response, status
from supabase import Client, create_client

from .core.config import Settings, get_settings
from .services.rate_limit import RateLimitResult, RateLimiter, rate_limiter

logger = logging.getLogger(__name__)


# Lightweight authenticated user context passed into routes.
@dataclass
class CurrentUser:
    id: str
    email: Optional[str]


# Extract the bearer token from the Authorization header.
def get_access_token(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Authorization header.")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Authorization header.")
    return authorization.split(" ", 1)[1]


# Resolve the current Supabase user from the provided access token.
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
    except httpx.HTTPError as exc:
        logger.warning("api.auth.lookup_unreachable", extra={"supabase_url": settings.supabase_url}, exc_info=True)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Auth service unreachable.") from exc
    if resp.status_code == status.HTTP_401_UNAUTHORIZED:
        logger.info("api.auth.invalid_token", extra={"status_code": resp.status_code})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token.")
    if not resp.is_success:
        logger.warning("api.auth.lookup_failed", extra={"status_code": resp.status_code, "supabase_url": settings.supabase_url})
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Auth lookup failed.")
    data = resp.json()
    user_id = data.get("id")
    if not user_id:
        logger.warning("api.auth.invalid_payload")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload.")
    return CurrentUser(id=user_id, email=data.get("email"))


# Create a Supabase client scoped to the current user's token.
def get_supabase_user_client(
    token: str = Depends(get_access_token),
    settings: Settings = Depends(get_settings),
) -> Client:
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise RuntimeError("Supabase credentials missing. Set SUPABASE_URL and SUPABASE_ANON_KEY.")
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(token)
    return client


# Create a service-role Supabase client for privileged operations.
def get_supabase_service_client(settings: Settings = Depends(get_settings)) -> Client:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase credentials missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


# Return the shared application rate limiter.
def get_rate_limiter() -> RateLimiter:
    return rate_limiter


# Determine the caller IP, optionally trusting proxy headers when enabled.
def _get_client_ip(request: Request, settings: Settings) -> str:
    # Trust proxy headers only when explicitly enabled to avoid IP spoofing.
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


# Build the rate-limit headers returned on successful and blocked requests.
def _rate_limit_headers(limit: int, result: RateLimitResult, include_retry: bool) -> dict[str, str]:
    headers = {
        "X-RateLimit-Limit": str(limit),
        "X-RateLimit-Remaining": str(result.remaining),
        "X-RateLimit-Reset": str(result.reset_in_seconds),
    }
    if include_retry:
        headers["Retry-After"] = str(result.reset_in_seconds)
    return headers


# Pick the stricter user/IP result for response headers and retry timing.
def _select_rate_limit_result(
    user_limit: int,
    user_result: RateLimitResult,
    ip_limit: int,
    ip_result: RateLimitResult,
) -> tuple[int, RateLimitResult]:
    if not user_result.allowed:
        return user_limit, user_result
    if not ip_result.allowed:
        return ip_limit, ip_result
    if ip_result.remaining < user_result.remaining:
        return ip_limit, ip_result
    return user_limit, user_result


# Apply both per-user and per-IP rate limits to a route.
def rate_limit_user_ip(scope: str, limit_setting: str):
    def _rate_limit(
        request: Request,
        response: Response,
        current_user: CurrentUser = Depends(get_current_user),
        settings: Settings = Depends(get_settings),
        limiter: RateLimiter = Depends(get_rate_limiter),
    ) -> None:
        limit = getattr(settings, limit_setting)
        ip_limit = max(1, int(limit * settings.rate_limit_ip_multiplier))
        ip = _get_client_ip(request, settings)
        # Enforce both user and IP buckets to curb token sharing and IP rotation.
        user_result = limiter.check(f"{scope}:user:{current_user.id}", limit)
        ip_result = limiter.check(f"{scope}:ip:{ip}", ip_limit)
        header_limit, header_result = _select_rate_limit_result(limit, user_result, ip_limit, ip_result)
        for key, value in _rate_limit_headers(header_limit, header_result, include_retry=False).items():
            response.headers[key] = value
        if not (user_result.allowed and ip_result.allowed):
            headers = _rate_limit_headers(header_limit, header_result, include_retry=True)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Try again in {header_result.reset_in_seconds}s.",
                headers=headers,
            )

    return _rate_limit


# Apply IP-only rate limiting to routes that do not require authentication.
def rate_limit_ip_only(scope: str, limit_setting: str):
    def _rate_limit(
        request: Request,
        response: Response,
        settings: Settings = Depends(get_settings),
        limiter: RateLimiter = Depends(get_rate_limiter),
    ) -> None:
        limit = getattr(settings, limit_setting)
        ip = _get_client_ip(request, settings)
        result = limiter.check(f"{scope}:ip:{ip}", limit)
        for key, value in _rate_limit_headers(limit, result, include_retry=False).items():
            response.headers[key] = value
        if not result.allowed:
            headers = _rate_limit_headers(limit, result, include_retry=True)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Try again in {result.reset_in_seconds}s.",
                headers=headers,
            )

    return _rate_limit
