"""F054 live publication tests; requires a dedicated deployment and seeded users.

Enable F054_E2E=1 and provide F054_E2E_TENANT_CODE (e2e-f054-*),
F054_E2E_{PUBLISHER,VIEWER,OUTSIDER}_{NAME,PASSWORD}, and
F054_E2E_{WORKFLOW,ASSISTANT}_TEMPLATE_ID. Publisher and viewer must share
a group in the dedicated tenant; outsider belongs to a different group there.
Both templates must be valid, offline applications visible to publisher.
"""

import os
from uuid import uuid4

import httpx
import pytest

from test.e2e.helpers.api import API_BASE, assert_resp_200, assert_resp_error
from test.e2e.helpers.applications import cleanup_applications
from test.e2e.helpers.auth import auth_headers, get_admin_token, get_user_token
from test.e2e.helpers.cleanup import ensure_test_tenant

PREFIX = "e2e-f054-publication-"
pytestmark = pytest.mark.skipif(os.environ.get("F054_E2E") != "1", reason="requires a dedicated F054 live deployment")


@pytest.fixture
async def deployment():
    async with httpx.AsyncClient(timeout=60) as client:
        admin = await get_admin_token(client)
        tenant_code = os.environ["F054_E2E_TENANT_CODE"]
        assert tenant_code.startswith("e2e-f054-")
        tenant = await ensure_test_tenant(client, admin, tenant_code)
        assert tenant["id"]
        tokens = {"admin": admin}
        for role in ("publisher", "viewer", "outsider"):
            tokens[role] = await get_user_token(
                client, os.environ[f"F054_E2E_{role.upper()}_NAME"], os.environ[f"F054_E2E_{role.upper()}_PASSWORD"]
            )
        await cleanup_applications(client, admin, PREFIX)
        try:
            yield client, tokens, tenant["id"]
        finally:
            await cleanup_applications(client, admin, PREFIX)


@pytest.mark.parametrize("resource_type", ["workflow", "assistant"])
@pytest.mark.parametrize("operator", ["publisher", "admin"])
async def test_publication_viewer_lifecycle(deployment, resource_type, operator):
    """AC1/2/3/4/5/6: publish, visible list/detail, write rejection, and revoke."""
    client, tokens, tenant_id = deployment
    headers = auth_headers(tokens["publisher"])
    template_id = os.environ[f"F054_E2E_{resource_type.upper()}_TEMPLATE_ID"]
    name = f"{PREFIX}{uuid4().hex[:12]}"
    if resource_type == "workflow":
        template = assert_resp_200(await client.get(f"{API_BASE}/workflow/get_one_flow/{template_id}", headers=headers))
        app = await client.post(
            f"{API_BASE}/workflow/create",
            json={"name": name, "flow_type": 10, "data": template["data"]},
            headers=headers,
        )
        assert app.status_code == 201
        body = app.json()
        assert {"status_code", "status_message", "data"} <= body.keys()
        assert body["status_code"] == 200
        created = body["data"]
        detail_url = f"{API_BASE}/workflow/get_one_flow/{created['id']}"
    else:
        template = assert_resp_200(await client.get(f"{API_BASE}/assistant/info/{template_id}", headers=headers))
        created = assert_resp_200(
            await client.post(
                f"{API_BASE}/assistant",
                json={"name": name, "prompt": template["prompt"], "logo": template.get("logo", "")},
                headers=headers,
            )
        )
        payload = {**template, "id": created["id"], "name": name}
        for field in ("tool_list", "flow_list", "knowledge_list"):
            payload[field] = [row["id"] for row in template.get(field, [])]
        assert_resp_200(await client.put(f"{API_BASE}/assistant", json=payload, headers=headers))
        detail_url = f"{API_BASE}/assistant/info/{created['id']}"
    app_id = created["id"]
    owner_detail = assert_resp_200(await client.get(detail_url, headers=headers))
    assert owner_detail["tenant_id"] == tenant_id

    async def change_status(status, legacy=False):
        actor_headers = auth_headers(tokens[operator])
        if resource_type == "assistant":
            response = await client.post(
                f"{API_BASE}/assistant/status", json={"id": app_id, "status": status}, headers=actor_headers
            )
        else:
            url = f"{API_BASE}/workflow/update/{app_id}" if legacy else f"{API_BASE}/workflow/status"
            response = await client.patch(url, json={"flow_id": app_id, "status": status}, headers=actor_headers)
        assert_resp_200(response)
        assert assert_resp_200(await client.get(detail_url, headers=headers))["status"] == status

    await change_status(2)
    viewer_headers = auth_headers(tokens["viewer"])
    assert assert_resp_200(await client.get(detail_url, headers=viewer_headers))["id"] == app_id
    page = assert_resp_200(
        await client.get(
            f"{API_BASE}/workflow/list",
            params={"name": name, "action": "visible", "page_size": 100},
            headers=viewer_headers,
        )
    )
    assert app_id in {row["id"] for row in page["data"]}
    decision = assert_resp_200(
        await client.post(
            f"{API_BASE}/permissions/check",
            json={"resource_type": resource_type, "resource_id": app_id, "action": "visible"},
            headers=auth_headers(tokens["outsider"]),
        )
    )
    assert decision["allowed"] is (operator == "admin")
    denied_url = f"{API_BASE}/assistant/status" if resource_type == "assistant" else f"{API_BASE}/workflow/status"
    denied_body = {"id": app_id, "status": 1} if resource_type == "assistant" else {"flow_id": app_id, "status": 1}
    denied = await client.request(
        "POST" if resource_type == "assistant" else "PATCH", denied_url, json=denied_body, headers=viewer_headers
    )
    assert_resp_error(denied, 403)
    await change_status(1, legacy=True)
    page = assert_resp_200(
        await client.get(
            f"{API_BASE}/workflow/list", params={"name": name, "action": "visible"}, headers=viewer_headers
        )
    )
    assert app_id not in {row["id"] for row in page["data"]}
    for cycle in range(3):
        await change_status(2, legacy=cycle % 2 == 0)
        assert assert_resp_200(await client.get(detail_url, headers=viewer_headers))["id"] == app_id
        page = assert_resp_200(
            await client.get(
                f"{API_BASE}/workflow/list",
                params={"name": name, "action": "visible", "page_size": 100},
                headers=viewer_headers,
            )
        )
        assert app_id in {row["id"] for row in page["data"]}
        await change_status(1, legacy=cycle % 2 == 1)
        page = assert_resp_200(
            await client.get(
                f"{API_BASE}/workflow/list", params={"name": name, "action": "visible"}, headers=viewer_headers
            )
        )
        assert app_id not in {row["id"] for row in page["data"]}
