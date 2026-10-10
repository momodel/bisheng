from copy import deepcopy

from bisheng.common.errcode.user import NewApiBindingConflictError, NewApiBindingMissingError
from bisheng.common.services.config_service import settings
from bisheng.common.utils.newapi import gateway_identity, matches_gateway
from bisheng.core.config.settings import decrypt_token, encrypt_token
from bisheng.user.domain.models.newapi_binding import NewApiUserBinding
from bisheng.user.domain.repositories.newapi_binding_repository import NewApiBindingRepository
from bisheng.user.domain.schemas.newapi import NewApiBindingRequest

_URL_FIELDS = (
    "base_url",
    "openai_api_base",
    "openai_base_url",
    "api_base",
    "azure_endpoint",
    "endpoint",
    "anthropic_api_url",
    "zhipuai_api_base",
)
_KEY_FIELDS = ("api_key", "openai_api_key", "anthropic_api_key", "zhipuai_api_key", "api_token")


class NewApiCredentialService:
    @staticmethod
    def base_url() -> str:
        config = settings.get_all_config()
        return (config.get("newapi_base_url", settings.newapi_base_url) or "").strip().rstrip("/")

    @classmethod
    def personal_key(cls, user_id: int, base_url: str) -> str:
        binding = NewApiBindingRepository.get(user_id)
        if not binding or gateway_identity(binding.gateway_url) != gateway_identity(base_url):
            raise NewApiBindingMissingError()
        return decrypt_token(binding.encrypted_key.encode())

    @classmethod
    async def bind(cls, request: NewApiBindingRequest) -> None:
        base_url = cls.base_url()
        if not base_url or gateway_identity(request.gateway_url) != gateway_identity(base_url):
            raise NewApiBindingConflictError()
        key = request.key.get_secret_value().strip()
        if not key or any(char.isspace() for char in key):
            raise NewApiBindingConflictError()
        await NewApiBindingRepository.bind(
            NewApiUserBinding(
                user_id=request.user_id,
                mo_user_id=request.mo_user_id,
                token_id=request.token_id,
                gateway_url=base_url,
                encrypted_key=encrypt_token(key).decode(),
            )
        )

    @classmethod
    def model_params(cls, params: dict, user_id: int) -> dict:
        base_url = cls.base_url()
        urls = [params[field] for field in _URL_FIELDS if params.get(field)]
        if not base_url or not any(matches_gateway(url, base_url) for url in urls):
            return dict(params)
        if not all(matches_gateway(url, base_url) for url in urls):
            raise NewApiBindingConflictError()
        result = dict(params)
        key = cls.personal_key(user_id, base_url)
        if not any(field in result for field in _KEY_FIELDS):
            result["api_key"] = key
        for field in _KEY_FIELDS:
            if field in result:
                result[field] = key
        for field in ("default_headers", "headers"):
            if isinstance(result.get(field), dict):
                result[field] = cls.auth_headers(result[field], key)
        return result

    @staticmethod
    def auth_headers(headers: dict, key: str) -> dict:
        result = {
            name: value
            for name, value in headers.items()
            if name.lower() not in {"authorization", "x-api-key", "api-key"}
        }
        result["Authorization"] = "Bearer " + key
        return result

    @classmethod
    def tool_params(cls, params: dict, user_id: int) -> dict:
        base_url = cls.base_url()
        if not base_url or not matches_gateway(params.get("url") or "", base_url):
            return params
        result = dict(params)
        result["params"] = deepcopy(params["params"])
        key = cls.personal_key(user_id, base_url)
        result["api_key"] = key
        custom_header = result["params"].get("parameter_name", "").lower()
        headers = {
            name: value for name, value in (result.get("headers") or {}).items() if name.lower() != custom_header
        }
        result["headers"] = cls.auth_headers(headers, key)
        result["credential_base_url"] = base_url
        # NEW API authenticates through Authorization, not a tool-defined query key.
        result["params"].pop("api_location", None)
        result["params"].pop("parameter_name", None)
        return result
