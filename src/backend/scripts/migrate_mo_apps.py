#!/usr/bin/env python3
"""Export or import applications tagged ``MO`` as an offline migration bundle.

The bundle preserves workflow/assistant IDs, carries every non-deleted workflow
version, and includes referenced custom API tools without credentials. Import
is dry-run by default. ``--apply`` creates tools first, rewrites tool/model
references, creates offline applications owned by the global ``admin`` user,
then grants ``viewer`` to the target tenant's root department including child
departments.

MCP tools remain unsupported and block the whole batch during preflight.
Knowledge-base references are intentionally omitted: assistant knowledge links
are dropped, while workflow knowledge selections and their retrieval/rerank
settings are cleared with ``KNOWLEDGE_REFERENCE_DROPPED`` warnings.

Run from ``src/backend`` using the environment's normal ``config`` value::

    PYTHONPATH=./ .venv/bin/python scripts/migrate_mo_apps.py export \
      --tenant-id 1 --output /tmp/mo-apps.json
    PYTHONPATH=./ .venv/bin/python scripts/migrate_mo_apps.py import \
      --tenant-id 1 --bundle /tmp/mo-apps.json
    PYTHONPATH=./ .venv/bin/python scripts/migrate_mo_apps.py import \
      --tenant-id 1 --bundle /tmp/mo-apps.json --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import traceback
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import or_
from sqlmodel import col, select

_BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

from bisheng.common.dependencies.user_deps import UserPayload  # noqa: E402
from bisheng.common.services.config_service import settings  # noqa: E402
from bisheng.core.context.manager import close_app_context, initialize_app_context  # noqa: E402
from bisheng.core.context.tenant import (  # noqa: E402
    DEFAULT_TENANT_ID,
    bypass_tenant_filter,
    set_current_tenant_id,
    set_visible_tenant_ids,
)
from bisheng.core.database import get_async_db_session  # noqa: E402
from bisheng.database.models.assistant import Assistant, AssistantLink, AssistantStatus  # noqa: E402
from bisheng.database.models.department import DepartmentDao  # noqa: E402
from bisheng.database.models.flow import Flow, FlowStatus, FlowType  # noqa: E402
from bisheng.database.models.flow_version import FlowVersion  # noqa: E402
from bisheng.database.models.group_resource import ResourceTypeEnum  # noqa: E402
from bisheng.database.models.tag import Tag, TagBusinessTypeEnum, TagLink  # noqa: E402
from bisheng.llm.domain.const import LLMModelType  # noqa: E402
from bisheng.llm.domain.services.llm import LLMService  # noqa: E402
from bisheng.llm.domain.share_fallback import (  # noqa: E402
    aget_model_by_id_with_share_fallback,
    aget_server_by_id_with_share_fallback,
    avalidate_system_model_refs,
)
from bisheng.migration.mo_app_bundle import (  # noqa: E402
    BUNDLE_SCHEMA,
    BUNDLE_VERSION,
    MigrationBundleError,
    openapi_requires_auth,
    rewrite_workflow_data,
    scan_workflow_data,
    strip_workflow_knowledge,
    validate_bundle,
)
from bisheng.permission.application.access import (  # noqa: E402
    get_f048_resource_adapter,
    get_f048_runtime,
)
from bisheng.permission.application.initial_grant import (  # noqa: E402
    InitialGrantAddition,
    InitialGrantApplication,
    InitialGrantRequest,
)
from bisheng.permission.domain.services.permission_action_service import PermissionActor  # noqa: E402
from bisheng.tenant.domain.services.f048_permission_subject import (  # noqa: E402
    TenantPermissionSubjectDirectory,
)
from bisheng.tool.domain.const import AuthMethod, AuthType, ToolPresetType  # noqa: E402
from bisheng.tool.domain.models.gpts_tools import (  # noqa: E402
    GptsTools,
    GptsToolsDao,
    GptsToolsType,
)
from bisheng.tool.domain.services.tool import ToolServices  # noqa: E402
from bisheng.user.domain.models.user import UserDao  # noqa: E402
from bisheng.utils.http_middleware import _check_is_global_super  # noqa: E402

EXIT_OK = 0
EXIT_BLOCKED = 3
EXIT_RUNTIME_ERROR = 4
TAG_NAME = "MO"


class MigrationBlockedError(RuntimeError):
    """A preflight invariant blocked export/import before application writes."""


@dataclass(slots=True)
class ImportPlan:
    admin: UserPayload
    actor: PermissionActor
    root_department_id: int
    assistant_model_id: int | None
    workflow_model_id: int | None
    external_tool_id_map: dict[int, int]
    external_tool_key_map: dict[str, str]
    parsed_tool_types: list[Any]
    runtime: Any
    initial_grants: InitialGrantApplication
    catalog_release_id: int


def _allowed_tenant_ids(tenant_id: int) -> tuple[int, ...]:
    return (tenant_id,) if tenant_id == DEFAULT_TENANT_ID else (tenant_id, DEFAULT_TENANT_ID)


def _json_report(status: str, **payload: Any) -> None:
    print(json.dumps({"status": status, **payload}, ensure_ascii=False, indent=2, default=str))


async def _load_tagged_application_ids(tenant_id: int) -> tuple[list[str], list[str]]:
    async with get_async_db_session() as session:
        tag_rows = (
            await session.exec(
                select(Tag).where(
                    Tag.tenant_id == tenant_id,
                    Tag.name == TAG_NAME,
                    Tag.business_type == TagBusinessTypeEnum.APPLICATION.value,
                    Tag.business_id == TagBusinessTypeEnum.APPLICATION.value,
                )
            )
        ).all()
        if len(tag_rows) != 1:
            raise MigrationBlockedError(
                f"tenant {tenant_id} must have exactly one MO application tag; found {len(tag_rows)}"
            )
        links = (
            await session.exec(
                select(TagLink).where(
                    TagLink.tenant_id == tenant_id,
                    TagLink.tag_id == tag_rows[0].id,
                    col(TagLink.resource_type).in_(
                        (ResourceTypeEnum.WORK_FLOW.value, ResourceTypeEnum.ASSISTANT.value)
                    ),
                )
            )
        ).all()
    workflow_ids = sorted(
        {str(row.resource_id) for row in links if row.resource_type == ResourceTypeEnum.WORK_FLOW.value}
    )
    assistant_ids = sorted(
        {str(row.resource_id) for row in links if row.resource_type == ResourceTypeEnum.ASSISTANT.value}
    )
    return workflow_ids, assistant_ids


async def _export_workflows(
    tenant_id: int, workflow_ids: list[str]
) -> tuple[list[dict], set[str], set[int], list[dict]]:
    if not workflow_ids:
        return [], set(), set(), []
    async with get_async_db_session() as session:
        workflows = (
            await session.exec(
                select(Flow).where(
                    Flow.tenant_id == tenant_id,
                    Flow.flow_type == FlowType.WORKFLOW.value,
                    col(Flow.id).in_(workflow_ids),
                )
            )
        ).all()
        versions = (
            await session.exec(
                select(FlowVersion)
                .where(
                    FlowVersion.tenant_id == tenant_id,
                    FlowVersion.is_delete == 0,
                    col(FlowVersion.flow_id).in_(workflow_ids),
                )
                .order_by(FlowVersion.flow_id, FlowVersion.id)
            )
        ).all()
    found = {row.id for row in workflows}
    missing = sorted(set(workflow_ids) - found)
    if missing:
        raise MigrationBlockedError(f"MO tag points to missing/non-workflow ids: {missing}")

    versions_by_flow: dict[str, list[FlowVersion]] = {}
    for version in versions:
        versions_by_flow.setdefault(version.flow_id, []).append(version)

    output: list[dict] = []
    tool_keys: set[str] = set()
    tool_ids: set[int] = set()
    warnings: list[dict] = []
    for flow in sorted(workflows, key=lambda item: item.id):
        flow_versions = versions_by_flow.get(flow.id, [])
        if not flow_versions:
            raise MigrationBlockedError(f"workflow {flow.id} has no active version")
        if sum(1 for item in flow_versions if item.is_current == 1) != 1:
            raise MigrationBlockedError(f"workflow {flow.id} does not have exactly one current version")
        cleaned_graphs: dict[str, dict] = {}
        dropped_knowledge = False
        for label, graph in [
            ("flow", flow.data),
            *[(f"version:{v.id}:{v.name}", v.data) for v in flow_versions],
        ]:
            if not isinstance(graph, dict):
                raise MigrationBlockedError(f"workflow {flow.id} {label} has invalid graph data")
            cleaned_graph, graph_changed = strip_workflow_knowledge(graph)
            cleaned_graphs[label] = cleaned_graph
            dropped_knowledge = dropped_knowledge or graph_changed
            dependencies = scan_workflow_data(cleaned_graph)
            tool_keys.update(dependencies.tool_keys)
            tool_ids.update(dependencies.tool_ids)
            if dependencies.rerank_model_ids:
                raise MigrationBlockedError(
                    f"workflow {flow.id} {label} references rerank models, which cannot use the workflow LLM default"
                )
        if dropped_knowledge:
            warnings.append(
                {
                    "code": "KNOWLEDGE_REFERENCE_DROPPED",
                    "application_type": "workflow",
                    "application_id": flow.id,
                    "message": "Knowledge selections and related retrieval settings were removed.",
                }
            )
        output.append(
            {
                "id": flow.id,
                "name": flow.name,
                "description": flow.description,
                "logo": flow.logo,
                "guide_word": flow.guide_word,
                "data": cleaned_graphs["flow"],
                "versions": [
                    {
                        "name": item.name,
                        "description": item.description,
                        "data": cleaned_graphs[f"version:{item.id}:{item.name}"],
                        "is_current": int(item.is_current or 0),
                    }
                    for item in flow_versions
                ],
            }
        )
    return output, tool_keys, tool_ids, warnings


async def _export_assistants(
    tenant_id: int,
    assistant_ids: list[str],
    workflow_ids: set[str],
) -> tuple[list[dict], set[int], list[dict]]:
    if not assistant_ids:
        return [], set(), []
    async with get_async_db_session() as session:
        assistants = (
            await session.exec(
                select(Assistant).where(
                    Assistant.tenant_id == tenant_id,
                    Assistant.is_delete == 0,
                    col(Assistant.id).in_(assistant_ids),
                )
            )
        ).all()
        links = (
            await session.exec(
                select(AssistantLink).where(
                    AssistantLink.tenant_id == tenant_id,
                    col(AssistantLink.assistant_id).in_(assistant_ids),
                )
            )
        ).all()
    found = {row.id for row in assistants}
    missing = sorted(set(assistant_ids) - found)
    if missing:
        raise MigrationBlockedError(f"MO tag points to missing/deleted assistant ids: {missing}")

    links_by_assistant: dict[str, list[AssistantLink]] = {}
    for link in links:
        links_by_assistant.setdefault(str(link.assistant_id), []).append(link)

    tool_ids: set[int] = set()
    output: list[dict] = []
    warnings: list[dict] = []
    for assistant in sorted(assistants, key=lambda item: item.id):
        assistant_links = links_by_assistant.get(assistant.id, [])
        knowledge_ids = sorted({int(row.knowledge_id) for row in assistant_links if row.knowledge_id})
        if knowledge_ids:
            warnings.append(
                {
                    "code": "KNOWLEDGE_REFERENCE_DROPPED",
                    "application_type": "assistant",
                    "application_id": assistant.id,
                    "message": "Knowledge links were removed.",
                }
            )
        linked_flows = sorted({str(row.flow_id) for row in assistant_links if row.flow_id and not row.knowledge_id})
        missing_flows = sorted(set(linked_flows) - workflow_ids)
        if missing_flows:
            raise MigrationBlockedError(
                f"assistant {assistant.id} links workflows not included by the MO tag: {missing_flows}"
            )
        assistant_tool_ids = sorted({int(row.tool_id) for row in assistant_links if row.tool_id})
        tool_ids.update(assistant_tool_ids)
        output.append(
            {
                "id": assistant.id,
                "name": assistant.name,
                "logo": assistant.logo,
                "desc": assistant.desc,
                "system_prompt": assistant.system_prompt,
                "prompt": assistant.prompt,
                "guide_word": assistant.guide_word,
                "guide_question": assistant.guide_question,
                "temperature": assistant.temperature,
                "max_token": assistant.max_token,
                "knowledge_auth": False,
                "tool_ids": assistant_tool_ids,
                "flow_ids": linked_flows,
            }
        )
    return output, tool_ids, warnings


async def _load_visible_tool_rows(
    tenant_id: int,
    *,
    tool_keys: set[str],
    tool_ids: set[int],
) -> list[GptsTools]:
    filters = []
    if tool_keys:
        filters.append(col(GptsTools.tool_key).in_(tool_keys))
    if tool_ids:
        filters.append(col(GptsTools.id).in_(tool_ids))
    if not filters:
        return []
    async with get_async_db_session() as session:
        return list(
            (
                await session.exec(
                    select(GptsTools).where(
                        col(GptsTools.tenant_id).in_(_allowed_tenant_ids(tenant_id)),
                        GptsTools.is_delete == 0,
                        or_(*filters),
                    )
                )
            ).all()
        )


def _prefer_tenant(rows: list[GptsTools], tenant_id: int) -> tuple[dict[str, GptsTools], dict[int, GptsTools]]:
    priority = {tenant_id: 0, DEFAULT_TENANT_ID: 1}
    ordered = sorted(rows, key=lambda row: priority.get(int(row.tenant_id or 0), 2))
    by_key: dict[str, GptsTools] = {}
    by_id: dict[int, GptsTools] = {}
    for row in ordered:
        by_key.setdefault(row.tool_key, row)
        if row.id is not None:
            by_id[row.id] = row
    return by_key, by_id


async def _export_tools(
    tenant_id: int,
    *,
    tool_keys: set[str],
    tool_ids: set[int],
) -> tuple[list[dict], list[dict], list[dict]]:
    rows = await _load_visible_tool_rows(tenant_id, tool_keys=tool_keys, tool_ids=tool_ids)
    by_key, by_id = _prefer_tenant(rows, tenant_id)
    missing_keys = sorted(tool_keys - set(by_key))
    missing_ids = sorted(tool_ids - set(by_id))
    if missing_keys or missing_ids:
        raise MigrationBlockedError(f"referenced tools are missing: keys={missing_keys}, ids={missing_ids}")
    referenced = {id(by_key[key]): by_key[key] for key in tool_keys}
    referenced.update({id(by_id[item]): by_id[item] for item in tool_ids})
    referenced_rows = list(referenced.values())
    type_ids = sorted({int(row.type) for row in referenced_rows})
    async with get_async_db_session() as session:
        type_rows = (
            await session.exec(
                select(GptsToolsType).where(
                    col(GptsToolsType.id).in_(type_ids),
                    GptsToolsType.is_delete == 0,
                )
            )
        ).all()
    type_by_id = {int(row.id): row for row in type_rows if row.id is not None}
    if set(type_ids) != set(type_by_id):
        raise MigrationBlockedError("one or more referenced tool categories are missing")

    mcp = [row for row in referenced_rows if type_by_id[int(row.type)].is_preset == ToolPresetType.MCP.value]
    if mcp:
        raise MigrationBlockedError(
            "MCP tools are intentionally unsupported by this migration: "
            + ", ".join(sorted({row.tool_key for row in mcp}))
        )
    unsupported_types = sorted(
        {
            str(type_by_id[int(row.type)].is_preset)
            for row in referenced_rows
            if type_by_id[int(row.type)].is_preset
            not in {ToolPresetType.API.value, ToolPresetType.PRESET.value, ToolPresetType.MCP.value}
        }
    )
    if unsupported_types:
        raise MigrationBlockedError(f"referenced tools use unknown category types: {unsupported_types}")

    external_tools = [
        {"source_id": row.id, "tool_key": row.tool_key, "name": row.name}
        for row in referenced_rows
        if type_by_id[int(row.type)].is_preset == ToolPresetType.PRESET.value
    ]
    api_type_ids = sorted(
        {int(row.type) for row in referenced_rows if type_by_id[int(row.type)].is_preset == ToolPresetType.API.value}
    )
    async with get_async_db_session() as session:
        api_children = (
            await session.exec(
                select(GptsTools).where(
                    col(GptsTools.type).in_(api_type_ids),
                    GptsTools.is_delete == 0,
                )
            )
        ).all()
    children_by_type: dict[int, list[GptsTools]] = {}
    for row in api_children:
        children_by_type.setdefault(int(row.type), []).append(row)

    warnings: list[dict] = []
    tools: list[dict] = []
    for type_id in api_type_ids:
        tool_type = type_by_id[type_id]
        if openapi_requires_auth(tool_type.openapi_schema):
            warnings.append(
                {
                    "code": "AUTH_CONFIGURATION_REQUIRED",
                    "tool": tool_type.name,
                    "message": "OpenAPI declares security, but target authentication will be set to none.",
                }
            )
        tools.append(
            {
                "source_id": tool_type.id,
                "name": tool_type.name,
                "logo": tool_type.logo,
                "description": tool_type.description,
                "server_host": tool_type.server_host,
                "openapi_schema": tool_type.openapi_schema,
                "children": [
                    {"source_id": row.id, "tool_key": row.tool_key, "name": row.name}
                    for row in sorted(children_by_type.get(type_id, []), key=lambda child: child.id or 0)
                ],
            }
        )
    return tools, sorted(external_tools, key=lambda item: item["tool_key"]), warnings


async def export_bundle(tenant_id: int) -> dict[str, Any]:
    """Build a secret-free bundle for all MO-tagged applications."""

    with bypass_tenant_filter():
        workflow_ids, assistant_ids = await _load_tagged_application_ids(tenant_id)
        workflows, workflow_tool_keys, workflow_tool_ids, workflow_warnings = await _export_workflows(
            tenant_id, workflow_ids
        )
        assistants, assistant_tool_ids, assistant_warnings = await _export_assistants(
            tenant_id, assistant_ids, set(workflow_ids)
        )
        tools, external_tools, tool_warnings = await _export_tools(
            tenant_id,
            tool_keys=workflow_tool_keys,
            tool_ids=workflow_tool_ids | assistant_tool_ids,
        )
    bundle = {
        "schema": BUNDLE_SCHEMA,
        "version": BUNDLE_VERSION,
        "tag": TAG_NAME,
        "exported_at": datetime.now(UTC).isoformat(),
        "source": {"tenant_id": tenant_id},
        "tools": tools,
        "external_tools": external_tools,
        "workflows": workflows,
        "assistants": assistants,
        "warnings": [*workflow_warnings, *assistant_warnings, *tool_warnings],
    }
    validate_bundle(bundle)
    return bundle


async def _resolve_default_model_ids(
    tenant_id: int,
    *,
    needs_assistant: bool,
    needs_workflow: bool,
) -> tuple[int | None, int | None]:
    assistant_model_id: int | None = None
    workflow_model_id: int | None = None
    if needs_assistant:
        assistant_config = await LLMService.get_assistant_llm(tenant_id=tenant_id)
        defaults = [item for item in assistant_config.llm_list or [] if item.default is True and item.model_id]
        if len(defaults) != 1:
            raise MigrationBlockedError("target must configure exactly one default assistant model")
        assistant_model_id = int(defaults[0].model_id)
    if needs_workflow:
        workflow_config = await LLMService.get_workflow_llm(tenant_id=tenant_id)
        if not workflow_config.model_id:
            raise MigrationBlockedError("target has no default workflow model")
        workflow_model_id = int(workflow_config.model_id)

    for label, model_id in (
        ("assistant", assistant_model_id),
        ("workflow", workflow_model_id),
    ):
        if model_id is None:
            continue
        await avalidate_system_model_refs([model_id], tenant_id)
        model = await aget_model_by_id_with_share_fallback(model_id)
        if model is None or model.model_type != LLMModelType.LLM.value or not model.online:
            raise MigrationBlockedError(f"target {label} default model {model_id} is missing, offline, or not an LLM")
        if not model.server_id or await aget_server_by_id_with_share_fallback(model.server_id) is None:
            raise MigrationBlockedError(f"target {label} default model {model_id} has no available provider")
    return assistant_model_id, workflow_model_id


async def _load_target_external_tools(
    tenant_id: int,
    external_tools: list[dict],
) -> tuple[dict[int, int], dict[str, str]]:
    keys = {str(item["tool_key"]) for item in external_tools}
    rows = await _load_visible_tool_rows(tenant_id, tool_keys=keys, tool_ids=set())
    by_key, _ = _prefer_tenant(rows, tenant_id)
    missing = sorted(keys - set(by_key))
    if missing:
        raise MigrationBlockedError(f"target is missing referenced preset tools: {missing}")
    id_map: dict[int, int] = {}
    key_map: dict[str, str] = {}
    for item in external_tools:
        row = by_key[str(item["tool_key"])]
        tool_type = await GptsToolsDao.aget_one_tool_type(int(row.type))
        if tool_type is None or tool_type.is_preset != ToolPresetType.PRESET.value:
            raise MigrationBlockedError(f"target tool key {row.tool_key} is not a preset tool")
        id_map[int(item["source_id"])] = int(row.id)
        key_map[str(item["tool_key"])] = row.tool_key
    return id_map, key_map


def _all_declared_source_tools(bundle: dict[str, Any]) -> tuple[set[int], set[str]]:
    ids = {int(item["source_id"]) for item in bundle["external_tools"]}
    keys = {str(item["tool_key"]) for item in bundle["external_tools"]}
    for tool_type in bundle["tools"]:
        for child in tool_type["children"]:
            ids.add(int(child["source_id"]))
            keys.add(str(child["tool_key"]))
    return ids, keys


async def preflight_import(bundle: dict[str, Any], tenant_id: int) -> ImportPlan:
    """Validate every deterministic target-side invariant before writes."""

    validate_bundle(bundle)
    if not settings.openfga.enabled:
        raise MigrationBlockedError("OpenFGA must be enabled because imported permissions are mandatory")

    with bypass_tenant_filter():
        admins = [row for row in await UserDao.aget_users_by_username("admin") if row.delete == 0]
    if len(admins) != 1 or admins[0].user_id is None:
        raise MigrationBlockedError(f"target must have exactly one active admin user; found {len(admins)}")
    admin_row = admins[0]
    if not await _check_is_global_super(int(admin_row.user_id)):
        raise MigrationBlockedError("target admin user is not the global super administrator")

    with bypass_tenant_filter():
        root_department = await DepartmentDao.aget_tenant_root_via_pointer(tenant_id)
        if root_department is None:
            root_department = await DepartmentDao.aget_root_by_tenant(tenant_id)
    if (
        root_department is None
        or root_department.id is None
        or root_department.tenant_id != tenant_id
        or root_department.status != "active"
    ):
        raise MigrationBlockedError(f"target tenant {tenant_id} has no active root department")

    assistant_model_id, workflow_model_id = await _resolve_default_model_ids(
        tenant_id,
        needs_assistant=bool(bundle["assistants"]),
        needs_workflow=bool(bundle["workflows"]),
    )
    app_ids = [str(item["id"]) for item in bundle["workflows"] + bundle["assistants"]]
    with bypass_tenant_filter():
        async with get_async_db_session() as session:
            flow_collisions = (await session.exec(select(Flow.id).where(col(Flow.id).in_(app_ids)))).all()
            assistant_collisions = (
                await session.exec(select(Assistant.id).where(col(Assistant.id).in_(app_ids)))
            ).all()
            tool_name_collisions = (
                await session.exec(
                    select(GptsToolsType.name).where(
                        GptsToolsType.tenant_id == tenant_id,
                        GptsToolsType.is_delete == 0,
                        col(GptsToolsType.name).in_([item["name"] for item in bundle["tools"]]),
                    )
                )
            ).all()
            target_tags = (
                await session.exec(
                    select(Tag.id).where(
                        Tag.tenant_id == tenant_id,
                        Tag.name == TAG_NAME,
                        Tag.business_type == TagBusinessTypeEnum.APPLICATION.value,
                        Tag.business_id == TagBusinessTypeEnum.APPLICATION.value,
                    )
                )
            ).all()
    collisions = sorted({str(item) for item in [*flow_collisions, *assistant_collisions]})
    if collisions:
        raise MigrationBlockedError(f"target already contains application ids: {collisions}")
    if tool_name_collisions:
        raise MigrationBlockedError(
            f"target already contains custom tool categories: {sorted(map(str, tool_name_collisions))}"
        )
    if len(target_tags) > 1:
        raise MigrationBlockedError("target contains duplicate MO application tags")

    parsed_tool_types = []
    for item in bundle["tools"]:
        parsed = await ToolServices.parse_openapi_schema("", str(item["openapi_schema"]))
        source_names = {str(child["name"]) for child in item["children"]}
        parsed_names = {child.name for child in parsed.children or []}
        if source_names != parsed_names or len(source_names) != len(item["children"]):
            raise MigrationBlockedError(
                f"custom tool {item['name']} OpenAPI operations no longer match the exported children"
            )
        parsed_tool_types.append(parsed)

    declared_ids, declared_keys = _all_declared_source_tools(bundle)
    for assistant in bundle["assistants"]:
        undeclared = sorted(set(map(int, assistant.get("tool_ids", []))) - declared_ids)
        if undeclared:
            raise MigrationBlockedError(f"assistant {assistant['id']} has undeclared tool ids: {undeclared}")
    for workflow in bundle["workflows"]:
        for graph in [workflow["data"], *[item["data"] for item in workflow["versions"]]]:
            cleaned_graph, _ = strip_workflow_knowledge(graph)
            dependencies = scan_workflow_data(cleaned_graph)
            undeclared = sorted(dependencies.tool_keys - declared_keys)
            if undeclared:
                raise MigrationBlockedError(f"workflow {workflow['id']} has undeclared tool keys: {undeclared}")
            undeclared_ids = sorted(dependencies.tool_ids - declared_ids)
            if undeclared_ids:
                raise MigrationBlockedError(f"workflow {workflow['id']} has undeclared tool ids: {undeclared_ids}")
            if dependencies.rerank_model_ids:
                raise MigrationBlockedError(f"workflow {workflow['id']} contains unsupported dependencies")

    external_id_map, external_key_map = await _load_target_external_tools(tenant_id, bundle["external_tools"])
    runtime = await get_f048_runtime()
    catalog = await runtime.current_catalog()
    if not any(item.snapshot.active and item.snapshot.model_key == "viewer" for item in catalog.models):
        raise MigrationBlockedError("target permission catalog has no active viewer model")

    admin = UserPayload(
        user_id=int(admin_row.user_id),
        user_name=admin_row.user_name,
        user_role=[],
        tenant_id=tenant_id,
        is_global_super=True,
    )
    actor = PermissionActor(
        user_id=admin.user_id,
        current_tenant_id=tenant_id,
        super_admin=True,
    )
    return ImportPlan(
        admin=admin,
        actor=actor,
        root_department_id=int(root_department.id),
        assistant_model_id=assistant_model_id,
        workflow_model_id=workflow_model_id,
        external_tool_id_map=external_id_map,
        external_tool_key_map=external_key_map,
        parsed_tool_types=parsed_tool_types,
        runtime=runtime,
        initial_grants=InitialGrantApplication(
            runtime=runtime,
            subjects=TenantPermissionSubjectDirectory(),
        ),
        catalog_release_id=catalog.release_id,
    )


async def _authorize_and_grant_root_viewer(
    *,
    resource_type: str,
    resource_id: str,
    plan: ImportPlan,
) -> None:
    adapter = await get_f048_resource_adapter(resource_type)
    if resource_type == "tool":
        record = await adapter.load_permission_record(resource_id=resource_id)
        target_kwargs = {"resource_id": resource_id}
    else:
        record = await adapter.load_permission_record(
            resource_type=resource_type,
            resource_id=resource_id,
        )
        target_kwargs = {"resource_type": resource_type, "resource_id": resource_id}
    if record is None:
        raise RuntimeError(f"created {resource_type}:{resource_id} cannot be loaded for permission projection")
    await adapter.authorize_created(record=record, actor=plan.actor)
    target = await adapter.resolve_permission_target(
        **target_kwargs,
        actor=plan.actor,
        action="manage",
    )
    await plan.initial_grants.apply(
        actor=plan.actor,
        target=target,
        request=InitialGrantRequest(
            command_key="mo-app-import-root-department-viewer-v1",
            expected_catalog_release_id=plan.catalog_release_id,
            additions=(
                InitialGrantAddition(
                    model_key="viewer",
                    subject_type="department",
                    subject_id=str(plan.root_department_id),
                    include_children=True,
                ),
            ),
        ),
    )


async def _create_tools(
    bundle: dict[str, Any],
    tenant_id: int,
    plan: ImportPlan,
) -> tuple[dict[int, int], dict[str, str], list[int]]:
    id_map = dict(plan.external_tool_id_map)
    key_map = dict(plan.external_tool_key_map)
    created_type_ids: list[int] = []
    for source, parsed in zip(bundle["tools"], plan.parsed_tool_types, strict=True):
        parsed.id = None
        parsed.name = source["name"]
        parsed.logo = source.get("logo") or ""
        parsed.description = source.get("description") or ""
        parsed.server_host = source.get("server_host") or parsed.server_host
        parsed.auth_method = AuthMethod.NO.value
        parsed.auth_type = AuthType.BASIC.value
        parsed.api_key = ""
        parsed.is_preset = ToolPresetType.API.value
        parsed.user_id = plan.admin.user_id
        parsed.tenant_id = tenant_id
        parsed.is_shared = False
        parsed.extra = json.dumps(
            {"api_location": parsed.api_location, "parameter_name": parsed.parameter_name},
            ensure_ascii=False,
        )
        for child in parsed.children or []:
            child.id = None
            child.user_id = plan.admin.user_id
            child.tenant_id = tenant_id
            child.is_delete = 0
            child.is_preset = ToolPresetType.API.value
        created = await GptsToolsDao.insert_tool_type(parsed)
        if created.id is None:
            raise RuntimeError(f"custom tool {source['name']} was created without an id")
        await _authorize_and_grant_root_viewer(
            resource_type="tool",
            resource_id=str(created.id),
            plan=plan,
        )
        created_type_ids.append(int(created.id))
        created_by_name = {child.name: child for child in created.children or []}
        for source_child in source["children"]:
            target_child = created_by_name[source_child["name"]]
            if target_child.id is None:
                raise RuntimeError(f"custom tool operation {target_child.name} was created without an id")
            id_map[int(source_child["source_id"])] = int(target_child.id)
            key_map[str(source_child["tool_key"])] = target_child.tool_key
    return id_map, key_map, created_type_ids


async def _insert_workflow(
    source: dict[str, Any],
    tenant_id: int,
    plan: ImportPlan,
    tool_id_map: dict[int, int],
    tool_key_map: dict[str, str],
) -> None:
    if plan.workflow_model_id is None:
        raise RuntimeError("workflow model was not resolved")
    data = rewrite_workflow_data(
        source["data"],
        workflow_model_id=plan.workflow_model_id,
        tool_key_map=tool_key_map,
        tool_id_map=tool_id_map,
    )
    flow = Flow(
        id=source["id"],
        name=source["name"],
        user_id=plan.admin.user_id,
        tenant_id=tenant_id,
        description=source.get("description"),
        data=data,
        logo=source.get("logo"),
        status=FlowStatus.OFFLINE.value,
        flow_type=FlowType.WORKFLOW.value,
        is_shared=False,
        guide_word=source.get("guide_word"),
    )
    versions = [
        FlowVersion(
            flow_id=flow.id,
            name=item["name"],
            description=item.get("description"),
            data=rewrite_workflow_data(
                item["data"],
                workflow_model_id=plan.workflow_model_id,
                tool_key_map=tool_key_map,
                tool_id_map=tool_id_map,
            ),
            user_id=plan.admin.user_id,
            tenant_id=tenant_id,
            flow_type=FlowType.WORKFLOW.value,
            is_current=int(item["is_current"]),
            is_delete=0,
            original_version_id=None,
        )
        for item in source["versions"]
    ]
    async with get_async_db_session() as session:
        session.add(flow)
        session.add_all(versions)
        await session.commit()
    await _authorize_and_grant_root_viewer(resource_type="workflow", resource_id=flow.id, plan=plan)


async def _insert_assistant(
    source: dict[str, Any],
    tenant_id: int,
    plan: ImportPlan,
) -> None:
    if plan.assistant_model_id is None:
        raise RuntimeError("assistant model was not resolved")
    assistant = Assistant(
        id=source["id"],
        name=source["name"],
        tenant_id=tenant_id,
        logo=source.get("logo") or "",
        desc=source.get("desc") or "",
        system_prompt=source.get("system_prompt") or "",
        prompt=source.get("prompt") or "",
        guide_word=source.get("guide_word") or "",
        guide_question=source.get("guide_question") or [],
        model_name=str(plan.assistant_model_id),
        temperature=source.get("temperature", 1),
        max_token=source.get("max_token", 32000),
        status=AssistantStatus.OFFLINE.value,
        user_id=plan.admin.user_id,
        is_delete=0,
        is_shared=False,
        knowledge_auth=False,
    )
    async with get_async_db_session() as session:
        session.add(assistant)
        await session.commit()
    await _authorize_and_grant_root_viewer(resource_type="assistant", resource_id=assistant.id, plan=plan)


async def _insert_links_and_tag(
    bundle: dict[str, Any],
    tenant_id: int,
    plan: ImportPlan,
    tool_id_map: dict[int, int],
) -> int:
    async with get_async_db_session() as session:
        existing_tag = (
            await session.exec(
                select(Tag).where(
                    Tag.tenant_id == tenant_id,
                    Tag.name == TAG_NAME,
                    Tag.business_type == TagBusinessTypeEnum.APPLICATION.value,
                    Tag.business_id == TagBusinessTypeEnum.APPLICATION.value,
                )
            )
        ).all()
        if len(existing_tag) > 1:
            raise RuntimeError("target contains duplicate MO application tags")
        if existing_tag:
            tag = existing_tag[0]
        else:
            tag = Tag(
                name=TAG_NAME,
                business_type=TagBusinessTypeEnum.APPLICATION.value,
                business_id=TagBusinessTypeEnum.APPLICATION.value,
                user_id=plan.admin.user_id,
                tenant_id=tenant_id,
            )
            session.add(tag)
            await session.flush()
        if tag.id is None:
            raise RuntimeError("MO tag was created without an id")

        for assistant in bundle["assistants"]:
            session.add_all(
                [
                    AssistantLink(
                        assistant_id=assistant["id"],
                        tool_id=tool_id_map[int(source_tool_id)],
                        tenant_id=tenant_id,
                    )
                    for source_tool_id in assistant.get("tool_ids", [])
                ]
            )
            session.add_all(
                [
                    AssistantLink(
                        assistant_id=assistant["id"],
                        flow_id=flow_id,
                        tenant_id=tenant_id,
                    )
                    for flow_id in assistant.get("flow_ids", [])
                ]
            )
            session.add(
                TagLink(
                    tag_id=tag.id,
                    resource_id=assistant["id"],
                    resource_type=ResourceTypeEnum.ASSISTANT.value,
                    user_id=plan.admin.user_id,
                    tenant_id=tenant_id,
                )
            )
        for workflow in bundle["workflows"]:
            session.add(
                TagLink(
                    tag_id=tag.id,
                    resource_id=workflow["id"],
                    resource_type=ResourceTypeEnum.WORK_FLOW.value,
                    user_id=plan.admin.user_id,
                    tenant_id=tenant_id,
                )
            )
        await session.commit()
        return int(tag.id)


async def apply_import(bundle: dict[str, Any], tenant_id: int, plan: ImportPlan) -> dict[str, Any]:
    """Apply a previously completed preflight plan."""

    tool_id_map, tool_key_map, created_tool_type_ids = await _create_tools(bundle, tenant_id, plan)
    for workflow in bundle["workflows"]:
        await _insert_workflow(workflow, tenant_id, plan, tool_id_map, tool_key_map)
    for assistant in bundle["assistants"]:
        await _insert_assistant(assistant, tenant_id, plan)
    tag_id = await _insert_links_and_tag(bundle, tenant_id, plan, tool_id_map)
    return {
        "tenant_id": tenant_id,
        "tag_id": tag_id,
        "workflow_ids": [item["id"] for item in bundle["workflows"]],
        "assistant_ids": [item["id"] for item in bundle["assistants"]],
        "created_tool_type_ids": created_tool_type_ids,
        "assistant_model_id": plan.assistant_model_id,
        "workflow_model_id": plan.workflow_model_id,
        "permission": {
            "owner": plan.admin.user_name,
            "model": "viewer",
            "department_id": plan.root_department_id,
            "include_children": True,
        },
        "warnings": bundle["warnings"],
    }


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate MO-tagged BISHENG applications")
    subparsers = parser.add_subparsers(dest="command", required=True)
    export_parser = subparsers.add_parser("export", help="Export a secret-free JSON bundle")
    export_parser.add_argument("--tenant-id", type=int, required=True)
    export_parser.add_argument("--output", type=Path, required=True)
    import_parser = subparsers.add_parser("import", help="Preflight or import a JSON bundle")
    import_parser.add_argument("--tenant-id", type=int, required=True)
    import_parser.add_argument("--bundle", type=Path, required=True)
    import_parser.add_argument("--apply", action="store_true", help="Perform writes after preflight")
    return parser.parse_args(argv)


async def _run(args: argparse.Namespace) -> int:
    if args.tenant_id <= 0:
        raise MigrationBlockedError("tenant id must be positive")
    visible = frozenset(_allowed_tenant_ids(args.tenant_id))
    set_current_tenant_id(args.tenant_id)
    set_visible_tenant_ids(visible)
    await initialize_app_context(config=settings, instance_role="script")
    try:
        if args.command == "export":
            bundle = await export_bundle(args.tenant_id)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
            _json_report(
                "exported",
                output=str(args.output.resolve()),
                workflows=len(bundle["workflows"]),
                assistants=len(bundle["assistants"]),
                custom_tools=len(bundle["tools"]),
                warnings=bundle["warnings"],
            )
            return EXIT_OK

        bundle = json.loads(args.bundle.read_text(encoding="utf-8"))
        plan = await preflight_import(bundle, args.tenant_id)
        preview = {
            "tenant_id": args.tenant_id,
            "workflow_ids": [item["id"] for item in bundle["workflows"]],
            "assistant_ids": [item["id"] for item in bundle["assistants"]],
            "custom_tools": [item["name"] for item in bundle["tools"]],
            "assistant_model_id": plan.assistant_model_id,
            "workflow_model_id": plan.workflow_model_id,
            "root_department_id": plan.root_department_id,
            "warnings": bundle["warnings"],
        }
        if not args.apply:
            _json_report("dry_run_ok", **preview)
            return EXIT_OK
        result = await apply_import(bundle, args.tenant_id, plan)
        _json_report("imported", **result)
        return EXIT_OK
    finally:
        await close_app_context()


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        return asyncio.run(_run(args))
    except (MigrationBlockedError, MigrationBundleError, json.JSONDecodeError, OSError) as exc:
        _json_report("blocked", error=str(exc))
        return EXIT_BLOCKED
    except Exception as exc:  # pragma: no cover - operational diagnostics
        _json_report("error", error=str(exc), traceback=traceback.format_exc())
        return EXIT_RUNTIME_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
