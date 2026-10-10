from __future__ import annotations

import unittest

from bisheng.migration.mo_app_bundle import (
    BUNDLE_SCHEMA,
    BUNDLE_VERSION,
    MigrationBundleError,
    openapi_requires_auth,
    rewrite_workflow_data,
    scan_workflow_data,
    strip_workflow_knowledge,
    validate_bundle,
)


def _graph(*params: dict, tool_key: str = "") -> dict:
    return {
        "nodes": [
            {
                "id": "node-1",
                "data": {
                    "id": "node-1",
                    "type": "tool" if tool_key else "agent",
                    "tool_key": tool_key,
                    "group_params": [{"name": "settings", "params": list(params)}],
                },
            }
        ],
        "edges": [],
    }


def _bundle() -> dict:
    graph = _graph({"key": "model_id", "value": 9})
    return {
        "schema": BUNDLE_SCHEMA,
        "version": BUNDLE_VERSION,
        "tag": "MO",
        "tools": [],
        "external_tools": [],
        "workflows": [
            {
                "id": "workflow-id",
                "data": graph,
                "versions": [{"name": "v0", "data": graph, "is_current": 1}],
            }
        ],
        "assistants": [],
        "warnings": [],
    }


class MoAppBundleTest(unittest.TestCase):
    def test_rewrite_workflow_data_replaces_models_and_tool_references(self) -> None:
        graph = _graph(
            {"key": "model_id", "value": 9},
            {"key": "recommended_llm", "value": "10"},
            {
                "key": "tool_list",
                "value": [{"key": 12, "id": 12, "tool_key": "source-tool", "label": "tool"}],
            },
            tool_key="source-tool",
        )

        rewritten = rewrite_workflow_data(
            graph,
            workflow_model_id=101,
            tool_key_map={"source-tool": "target-tool"},
            tool_id_map={12: 88},
        )

        node_data = rewritten["nodes"][0]["data"]
        params = node_data["group_params"][0]["params"]
        self.assertEqual(node_data["tool_key"], "target-tool")
        self.assertEqual(params[0]["value"], 101)
        self.assertEqual(params[1]["value"], 101)
        self.assertEqual(
            params[2]["value"],
            [{"key": 88, "id": 88, "tool_key": "target-tool", "label": "tool"}],
        )
        self.assertEqual(graph["nodes"][0]["data"]["tool_key"], "source-tool")

    def test_scan_workflow_data_ignores_empty_knowledge_selector(self) -> None:
        graph = _graph(
            {"key": "knowledge_id", "value": {"type": "knowledge", "value": []}},
            {"key": "qa_knowledge_id", "value": []},
        )

        dependencies = scan_workflow_data(graph)

        self.assertEqual(dependencies.knowledge_references, ())

    def test_scan_workflow_data_finds_unsupported_and_tool_dependencies(self) -> None:
        graph = _graph(
            {"key": "knowledge_id", "value": {"type": "knowledge", "value": [7]}},
            {"key": "retrieval", "value": {"rerank_model": 42}},
            {"key": "tool_list", "value": [{"key": "12", "tool_key": "agent-tool"}]},
            tool_key="node-tool",
        )

        dependencies = scan_workflow_data(graph)

        self.assertEqual(dependencies.tool_keys, frozenset({"node-tool", "agent-tool"}))
        self.assertEqual(dependencies.tool_ids, frozenset({12}))
        self.assertTrue(dependencies.knowledge_references)
        self.assertEqual(dependencies.rerank_model_ids, ("42",))

    def test_strip_workflow_knowledge_removes_references_and_retrieval_settings(self) -> None:
        graph = _graph(
            {
                "key": "knowledge_id",
                "value": {"type": "knowledge", "value": [{"key": 7, "label": "kb"}]},
            },
            {"key": "metadata_filter", "value": {"conditions": [{"knowledge_id": 7}]}},
            {"key": "user_auth", "value": True},
            {
                "key": "advanced_retrieval_switch",
                "value": {"rerank_flag": True, "rerank_model": 42, "user_auth": True},
            },
        )

        stripped, changed = strip_workflow_knowledge(graph)

        params = stripped["nodes"][0]["data"]["group_params"][0]["params"]
        self.assertTrue(changed)
        self.assertEqual(params[0]["value"], {"type": "knowledge", "value": []})
        self.assertEqual(params[1]["value"], {})
        self.assertFalse(params[2]["value"])
        self.assertEqual(
            params[3]["value"],
            {"rerank_flag": False, "rerank_model": "", "user_auth": False},
        )
        self.assertEqual(scan_workflow_data(stripped).knowledge_references, ())
        self.assertEqual(scan_workflow_data(stripped).rerank_model_ids, ())

    def test_openapi_requires_auth_detects_declared_security(self) -> None:
        schemas = [
            '{"openapi":"3.0.0","security":[{"bearer":[]}]}',
            '{"openapi":"3.0.0","components":{"securitySchemes":{"bearer":{"type":"http"}}}}',
            '{"swagger":"2.0","securityDefinitions":{"key":{"type":"apiKey"}}}',
            "openapi: 3.0.0\npaths:\n  /x:\n    get:\n      security:\n        - key: []\n",
        ]
        for schema in schemas:
            with self.subTest(schema=schema):
                self.assertTrue(openapi_requires_auth(schema))

    def test_openapi_requires_auth_accepts_public_schema(self) -> None:
        self.assertFalse(openapi_requires_auth('{"openapi":"3.0.0","paths":{"/x":{"get":{}}}}'))

    def test_validate_bundle_accepts_one_current_version(self) -> None:
        validate_bundle(_bundle())

    def test_validate_bundle_rejects_application_id_collision(self) -> None:
        bundle = _bundle()
        bundle["assistants"] = [{"id": "workflow-id"}]

        with self.assertRaisesRegex(MigrationBundleError, "unique"):
            validate_bundle(bundle)

    def test_validate_bundle_rejects_duplicate_tool_keys(self) -> None:
        bundle = _bundle()
        bundle["external_tools"] = [
            {"source_id": 1, "tool_key": "same", "name": "one"},
            {"source_id": 2, "tool_key": "same", "name": "two"},
        ]

        with self.assertRaisesRegex(MigrationBundleError, "unique"):
            validate_bundle(bundle)


if __name__ == "__main__":
    unittest.main()
