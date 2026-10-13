"""Prefix-scoped application cleanup for publication integration suites."""

from test.e2e.helpers.api import API_BASE, assert_resp_200
from test.e2e.helpers.auth import auth_headers


async def cleanup_applications(client, token: str, prefix: str) -> None:
    if len(prefix) < 5:
        raise ValueError("application cleanup requires an isolated name prefix")
    cursor = None
    while True:
        params = {"name": prefix, "page_size": 100, "action": "visible"}
        if cursor:
            params["cursor"] = cursor
        page = assert_resp_200(
            await client.get(f"{API_BASE}/workflow/list", params=params, headers=auth_headers(token))
        )
        for app in page["data"]:
            if not app["name"].startswith(prefix):
                continue
            if app["flow_type"] == 5:
                assert_resp_200(
                    await client.post(
                        f"{API_BASE}/assistant/status", json={"id": app["id"], "status": 1}, headers=auth_headers(token)
                    )
                )
                assert_resp_200(
                    await client.post(
                        f"{API_BASE}/assistant/delete", params={"assistant_id": app["id"]}, headers=auth_headers(token)
                    )
                )
            else:
                assert_resp_200(
                    await client.patch(
                        f"{API_BASE}/workflow/status",
                        json={"flow_id": app["id"], "status": 1},
                        headers=auth_headers(token),
                    )
                )
                assert_resp_200(await client.delete(f"{API_BASE}/flows/{app['id']}", headers=auth_headers(token)))
        if not page["has_more"]:
            return
        cursor = page["next_cursor"]
        if not cursor:
            raise AssertionError("application cleanup requires a next cursor")
