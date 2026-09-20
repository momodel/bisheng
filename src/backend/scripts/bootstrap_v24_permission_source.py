#!/usr/bin/env python3
"""Build the legacy OpenFGA source required by the formal F048 migration.

This is an upgrade bridge for a v2.4 database restored directly under the
current code.  The v2.4 database has no OpenFGA Store, while the current F048
migration deliberately requires a predecessor model and tuple inventory.

The script reconstructs that predecessor from authoritative legacy SQL data,
publishes the still-shipped ``v2.0.2`` authorization model, writes the planned
tuples, and verifies an exact Store match.  It does not publish F048 or start
the API; ``upgrade_v24_to_current.py`` owns the complete sequence.

Dry-run is the default.  ``--apply`` is required for OpenFGA writes.
Run from ``src/backend`` with the same ``config`` value as the deployment.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
from collections import Counter
from dataclasses import dataclass
from typing import Any

from sqlalchemy import inspect
from sqlalchemy import text as sa_text

_BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

from bisheng.common.services.config_service import settings  # noqa: E402
from bisheng.core.context.manager import (  # noqa: E402
    close_app_context,
    initialize_app_context,
)
from bisheng.core.context.tenant import bypass_tenant_filter  # noqa: E402
from bisheng.core.database import get_async_db_session  # noqa: E402
from bisheng.core.openfga.authorization_model import (  # noqa: E402
    MODEL_VERSION as LEGACY_MODEL_VERSION,
)
from bisheng.core.openfga.authorization_model import (  # noqa: E402
    get_authorization_model,
)
from bisheng.core.openfga.client import FGAClient  # noqa: E402
from bisheng.core.openfga.discovery import (  # noqa: E402
    discover_openfga_runtime,
)

WEB_MENU = 99
OPENFGA_WRITE_BATCH_SIZE = 90

ACCESS_TYPE_MAPPING: dict[int, tuple[str, str]] = {
    1: ("knowledge_library", "viewer"),
    3: ("knowledge_library", "editor"),
    5: ("assistant", "viewer"),
    6: ("assistant", "editor"),
    7: ("tool", "viewer"),
    8: ("tool", "editor"),
    9: ("workflow", "viewer"),
    10: ("workflow", "editor"),
    11: ("dashboard", "viewer"),
    12: ("dashboard", "editor"),
}
GROUP_RESOURCE_TYPE_MAPPING: dict[int, tuple[str, ...]] = {
    1: ("knowledge_library", "knowledge_space"),
    3: ("assistant",),
    4: ("tool",),
    5: ("workflow",),
    6: ("dashboard",),
}
SPACE_CHANNEL_ROLE_MAPPING = {
    "creator": "owner",
    "admin": "manager",
    "member": "viewer",
}
SPACE_CHANNEL_TYPE_MAPPING = {
    "space": "knowledge_space",
    "channel": "channel",
}
RELATION_PRIORITY = {
    "super_admin": 7,
    "admin": 6,
    "member": 5,
    "owner": 4,
    "manager": 3,
    "editor": 2,
    "viewer": 1,
    "parent": 0,
    "shared_with": 0,
}

F048_STATE_TABLES = (
    "authorization_model_release",
    "permission_catalog_release",
    "permission_action",
    "permission_action_resource_scope",
    "permission_model",
    "permission_model_action",
    "permission_catalog_projection_tuple",
    "permission_projection_operation",
    "permission_projection_tuple",
    "permission_visible_source_projection",
    "permission_grant",
    "permission_grant_assignee",
    "resource_permission_mode",
    "permission_migration_run",
    "permission_migration_item",
)


def _require_backend_cwd() -> None:
    if os.path.abspath(os.getcwd()) != _BACKEND_ROOT:
        raise RuntimeError(f"Run this script from the backend root: cd {_BACKEND_ROOT}")


@dataclass(frozen=True, order=True, slots=True)
class TupleKey:
    user: str
    relation: str
    object: str

    def as_dict(self) -> dict[str, str]:
        return {
            "user": self.user,
            "relation": self.relation,
            "object": self.object,
        }


class TupleAccumulator:
    """Apply the legacy F006 one-relation-per-subject/object precedence."""

    def __init__(self) -> None:
        self._by_subject_object: dict[tuple[str, str], TupleKey] = {}
        self.candidate_count = 0

    def add(self, user: str, relation: str, object_key: str) -> None:
        if not user or not relation or not object_key:
            return
        self.candidate_count += 1
        candidate = TupleKey(user=user, relation=relation, object=object_key)
        key = (user, object_key)
        current = self._by_subject_object.get(key)
        if current is None:
            self._by_subject_object[key] = candidate
            return
        if RELATION_PRIORITY.get(relation, -1) > RELATION_PRIORITY.get(current.relation, -1):
            self._by_subject_object[key] = candidate

    def tuples(self) -> tuple[TupleKey, ...]:
        return tuple(sorted(self._by_subject_object.values()))


def resolve_knowledge_parent(
    knowledge_id: Any,
    knowledge_type: Any,
    file_level_path: Any,
) -> tuple[str, str] | None:
    segments = [segment for segment in str(file_level_path or "").split("/") if segment]
    if not segments:
        resource_type = "knowledge_space" if int(knowledge_type) == 3 else "knowledge_library"
        return resource_type, str(knowledge_id)
    if not segments[-1].isdigit():
        return None
    return "folder", segments[-1]


def tuple_checksum(tuples: tuple[TupleKey, ...]) -> str:
    payload = [item.as_dict() for item in tuples]
    encoded = json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class LegacyV24TuplePlanner:
    def __init__(self, session: Any, *, table_names: set[str]) -> None:
        self._session = session
        self._table_names = table_names
        self._tuples = TupleAccumulator()
        self._resources: dict[str, set[str]] = {}

    async def _rows(
        self,
        statement: str,
        *,
        optional_table: str | None = None,
    ) -> list[Any]:
        if optional_table is not None and optional_table not in self._table_names:
            return []
        result = await self._session.execute(sa_text(statement))
        return list(result.fetchall())

    def _remember_resource(self, resource_type: str, resource_id: Any) -> None:
        self._resources.setdefault(resource_type, set()).add(str(resource_id))

    def _resource_exists(self, resource_type: str, resource_id: Any) -> bool:
        return str(resource_id) in self._resources.get(resource_type, set())

    async def _load_resources_and_owners(self) -> None:
        specs = (
            ("SELECT id, user_id, type FROM knowledge", "knowledge", None),
            ("SELECT id, user_id FROM t_gpts_tools WHERE is_delete = 0", "tool", None),
            ("SELECT id, user_id FROM channel", "channel", None),
            ("SELECT id, user_id FROM dashboard", "dashboard", "dashboard"),
            ("SELECT id, user_id FROM flow WHERE flow_type = 10", "workflow", None),
            ("SELECT id, user_id FROM assistant WHERE is_delete = 0", "assistant", None),
        )
        for statement, declared_type, optional_table in specs:
            for row in await self._rows(statement, optional_table=optional_table):
                resource_id, owner_id = row[0], row[1]
                resource_type = declared_type
                if declared_type == "knowledge":
                    resource_type = "knowledge_space" if int(row[2]) == 3 else "knowledge_library"
                self._remember_resource(resource_type, resource_id)
                if owner_id is not None:
                    self._tuples.add(
                        f"user:{owner_id}",
                        "owner",
                        f"{resource_type}:{resource_id}",
                    )

    async def _add_identity_tuples(self) -> None:
        for _, user_id in await self._rows("SELECT id, user_id FROM userrole WHERE role_id = 1"):
            self._tuples.add(f"user:{user_id}", "super_admin", "system:global")

        for _, user_id, group_id, is_group_admin in await self._rows(
            "SELECT id, user_id, group_id, is_group_admin FROM usergroup"
        ):
            relation = "admin" if is_group_admin else "member"
            self._tuples.add(f"user:{user_id}", relation, f"user_group:{group_id}")

        for user_id, tenant_id in await self._rows(
            "SELECT user_id, tenant_id FROM user_tenant WHERE status = 'active' AND is_active = 1 AND tenant_id != 1"
        ):
            self._tuples.add(f"user:{user_id}", "member", f"tenant:{tenant_id}")

        for user_id, department_id in await self._rows("SELECT user_id, department_id FROM user_department"):
            self._tuples.add(f"user:{user_id}", "member", f"department:{department_id}")

        for user_id, department_id in await self._rows(
            "SELECT user_id, department_id FROM department_admin_grant",
            optional_table="department_admin_grant",
        ):
            self._tuples.add(f"user:{user_id}", "admin", f"department:{department_id}")

        for department_id, parent_id in await self._rows(
            "SELECT id, parent_id FROM department WHERE status = 'active' AND parent_id IS NOT NULL"
        ):
            self._tuples.add(
                f"department:{parent_id}",
                "parent",
                f"department:{department_id}",
            )

    async def _add_role_access(self) -> None:
        rows = await self._rows(
            "SELECT ur.user_id, ra.third_id, ra.type "
            "FROM roleaccess ra JOIN userrole ur ON ur.role_id = ra.role_id "
            f"WHERE ra.type != {WEB_MENU} AND ra.role_id != 1"
        )
        for user_id, resource_id, access_type in rows:
            mapping = ACCESS_TYPE_MAPPING.get(int(access_type))
            if mapping is None:
                continue
            resource_type, relation = mapping
            if not self._resource_exists(resource_type, resource_id):
                continue
            self._tuples.add(
                f"user:{user_id}",
                relation,
                f"{resource_type}:{resource_id}",
            )

    async def _add_space_channel_members(self) -> None:
        rows = await self._rows(
            "SELECT business_id, business_type, user_id, user_role FROM space_channel_member WHERE status = 'ACTIVE'",
            optional_table="space_channel_member",
        )
        for business_id, business_type, user_id, user_role in rows:
            relation = SPACE_CHANNEL_ROLE_MAPPING.get(str(user_role or "").casefold())
            resource_type = SPACE_CHANNEL_TYPE_MAPPING.get(str(business_type or "").casefold())
            if relation is None or resource_type is None:
                continue
            if not self._resource_exists(resource_type, business_id):
                continue
            self._tuples.add(
                f"user:{user_id}",
                relation,
                f"{resource_type}:{business_id}",
            )

    async def _add_knowledge_hierarchy(self) -> None:
        rows = await self._rows(
            "SELECT kf.id, kf.knowledge_id, kb.type, kf.file_type, kf.file_level_path "
            "FROM knowledgefile kf JOIN knowledge kb ON kf.knowledge_id = kb.id"
        )
        for file_id, knowledge_id, knowledge_type, file_type, level_path in rows:
            parent = resolve_knowledge_parent(knowledge_id, knowledge_type, level_path)
            if parent is None:
                continue
            parent_type, parent_id = parent
            child_type = "folder" if int(file_type) == 0 else "knowledge_file"
            self._tuples.add(
                f"{parent_type}:{parent_id}",
                "parent",
                f"{child_type}:{file_id}",
            )

    async def _add_group_resources(self) -> None:
        rows = await self._rows("SELECT group_id, third_id, type FROM groupresource")
        for group_id, resource_id, resource_kind in rows:
            for resource_type in GROUP_RESOURCE_TYPE_MAPPING.get(int(resource_kind), ()):
                if not self._resource_exists(resource_type, resource_id):
                    continue
                self._tuples.add(
                    f"user_group:{group_id}#admin",
                    "manager",
                    f"{resource_type}:{resource_id}",
                )

    async def _add_root_llm_shares(self) -> None:
        tenant_rows = await self._rows(
            "SELECT share_default_to_children FROM tenant WHERE id = 1",
            optional_table="tenant",
        )
        if tenant_rows and not bool(tenant_rows[0][0]):
            return
        child_ids = [
            row[0]
            for row in await self._rows(
                "SELECT id FROM tenant WHERE parent_tenant_id = 1 AND status = 'active'",
                optional_table="tenant",
            )
        ]
        server_ids = [
            row[0]
            for row in await self._rows(
                "SELECT id FROM llm_server WHERE tenant_id = 1",
                optional_table="llm_server",
            )
        ]
        for child_id in child_ids:
            for server_id in server_ids:
                self._tuples.add(
                    f"tenant:{child_id}",
                    "shared_with",
                    f"llm_server:{server_id}",
                )

    async def build(self) -> tuple[TupleKey, ...]:
        await self._load_resources_and_owners()
        await self._add_identity_tuples()
        await self._add_role_access()
        await self._add_space_channel_members()
        await self._add_knowledge_hierarchy()
        await self._add_group_resources()
        await self._add_root_llm_shares()
        return self._tuples.tuples()

    @property
    def candidate_count(self) -> int:
        return self._tuples.candidate_count


def _migration_context_settings(live_settings: Any) -> Any:
    copy_settings = getattr(live_settings, "model_copy", None)
    openfga = getattr(live_settings, "openfga", None)
    copy_openfga = getattr(openfga, "model_copy", None)
    if not callable(copy_settings) or not callable(copy_openfga):
        return live_settings
    return copy_settings(update={"openfga": copy_openfga(update={"enabled": False})})


async def _assert_clean_f048_state(session: Any) -> None:
    dirty: dict[str, int] = {}
    for table_name in F048_STATE_TABLES:
        result = await session.execute(sa_text(f"SELECT COUNT(*) FROM {table_name}"))
        count = int(result.scalar_one())
        if count:
            dirty[table_name] = count
    if dirty:
        details = ", ".join(f"{table}={count}" for table, count in sorted(dirty.items()))
        raise RuntimeError(
            "F048 state is not clean; restore the v2.4 backup and clear the failed "
            f"initialization before rerunning: {details}"
        )


async def _load_table_names(session: Any) -> set[str]:
    connection = await session.connection()
    return await connection.run_sync(lambda sync_connection: set(inspect(sync_connection).get_table_names()))


def _summarize(tuples: tuple[TupleKey, ...]) -> dict[str, Any]:
    return {
        "tuple_count": len(tuples),
        "tuple_checksum": tuple_checksum(tuples),
        "by_object_type": dict(sorted(Counter(item.object.partition(":")[0] for item in tuples).items())),
        "by_relation": dict(sorted(Counter(item.relation for item in tuples).items())),
    }


async def execute_in_context(*, apply: bool) -> dict[str, Any]:
    """Build and optionally persist the legacy source in an initialized context."""

    client: FGAClient | None = None
    try:
        with bypass_tenant_filter():
            async with get_async_db_session() as session:
                await _assert_clean_f048_state(session)
                planner = LegacyV24TuplePlanner(
                    session,
                    table_names=await _load_table_names(session),
                )
                planned = await planner.build()

        report = {
            "mode": "apply" if apply else "dry-run",
            "legacy_model_version": LEGACY_MODEL_VERSION,
            "candidate_count": planner.candidate_count,
            **_summarize(planned),
        }
        if not apply:
            return report

        config = settings.openfga
        if not config.enabled:
            raise RuntimeError("OpenFGA is disabled in the live configuration")
        pin = await discover_openfga_runtime(
            config,
            expected_model=get_authorization_model(),
            allow_bootstrap=True,
        )
        client = FGAClient(
            api_url=config.api_url,
            store_id=pin.store_id,
            model_id=pin.model_id,
            timeout=config.timeout,
        )
        existing_rows = await client.read_tuples(consistency="HIGHER_CONSISTENCY")
        existing = {
            TupleKey(
                user=str(row.get("user") or ""),
                relation=str(row.get("relation") or ""),
                object=str(row.get("object") or ""),
            )
            for row in existing_rows
        }
        planned_set = set(planned)
        surplus = existing - planned_set
        if surplus:
            sample = ", ".join(f"{item.user} {item.relation} {item.object}" for item in sorted(surplus)[:5])
            raise RuntimeError(
                "The configured OpenFGA Store contains tuples not derivable from the "
                f"restored database; clean it before migration. surplus={len(surplus)} sample={sample}"
            )

        missing = sorted(planned_set - existing)
        for offset in range(0, len(missing), OPENFGA_WRITE_BATCH_SIZE):
            batch = missing[offset : offset + OPENFGA_WRITE_BATCH_SIZE]
            await client.write_tuples(
                writes=[item.as_dict() for item in batch],
                ignore_duplicate_writes=True,
            )

        observed_rows = await client.read_tuples(consistency="HIGHER_CONSISTENCY")
        observed = {
            TupleKey(
                user=str(row.get("user") or ""),
                relation=str(row.get("relation") or ""),
                object=str(row.get("object") or ""),
            )
            for row in observed_rows
        }
        if observed != planned_set:
            raise RuntimeError(
                "Legacy OpenFGA source verification failed: "
                f"missing={len(planned_set - observed)} surplus={len(observed - planned_set)}"
            )
        return {
            **report,
            "store_id": pin.store_id,
            "source_model_id": pin.model_id,
            "existing_tuple_count": len(existing),
            "written_tuple_count": len(missing),
            "verified_tuple_count": len(observed),
        }
    finally:
        if client is not None:
            await client.close()


async def execute(*, apply: bool) -> dict[str, Any]:
    """Standalone entry point that owns the application-context lifecycle."""

    await initialize_app_context(config=_migration_context_settings(settings))
    try:
        return await execute_in_context(apply=apply)
    finally:
        await close_app_context()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create/reuse the legacy Store/model and write tuples (default: dry-run)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        _require_backend_cwd()
        report = asyncio.run(execute(apply=args.apply))
    except Exception:
        import traceback

        traceback.print_exc()
        return 4
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
