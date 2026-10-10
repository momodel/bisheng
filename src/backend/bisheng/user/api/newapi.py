from fastapi import APIRouter, Depends

from bisheng.common.errcode.user import UserValidateError
from bisheng.common.schemas.api import resp_200
from bisheng.user.domain.schemas.newapi import NewApiBindingRequest
from bisheng.user.domain.services.auth import LoginUser
from bisheng.user.domain.services.newapi import NewApiCredentialService
from bisheng.user.domain.services.user import UserService

router = APIRouter()


@router.post("/user/newapi_binding")
async def bind_newapi_key(
    request: NewApiBindingRequest,
    admin: LoginUser = Depends(LoginUser.get_admin_user),
):
    """Bind a MO-provisioned key without exposing credentials in the response."""
    if not UserService.validate_mo_backend_token(request.mo_backend_token.get_secret_value()):
        raise UserValidateError()
    await NewApiCredentialService.bind(request)
    return resp_200(data={"user_id": request.user_id, "token_id": request.token_id})
