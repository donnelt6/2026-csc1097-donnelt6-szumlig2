from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import ChatAnalyticsSummary, ChatAnalyticsTrends, MembershipRole
from ..services.store import store
from .access import require_accepted, require_hub_member
from .errors import raise_postgrest_error

router = APIRouter(prefix="/hubs/{hub_id}/analytics", tags=["analytics"])


def _require_owner_or_admin(role: MembershipRole) -> None:
    if role not in {MembershipRole.owner, MembershipRole.admin}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hub owners and admins can view analytics.",
        )


@router.get(
    "/summary",
    response_model=ChatAnalyticsSummary,
    dependencies=[Depends(rate_limit_user_ip("chat:read", "rate_limit_read_per_minute"))],
)
def get_summary(
    hub_id: UUID,
    days: int | None = Query(default=None, ge=1, le=90),
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> ChatAnalyticsSummary:
    try:
        member = require_hub_member(client, str(hub_id), current_user.id)
        require_accepted(member)
        _require_owner_or_admin(member.role)
        return store.get_hub_chat_analytics_summary(str(hub_id), days=days)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hub not found.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.get(
    "/trends",
    response_model=ChatAnalyticsTrends,
    dependencies=[Depends(rate_limit_user_ip("chat:read", "rate_limit_read_per_minute"))],
)
def get_trends(
    hub_id: UUID,
    days: int | None = Query(default=None, ge=1, le=90),
    client: Client = Depends(get_supabase_user_client),
    current_user: CurrentUser = Depends(get_current_user),
) -> ChatAnalyticsTrends:
    try:
        member = require_hub_member(client, str(hub_id), current_user.id)
        require_accepted(member)
        _require_owner_or_admin(member.role)
        return store.get_hub_chat_analytics_trends(str(hub_id), days=days)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hub not found.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)
