"""activity.py: Lists activity events for a user, either across hubs or within one hub."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import ActivityEvent
from ..services.store import store
from .access import require_accepted, require_hub_member
from .errors import raise_postgrest_error

router = APIRouter(prefix="/activity", tags=["activity"])


# Activity routes.

# Return recent activity, optionally limited to a specific hub.
@router.get(
    "",
    response_model=list[ActivityEvent],
    dependencies=[Depends(rate_limit_user_ip("activity:read", "rate_limit_read_per_minute"))],
)
def list_activity(
    hub_id: Optional[UUID] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> list[ActivityEvent]:
    try:
        accepted_hub_ids: list[str] | None = None
        if hub_id is not None:
            # When a hub is provided, enforce membership before listing its activity.
            member = require_hub_member(client, str(hub_id), current_user.id)
            require_accepted(member)
        else:
            # Without a hub filter, only include hubs the user has already accepted.
            accepted_hub_ids = [hub.id for hub in store.list_hubs(client, current_user.id)]
        return store.list_activity(
            client,
            current_user.id,
            hub_id=str(hub_id) if hub_id else None,
            hub_ids=accepted_hub_ids,
            limit=limit,
        )
    except APIError as exc:
        raise_postgrest_error(exc)
