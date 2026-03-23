from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client, rate_limit_user_ip
from ..schemas import Hub, HubCreate, HubFavouriteToggle
from ..services.store import store
from .errors import raise_postgrest_error

router = APIRouter(prefix="/hubs", tags=["hubs"])


@router.get(
    "",
    response_model=list[Hub],
    dependencies=[Depends(rate_limit_user_ip("hubs:read", "rate_limit_read_per_minute"))],
)
def list_hubs(
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> list[Hub]:
    try:
        return store.list_hubs(client, current_user.id)
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "",
    response_model=Hub,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_user_ip("hubs:write", "rate_limit_write_per_minute"))],
)
def create_hub(
    payload: HubCreate,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> Hub:
    try:
        hub = store.create_hub(client, current_user.id, payload)
        store.log_activity(client, hub.id, current_user.id, "created", "hub", hub.id, {"name": hub.name})
        return hub
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post(
    "/{hub_id}/access",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit_user_ip("hubs:read", "rate_limit_read_per_minute"))],
)
def track_hub_access(
    hub_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> None:
    try:
        store.update_hub_access(client, hub_id, current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)


@router.patch(
    "/{hub_id}/favourite",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit_user_ip("hubs:write", "rate_limit_write_per_minute"))],
)
def toggle_hub_favourite(
    hub_id: str,
    payload: HubFavouriteToggle,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> None:
    try:
        store.toggle_hub_favourite(client, hub_id, current_user.id, payload.is_favourite)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)
