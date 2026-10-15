"""Offline regression tests for gateway boundaries, binding and runtime credentials.

Run with unittest to avoid bootstrapping middleware-dependent application fixtures:
python -m unittest discover -s test/user -p test_newapi_credits.py -v
"""

import asyncio
import importlib.util
import sys
import types
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from cryptography.fernet import Fernet
from httpx import Request, Response
from openai import AuthenticationError
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import Field, SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from bisheng.common.errcode.flow import WorkFlowTaskOtherError
from bisheng.common.errcode.user import (
    NewApiBindingConflictError,
    NewApiBindingMissingError,
    NewApiInsufficientCreditsError,
    UserValidateError,
)
from bisheng.common.utils.newapi import check_personal_model_error, gateway_identity, matches_gateway
from bisheng.user.domain.models.newapi_binding import NewApiUserBinding
from bisheng.user.domain.schemas.newapi import NewApiBindingRequest

BACKEND = Path(__file__).resolve().parents[2]


def module(name, **attributes):
    result = types.ModuleType(name)
    result.__dict__.update(attributes)
    return result


def load(name, relative_path):
    spec = importlib.util.spec_from_file_location(name, BACKEND / relative_path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class GatewayTests(unittest.TestCase):
    def test_only_same_origin_and_path_boundary_match(self):
        base = "https://gateway.example/proxy"
        for url in (base, base + "/v1/chat/completions", "https://GATEWAY.example:443/proxy/v1"):
            with self.subTest(url=url):
                self.assertTrue(matches_gateway(url, base))
        for url in (
            "https://gateway.example.evil/proxy",
            "https://evil/?target=" + base,
            "http://gateway.example/proxy",
            "https://gateway.example:8443/proxy",
            "https://gateway.example/proxy-other/v1",
            "https://gateway.example/proxy/../private",
            "https://gateway.example/proxy/%2e%2e/private",
            "https://user@gateway.example/proxy",
            "/proxy/v1",
            "https://gateway.example\\@evil/proxy",
        ):
            with self.subTest(url=url):
                self.assertFalse(matches_gateway(url, base))

    def test_empty_disables_and_root_accepts_model_paths(self):
        self.assertFalse(matches_gateway("https://gateway.example/v1", ""))
        self.assertTrue(matches_gateway("https://gateway.example/v1/embeddings", "https://gateway.example/"))
        self.assertTrue(matches_gateway("https://gateway.example/v1?x=1", "https://gateway.example"))

    def test_invalid_configuration_is_not_silently_disabled(self):
        for url in ("gateway.example", "https://gateway.example?secret=x", "https://gateway.example\n"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                gateway_identity(url)


class CredentialTests(unittest.TestCase):
    def setUp(self):
        self.fernet = Fernet(Fernet.generate_key())
        self.settings = SimpleNamespace(
            newapi_base_url="", get_all_config=lambda: {"newapi_base_url": "https://gateway.example"}
        )
        self.repository = SimpleNamespace(get=MagicMock(), bind=AsyncMock())
        self.repository.get.side_effect = lambda user_id: SimpleNamespace(
            gateway_url="https://gateway.example",
            encrypted_key=self.fernet.encrypt(f"sk-user-{user_id}".encode()).decode(),
        )
        stubs = {
            "bisheng.common.services.config_service": module("config", settings=self.settings),
            "bisheng.core.config.settings": module(
                "crypto",
                encrypt_token=lambda value: self.fernet.encrypt(value.encode()),
                decrypt_token=lambda value: self.fernet.decrypt(value).decode(),
            ),
            "bisheng.user.domain.repositories.newapi_binding_repository": module(
                "repo", NewApiBindingRepository=self.repository
            ),
        }
        with patch.dict(sys.modules, stubs):
            self.service = load(
                "newapi_credentials_test", "bisheng/user/domain/services/newapi.py"
            ).NewApiCredentialService

    def test_two_users_get_different_keys_without_mutating_shared_configuration(self):
        original = {
            "base_url": "https://gateway.example/v1",
            "api_key": "shared",
            "default_headers": {"authorization": "Bearer shared", "X-Request-Id": "test"},
        }
        first = self.service.model_params(original, 1)
        second = self.service.model_params(original, 2)
        self.assertEqual(first["api_key"], "sk-user-1")
        self.assertEqual(second["api_key"], "sk-user-2")
        self.assertEqual(first["default_headers"]["Authorization"], "Bearer sk-user-1")
        self.assertEqual(original["api_key"], "shared")
        self.assertEqual(original["default_headers"]["authorization"], "Bearer shared")

    def test_non_gateway_and_disabled_requests_do_not_read_personal_credentials(self):
        params = {"base_url": "https://other.example/v1", "api_key": "other"}
        self.assertEqual(self.service.model_params(params, 1), params)
        self.settings.get_all_config = lambda: {"newapi_base_url": ""}
        self.assertEqual(
            self.service.model_params({"base_url": "https://gateway.example/v1"}, 1),
            {"base_url": "https://gateway.example/v1"},
        )
        self.repository.get.assert_not_called()

    def test_personal_key_marker_tracks_successful_replacement(self):
        params, used = self.service.prepare_model_params({"base_url": "https://gateway.example/v1"}, 1)
        self.assertTrue(used)
        self.assertEqual(params["api_key"], "sk-user-1")
        _, used = self.service.prepare_model_params({"base_url": "https://other.example/v1"}, 1)
        self.assertFalse(used)
        self.settings.get_all_config = lambda: {"newapi_base_url": ""}
        _, used = self.service.prepare_model_params({"base_url": "https://gateway.example/v1"}, 1)
        self.assertFalse(used)

    def test_missing_binding_and_changed_gateway_fail_closed(self):
        self.repository.get.return_value = None
        self.repository.get.side_effect = None
        with self.assertRaises(NewApiBindingMissingError):
            self.service.model_params({"base_url": "https://gateway.example/v1", "api_key": "shared"}, 1)
        self.repository.get.return_value = SimpleNamespace(gateway_url="https://previous.example")
        with self.assertRaises(NewApiBindingMissingError):
            self.service.personal_key(1, "https://gateway.example")

    def test_conflicting_url_aliases_never_receive_a_personal_key(self):
        with self.assertRaises(NewApiBindingConflictError):
            self.service.model_params({"base_url": "https://evil.example", "api_base": "https://gateway.example"}, 1)
        self.repository.get.assert_not_called()

    def test_all_supported_key_aliases_and_missing_key(self):
        for name in ("api_key", "openai_api_key", "anthropic_api_key", "zhipuai_api_key", "api_token"):
            with self.subTest(name=name):
                self.assertEqual(
                    self.service.model_params({"api_base": "https://gateway.example/v1", name: "shared"}, 7)[name],
                    "sk-user-7",
                )
        self.assertEqual(self.service.model_params({"base_url": "https://gateway.example"}, 7)["api_key"], "sk-user-7")

    def test_native_provider_url_aliases_use_the_personal_key(self):
        for field in ("zhipuai_api_base", "anthropic_api_url"):
            with self.subTest(field=field):
                result = self.service.model_params({field: "https://gateway.example/v1", "api_key": "shared"}, 7)
                self.assertEqual(result["api_key"], "sk-user-7")

    def test_custom_tool_authentication_header_is_removed(self):
        result = self.service.tool_params(
            {
                "url": "https://gateway.example",
                "api_key": "shared",
                "headers": {"X-Custom-Token": "shared", "X-Trace": "trace"},
                "params": {"api_location": "header", "parameter_name": "X-Custom-Token"},
            },
            7,
        )
        self.assertEqual(result["headers"], {"X-Trace": "trace", "Authorization": "Bearer sk-user-7"})

    def test_tool_uses_personal_bearer_and_removes_configured_query_auth(self):
        source = {
            "url": "https://gateway.example",
            "api_key": "shared",
            "headers": {"x-api-key": "shared"},
            "params": {"api_location": "query", "parameter_name": "key", "path": "/v1/chat/completions"},
        }
        result = self.service.tool_params(source, 2)
        self.assertEqual(result["headers"], {"Authorization": "Bearer sk-user-2"})
        self.assertNotIn("api_location", result["params"])
        self.assertEqual(source["params"]["api_location"], "query")
        self.assertEqual(result["credential_base_url"], "https://gateway.example")

    def test_binding_encrypts_key_and_rejects_a_different_gateway(self):
        request = NewApiBindingRequest(
            user_id=1,
            mo_user_id="mo-1",
            token_id=8,
            gateway_url="https://gateway.example/",
            key="sk-private",
            mo_backend_token="private-backend-token",
        )
        asyncio.run(self.service.bind(request))
        saved = self.repository.bind.call_args.args[0]
        self.assertEqual(self.fernet.decrypt(saved.encrypted_key.encode()), b"sk-private")
        self.assertNotIn("encrypted_key", saved.model_dump())
        self.assertNotIn("sk-private", repr(request))
        request.gateway_url = "https://other.example"
        with self.assertRaises(NewApiBindingConflictError):
            asyncio.run(self.service.bind(request))


def invalid_token_error(*, status=401, error_type="new_api_error", message="Invalid token (request id: example)"):
    body = {"error": {"code": "", "message": message, "type": error_type}}
    return AuthenticationError(
        f"Error code: {status} - {body}",
        response=Response(status, request=Request("POST", "https://gateway.example/v1/chat/completions")),
        body=body,
    )


class PersonalModelErrorTests(unittest.TestCase):
    def test_invalid_token_is_reported_as_insufficient_credits(self):
        for nested in (True, False):
            error = invalid_token_error()
            if not nested:
                error.body = error.body["error"]
            with self.subTest(nested=nested), self.assertRaises(NewApiInsufficientCreditsError) as caught:
                check_personal_model_error(error, True)
            self.assertIs(caught.exception.__cause__, error)
            self.assertEqual(caught.exception.to_dict()["status_code"], 10643)
            # The workflow transports str(error) through Redis before building its response.
            response = WorkFlowTaskOtherError(exception=str(caught.exception)).to_dict()
            self.assertEqual(response["data"]["exception"], "积分不足,请联系管理员")

    def test_unrelated_errors_are_not_translated(self):
        for personal, error in (
            (False, invalid_token_error()),
            (True, invalid_token_error(status=403)),
            (True, invalid_token_error(error_type="authentication_error")),
            (True, invalid_token_error(message="Upstream channel unavailable")),
            (True, RuntimeError("Invalid token")),
        ):
            with self.subTest(personal=personal, error=error):
                self.assertIsNone(check_personal_model_error(error, personal))

    def test_all_model_call_wrappers_translate_only_personal_requests(self):
        stubs = {
            "bisheng.common.services": module("services", telemetry_service=MagicMock()),
            "bisheng.common.schemas.telemetry.event_data_schema": module("events", ModelInvokeEventData=MagicMock()),
            "bisheng.common.services.metric_log": module("metrics", emit_metric=MagicMock()),
            "bisheng.core.cache.redis_manager": module(
                "redis", get_redis_client=AsyncMock(), get_redis_client_sync=MagicMock()
            ),
            "bisheng.core.logger": module("logger", trace_id_var=MagicMock()),
            "bisheng.llm.domain.const": module(
                "const",
                LLM_CACHE={},
                LLMModelStatus=SimpleNamespace(NORMAL=SimpleNamespace(value=0), ERROR=SimpleNamespace(value=1)),
            ),
        }
        with patch.dict(sys.modules, stubs):
            utils = load("newapi_model_utils_test", "bisheng/llm/domain/utils.py")
        utils.upload_telemetry_log = MagicMock()
        error = invalid_token_error()

        def call(_self):
            raise error

        async def async_call(_self):
            raise error

        def stream(_self):
            yield "partial"
            raise error

        async def async_stream(_self):
            yield "partial"
            raise error

        async def consume_async_stream(iterator):
            return [item async for item in iterator]

        for personal in (True, False):
            model = SimpleNamespace(
                _personal_model_key_used=personal,
                server_info=SimpleNamespace(limit_flag=False),
                model_info=SimpleNamespace(model_type="llm"),
                sync_update_model_status=MagicMock(),
                update_model_status=AsyncMock(),
            )
            calls = (
                lambda model=model: utils.wrapper_bisheng_model_limit_check(call)(model),
                lambda model=model: asyncio.run(utils.wrapper_bisheng_model_limit_check_async(async_call)(model)),
                lambda model=model: list(utils.wrapper_bisheng_model_generator(stream)(model)),
                lambda model=model: asyncio.run(
                    consume_async_stream(utils.wrapper_bisheng_model_generator_async(async_stream)(model))
                ),
            )
            expected = NewApiInsufficientCreditsError if personal else AuthenticationError
            for index, invoke in enumerate(calls):
                with self.subTest(personal=personal, wrapper=index), self.assertRaises(expected) as caught:
                    invoke()
                if not personal:
                    self.assertIs(caught.exception, error)


class BindingTestUser(SQLModel, table=True):
    __tablename__ = "newapi_binding_test_user"
    user_id: int = Field(primary_key=True)
    delete: int = 0


class RepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(SQLModel.metadata.create_all)

        @asynccontextmanager
        async def session_provider():
            async with AsyncSession(self.engine, expire_on_commit=False) as session:
                yield session

        self.sessions = session_provider
        with patch.dict(
            sys.modules,
            {
                "bisheng.core.database": module(
                    "database", get_async_db_session=session_provider, get_sync_db_session=MagicMock()
                ),
                "bisheng.user.domain.models.user": module("users", User=BindingTestUser),
            },
        ):
            self.repository = load(
                "newapi_repository_test", "bisheng/user/domain/repositories/newapi_binding_repository.py"
            ).NewApiBindingRepository
        async with self.sessions() as session:
            session.add_all(
                [BindingTestUser(user_id=1), BindingTestUser(user_id=2), BindingTestUser(user_id=3, delete=1)]
            )
            await session.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    def binding(self, user_id=1, mo_user_id="mo-1", token_id=10):
        return NewApiUserBinding(
            user_id=user_id,
            mo_user_id=mo_user_id,
            token_id=token_id,
            gateway_url="https://gateway.example",
            encrypted_key="encrypted-test-value",
        )

    async def test_retry_is_idempotent_and_token_rotation_updates_the_same_row(self):
        await self.repository.bind(self.binding())
        await self.repository.bind(self.binding())
        await self.repository.bind(self.binding(token_id=11))
        async with self.sessions() as session:
            self.assertEqual((await session.get(NewApiUserBinding, 1)).token_id, 11)

    async def test_same_token_or_mo_identity_cannot_bind_to_another_user(self):
        await self.repository.bind(self.binding())
        for binding in (self.binding(2, "mo-2", 10), self.binding(2, "mo-1", 11), self.binding(mo_user_id="other")):
            with self.subTest(binding=binding), self.assertRaises(NewApiBindingConflictError):
                await self.repository.bind(binding)

    async def test_unknown_or_deleted_users_cannot_be_bound(self):
        for user_id in (3, 999):
            with self.subTest(user_id=user_id), self.assertRaises(UserValidateError):
                await self.repository.bind(self.binding(user_id=user_id))


class ToolBoundaryTests(unittest.TestCase):
    def setUp(self):
        class Base(BaseModel):
            model_config = ConfigDict(arbitrary_types_allowed=True)
            url: str
            params: dict
            headers: dict = {}
            client: object = None
            async_client: object = None

        with patch.dict(
            sys.modules,
            {
                "langchain_core.tools": module("tools", BaseTool=object),
                "bisheng_langchain.utils.openapi": module(
                    "openapi", convert_openapi_field_value=lambda value, kind: value
                ),
                "bisheng_langchain.gpts.tools.api_tools.base": module(
                    "base", APIToolBase=Base, MultArgsSchemaTool=object
                ),
            },
        ):
            self.tool_class = load(
                "bisheng_langchain.gpts.tools.api_tools.newapi_test",
                "bisheng_langchain/gpts/tools/api_tools/openapi.py",
            ).OpenApiTools

    def test_final_tool_path_is_checked_and_redirects_are_disabled(self):
        client = MagicMock()
        client.get.return_value = SimpleNamespace(status_code=200, text="ok")
        tool = self.tool_class(
            url="https://gateway.example/proxy",
            credential_base_url="https://gateway.example/proxy",
            params={"path": "/v1/models", "method": "get", "parameters": []},
            client=client,
        )
        self.assertEqual(tool.run(), "ok")
        self.assertFalse(client.get.call_args.kwargs["allow_redirects"])
        tool.params["path"] = "/../private"
        client.reset_mock()
        with self.assertRaises(ValueError):
            tool.run()
        client.get.assert_not_called()

    def test_async_tool_disables_redirects(self):
        client = SimpleNamespace(aget=AsyncMock(return_value="ok"))
        tool = self.tool_class(
            url="https://gateway.example",
            credential_base_url="https://gateway.example",
            params={"path": "/v1/models", "method": "get", "parameters": []},
            async_client=client,
        )
        self.assertEqual(asyncio.run(tool.arun()), "ok")
        self.assertFalse(client.aget.call_args.kwargs["allow_redirects"])


if __name__ == "__main__":
    unittest.main()
