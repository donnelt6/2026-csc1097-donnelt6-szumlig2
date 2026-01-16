from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError
from supabase import Client

from ..dependencies import CurrentUser, get_current_user, get_supabase_user_client
from ..schemas import Hub, HubCreate
from ..services.store import store
from .errors import raise_postgrest_error

router = APIRouter(prefix="/hubs", tags=["hubs"])


@router.get("", response_model=list[Hub])
def list_hubs(
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> list[Hub]:
    try:
        return store.list_hubs(client, current_user.id)
    except APIError as exc:
        raise_postgrest_error(exc)


@router.post("", response_model=Hub, status_code=status.HTTP_201_CREATED)
def create_hub(
    payload: HubCreate,
    current_user: CurrentUser = Depends(get_current_user),
    client: Client = Depends(get_supabase_user_client),
) -> Hub:
    try:
        return store.create_hub(client, current_user.id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except APIError as exc:
        raise_postgrest_error(exc)
