from fastapi import APIRouter, Depends

from ..dependencies import CurrentUser, get_current_user, rate_limit_user_ip
from ..schemas import CurrentUser as CurrentUserSchema

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "/me",
    response_model=CurrentUserSchema,
    dependencies=[Depends(rate_limit_user_ip("users:read", "rate_limit_read_per_minute"))],
)
def get_me(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUserSchema:
    return CurrentUserSchema(id=current_user.id, email=current_user.email)
