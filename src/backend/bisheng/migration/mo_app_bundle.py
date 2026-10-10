"""Pure bundle validation and graph rewriting for MO application migration."""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from typing import Any

import yaml

BUNDLE_SCHEMA = "bisheng.mo-app-bundle"
BUNDLE_VERSION = 1

MODEL_PARAM_KEYS = frozenset({"model_id", "recommended_llm"})
KNOWLEDGE_PARAM_KEYS = frozenset({"knowledge", "knowledge_id", "qa_knowledge_id"})
KNOWLEDGE_NODE_TYPES = frozenset({"agent", "rag", "knowledge_retriever", "qa_retriever"})


class MigrationBundleError(ValueError):
    """The bundle or one of its dependencies cannot be migrated safely."""


@dataclass(frozen=True, slots=True)
class WorkflowDependencies:
    """References discovered in one workflow graph."""

    tool_keys: frozenset[str]
    tool_ids: frozenset[int]
    knowledge_references: tuple[str, ...]
    rerank_model_ids: tuple[str, ...]


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


def _has_value(value: Any) -> bool:
    return value not in (None, "", 0, "0", [], {})


def _has_knowledge_reference(value: Any) -> bool:
    if isinstance(value, dict) and "value" in value:
        return _has_knowledge_reference(value["value"])
    if isinstance(value, list):
        return any(_has_knowledge_reference(item) for item in value)
    return _has_value(value)


def _walk(value: Any):
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def scan_workflow_data(data: dict[str, Any]) -> WorkflowDependencies:
    """Find portable and unsupported references without mutating graph data."""

    tool_keys: set[str] = set()
    tool_ids: set[int] = set()
    knowledge_references: list[str] = []
    rerank_model_ids: list[str] = []

    for item in _walk(data):
        if not isinstance(item, dict):
            continue

        tool_key = item.get("tool_key")
        if isinstance(tool_key, str) and tool_key.strip():
            tool_keys.add(tool_key.strip())

        if item.get("key") == "tool_list" and isinstance(item.get("value"), list):
            for tool in item["value"]:
                if not isinstance(tool, dict):
                    continue
                item_key = tool.get("tool_key")
                if isinstance(item_key, str) and item_key.strip():
                    tool_keys.add(item_key.strip())
                item_id = _positive_int(tool.get("key")) or _positive_int(tool.get("id"))
                if item_id is not None:
                    tool_ids.add(item_id)

        if item.get("key") in KNOWLEDGE_PARAM_KEYS and _has_knowledge_reference(item.get("value")):
            knowledge_references.append(str(item.get("value")))

        rerank_model = item.get("rerank_model")
        if _has_value(rerank_model):
            rerank_model_ids.append(str(rerank_model))

    return WorkflowDependencies(
        tool_keys=frozenset(tool_keys),
        tool_ids=frozenset(tool_ids),
        knowledge_references=tuple(knowledge_references),
        rerank_model_ids=tuple(rerank_model_ids),
    )


