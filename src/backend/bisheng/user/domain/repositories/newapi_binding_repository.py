from sqlalchemy.exc import IntegrityError

from bisheng.common.errcode.user import NewApiBindingConflictError, UserValidateError
from bisheng.core.database import get_async_db_session, get_sync_db_session
from bisheng.user.domain.models.newapi_binding import NewApiUserBinding
from bisheng.user.domain.models.user import User


class NewApiBindingRepository:
    @staticmethod
    def get(user_id: int) -> NewApiUserBinding | None:
        with get_sync_db_session() as session:
            return session.get(NewApiUserBinding, user_id)

    @staticmethod
    async def bind(binding: NewApiUserBinding) -> None:
        async with get_async_db_session() as session:
            user = await session.get(User, binding.user_id)
            if not user or user.delete:
                raise UserValidateError()
            current = await session.get(NewApiUserBinding, binding.user_id)
            if current and (current.mo_user_id != binding.mo_user_id or current.gateway_url != binding.gateway_url):
                raise NewApiBindingConflictError()
            if current:
                current.token_id = binding.token_id
                current.encrypted_key = binding.encrypted_key
            else:
                current = binding
            session.add(current)
            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                raise NewApiBindingConflictError() from exc
