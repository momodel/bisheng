from typing import Union

from sqlalchemy.orm import selectinload
from sqlmodel import Session, select
from sqlmodel.ext.asyncio.session import AsyncSession

from bisheng.common.repositories.implementations.base_repository_impl import BaseRepositoryImpl
from bisheng.core.database import get_sync_db_session
from bisheng.user.domain.models.user import User
from bisheng.user.domain.repositories.interfaces.user_repository import UserRepository


class UserRepositoryImpl(BaseRepositoryImpl[User, int], UserRepository):
    """Shared link repository implementation"""

    @staticmethod
    def get_mo_user(mo_user_id: str) -> User | None:
        with get_sync_db_session() as session:
            return session.exec(
                select(User).where(User.source == "mo", User.external_id == "mo:" + mo_user_id)
            ).one_or_none()

    def __init__(self, session: Union[AsyncSession, Session]):
        super().__init__(session, User)

    async def get_user_with_groups_and_roles_by_user_id(self, user_id: int) -> User | None:
        statement = (
            select(User)
            .where(User.user_id == user_id)
            .options(
                selectinload(User.groups),  # type: ignore
                selectinload(User.roles),  # type: ignore
                selectinload(User.departments),  # type: ignore
            )
        )

        result = await self.session.exec(statement)
        user = result.first()
        return user

    def get_user_with_groups_and_roles_by_user_id_sync(self, user_id: int) -> User | None:
        statement = (
            select(User)
            .where(User.user_id == user_id)
            .options(
                selectinload(User.groups),  # type: ignore
                selectinload(User.roles),  # type: ignore
                selectinload(User.departments),  # type: ignore
            )
        )

        result = self.session.exec(statement)
        user = result.first()
        return user
