from fastapi import APIRouter, Depends

from ..dependencies import CurrentUser, get_current_user
from ..schemas import CurrentUser as CurrentUserSchema

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=CurrentUserSchema)
def get_me(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUserSchema:
    return CurrentUserSchema(id=current_user.id, email=current_user.email)
