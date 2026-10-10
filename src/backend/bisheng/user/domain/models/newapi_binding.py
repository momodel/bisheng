"""Global user credentials; balances remain exclusively in NEW API."""

from sqlalchemy import UniqueConstraint
from sqlmodel import Field

from bisheng.common.models.base import SQLModelSerializable


class NewApiUserBinding(SQLModelSerializable, table=True):
    __tablename__ = "newapi_user_binding"
    __table_args__ = (UniqueConstraint("gateway_url", "token_id"), UniqueConstraint("gateway_url", "mo_user_id"))

    user_id: int = Field(primary_key=True)
    mo_user_id: str = Field(max_length=128)
    gateway_url: str = Field(max_length=255)
    token_id: int
    encrypted_key: str = Field(max_length=2048, exclude=True)