def strip_workflow_knowledge(data: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Remove knowledge selections and related retrieval settings from a graph copy."""

    stripped = copy.deepcopy(data)
    changed = False

    def clear_retrieval_settings(value: Any) -> None:
        nonlocal changed
        if isinstance(value, list):
            for child in value:
                clear_retrieval_settings(child)
            return
        if not isinstance(value, dict):
            return
        if _has_value(value.get("rerank_model")):
            value["rerank_model"] = ""
            changed = True
        if value.get("rerank_flag") is True:
            value["rerank_flag"] = False
            changed = True
        if value.get("user_auth") is True:
            value["user_auth"] = False
            changed = True
        for child in value.values():
            clear_retrieval_settings(child)

    for node in stripped.get("nodes", []):
        if not isinstance(node, dict) or not isinstance(node.get("data"), dict):
            continue
        node_data = node["data"]
        if node_data.get("type") not in KNOWLEDGE_NODE_TYPES:
            continue
        for group in node_data.get("group_params") or []:
            if not isinstance(group, dict):
                continue
            for param in group.get("params") or []:
                if not isinstance(param, dict):
                    continue
                key = param.get("key")
                if key in KNOWLEDGE_PARAM_KEYS and _has_knowledge_reference(param.get("value")):
                    current = param.get("value")
                    if isinstance(current, dict) and "value" in current:
                        current["value"] = []
                    else:
                        param["value"] = []
                    changed = True
                elif key == "metadata_filter" and _has_value(param.get("value")):
                    param["value"] = {}
                    changed = True
                elif key == "user_auth" and param.get("value") is True:
                    param["value"] = False
                    changed = True
                clear_retrieval_settings(param.get("value"))
    return stripped, changed


def rewrite_workflow_data(
    data: dict[str, Any],
    *,
    workflow_model_id: int,
    tool_key_map: dict[str, str],
    tool_id_map: dict[int, int],
) -> dict[str, Any]:
    """Replace chat-model and custom-tool references in a copied graph."""

    rewritten, _ = strip_workflow_knowledge(data)

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for child in value:
                visit(child)
            return
        if not isinstance(value, dict):
            return

        direct_tool_key = value.get("tool_key")
        if isinstance(direct_tool_key, str) and direct_tool_key in tool_key_map:
            value["tool_key"] = tool_key_map[direct_tool_key]

        param_key = value.get("key")
        if param_key in MODEL_PARAM_KEYS:
            value["value"] = workflow_model_id
        elif param_key == "tool_list" and isinstance(value.get("value"), list):
            for tool in value["value"]:
                if not isinstance(tool, dict):
                    continue
                old_key = tool.get("tool_key")
                if isinstance(old_key, str) and old_key in tool_key_map:
                    tool["tool_key"] = tool_key_map[old_key]
                old_id = _positive_int(tool.get("key"))
                if old_id in tool_id_map:
                    tool["key"] = tool_id_map[old_id]
                old_id = _positive_int(tool.get("id"))
                if old_id in tool_id_map:
                    tool["id"] = tool_id_map[old_id]

        for child in value.values():
            visit(child)

    visit(rewritten)
    return rewritten


def parse_openapi_document(raw_schema: str) -> dict[str, Any]:
    """Parse an OpenAPI JSON/YAML document for dependency inspection."""

    try:
        loaded = json.loads(raw_schema) if raw_schema.lstrip().startswith("{") else yaml.safe_load(raw_schema)
    except Exception as exc:  # pragma: no cover - parser-specific message varies
        raise MigrationBundleError(f"invalid OpenAPI document: {exc}") from exc
    if not isinstance(loaded, dict):
        raise MigrationBundleError("OpenAPI document must be an object")
    return loaded


def openapi_requires_auth(raw_schema: str) -> bool:
    """Return whether an OpenAPI document declares any security requirement."""

    schema = parse_openapi_document(raw_schema)
    components = schema.get("components")
    if isinstance(components, dict) and components.get("securitySchemes"):
        return True
    if schema.get("securityDefinitions"):
        return True
    if schema.get("security"):
        return True
    paths = schema.get("paths")
    if not isinstance(paths, dict):
        return False
    for path in paths.values():
        if not isinstance(path, dict):
            continue
        for operation in path.values():
            if isinstance(operation, dict) and operation.get("security"):
                return True
    return False


def validate_bundle(bundle: dict[str, Any]) -> None:
    """Validate the stable envelope before any target-side lookup or write."""

    if bundle.get("schema") != BUNDLE_SCHEMA:
        raise MigrationBundleError(f"unsupported bundle schema: {bundle.get('schema')!r}")
    if bundle.get("version") != BUNDLE_VERSION:
        raise MigrationBundleError(f"unsupported bundle version: {bundle.get('version')!r}")
    if bundle.get("tag") != "MO":
        raise MigrationBundleError("bundle tag must be MO")
    for key in ("tools", "external_tools", "workflows", "assistants", "warnings"):
        if not isinstance(bundle.get(key), list):
            raise MigrationBundleError(f"bundle field {key!r} must be a list")

    tool_ids: list[int] = []
    tool_keys: list[str] = []
    for tool_type in bundle["tools"]:
        if (
            not isinstance(tool_type, dict)
            or not isinstance(tool_type.get("name"), str)
            or not tool_type["name"].strip()
            or not isinstance(tool_type.get("openapi_schema"), str)
            or not isinstance(tool_type.get("children"), list)
        ):
            raise MigrationBundleError("custom tool entry is incomplete")
        child_names: list[str] = []
        for child in tool_type["children"]:
            source_id = _positive_int(child.get("source_id")) if isinstance(child, dict) else None
            tool_key = child.get("tool_key") if isinstance(child, dict) else None
            child_name = child.get("name") if isinstance(child, dict) else None
            if source_id is None or not isinstance(tool_key, str) or not tool_key or not child_name:
                raise MigrationBundleError(f"custom tool {tool_type['name']} has an invalid child")
            tool_ids.append(source_id)
            tool_keys.append(tool_key)
            child_names.append(str(child_name))
        if len(child_names) != len(set(child_names)):
            raise MigrationBundleError(f"custom tool {tool_type['name']} has duplicate operation names")
    for item in bundle["external_tools"]:
        source_id = _positive_int(item.get("source_id")) if isinstance(item, dict) else None
        tool_key = item.get("tool_key") if isinstance(item, dict) else None
        if source_id is None or not isinstance(tool_key, str) or not tool_key:
            raise MigrationBundleError("external tool entry is incomplete")
        tool_ids.append(source_id)
        tool_keys.append(tool_key)
    if len(tool_ids) != len(set(tool_ids)) or len(tool_keys) != len(set(tool_keys)):
        raise MigrationBundleError("source tool ids and keys must be unique")

    app_ids: list[str] = []
    for workflow in bundle["workflows"]:
        if not isinstance(workflow, dict) or not workflow.get("id"):
            raise MigrationBundleError("workflow entry is missing id")
        versions = workflow.get("versions")
        if not isinstance(versions, list) or not versions:
            raise MigrationBundleError(f"workflow {workflow['id']} has no versions")
        if not isinstance(workflow.get("data"), dict):
            raise MigrationBundleError(f"workflow {workflow['id']} has invalid graph data")
        if any(
            not isinstance(item, dict) or not isinstance(item.get("data"), dict) or not item.get("name")
            for item in versions
        ):
            raise MigrationBundleError(f"workflow {workflow['id']} has an invalid version")
        if sum(1 for item in versions if item.get("is_current") == 1) != 1:
            raise MigrationBundleError(f"workflow {workflow['id']} must have one current version")
        app_ids.append(str(workflow["id"]))
    for assistant in bundle["assistants"]:
        if not isinstance(assistant, dict) or not assistant.get("id"):
            raise MigrationBundleError("assistant entry is missing id")
        if not isinstance(assistant.get("tool_ids", []), list) or not isinstance(assistant.get("flow_ids", []), list):
            raise MigrationBundleError(f"assistant {assistant['id']} has invalid links")
        app_ids.append(str(assistant["id"]))
    if len(app_ids) != len(set(app_ids)):
        raise MigrationBundleError("application ids must be unique across the bundle")

    tool_names = [str(item.get("name", "")) for item in bundle["tools"]]
    if any(not name for name in tool_names) or len(tool_names) != len(set(tool_names)):
        raise MigrationBundleError("custom tool names must be non-empty and unique")
