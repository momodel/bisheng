from pydantic import BaseModel, Field, SecretStr


class NewApiBindingRequest(BaseModel):
    user_id: int = Field(gt=0)
    mo_user_id: str = Field(min_length=1, max_length=128)
    token_id: int = Field(gt=0)
    gateway_url: str = Field(min_length=1, max_length=255)
    key: SecretStr
    mo_backend_token: SecretStr
