from fastapi import APIRouter, HTTPException, status

from ..schemas import Hub, HubCreate
from ..services.store import store

router = APIRouter(prefix="/hubs", tags=["hubs"])


@router.get("", response_model=list[Hub])
def list_hubs() -> list[Hub]:
    return store.list_hubs()


@router.post("", response_model=Hub, status_code=status.HTTP_201_CREATED)
def create_hub(payload: HubCreate) -> Hub:
    try:
        return store.create_hub(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
