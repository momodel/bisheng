#!/usr/bin/env python3
"""Upgrade a restored v2.4 deployment to the current permission runtime.

This recovery-only entry point runs the current Alembic chain, reconstructs
the legacy OpenFGA source that F048 requires, executes or resumes the formal
F048 migration, verifies it, and backfills legacy WEB_MENU grants.  It never
starts API, Celery, or Linsight processes.

The default invocation is a plan-only dry-run.  Pass ``--apply`` to write.
Run from ``src/backend`` with the same ``config`` value as the deployment:

    python scripts/upgrade_v24_to_current.py
    python scripts/upgrade_v24_to_current.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import os
import subprocess
import sys
import traceback
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

EXIT_OK = 0
EXIT_BLOCKED = 3
EXIT_RUNTIME_ERROR = 4
WEB_MENU = 99
LEGACY_REDIS_PATTERN = "migration:f006:*"

FORMAL_PHASES = (
    "CREATED",
    "SOURCE_VALIDATING",
    "MODEL_PUBLISHED",
    "MIGRATING_CONTROL_PLANE",
    "MIGRATING_TUPLES",
    "RETIRING_LEGACY",
    "VERIFYING",
    "READY_TO_START",
)

MENU_COMPATIBILITY_RULES: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (("build",), ("create_app",)),
    (("knowledge",), ("create_knowledge",)),
    (("workstation", "frontend"), ("home", "apps", "subscription")),
    (("home",), ("linsight_task_mode",)),
)


class UpgradePreconditionError(RuntimeError):
    """Raised when the restored deployment is unsafe to upgrade."""


@dataclass(frozen=True, slots=True)
class MigrationRunSnapshot:
    id: int
    phase: str
    status: str
    store_id: str
    source_model_id: str
    target_model_id: str | None


def _require_backend_cwd() -> None:
    if Path.cwd().resolve() != _BACKEND_ROOT:
        raise UpgradePreconditionError(f"Run this script from the backend root: cd {_BACKEND_ROOT}")


def build_dry_run_report() -> dict[str, Any]:
    """Return the non-mutating execution plan.

    A restored v2.4 schema cannot be queried through current ORM models before
    Alembic runs, so the default mode intentionally performs no database or
    OpenFGA calls.
    """

    return {
        "mode": "dry-run",
        "writes": False,
        "steps": [
            "alembic upgrade head",
            "check Redis migration:f006:* keys and F048 runtime heartbeats",
            "inspect the durable F048 run and choose start/resume/verify/no-op",
            "reconstruct and verify the legacy OpenFGA source when no run exists",
            "backfill legacy WEB_MENU compatibility grants",
            "execute or resume the formal F048 migration",
            "run F048 D4 verification",
        ],
        "apply_command": "python scripts/upgrade_v24_to_current.py --apply",
    }


def run_alembic_upgrade() -> None:
    """Apply every current schema revision with the running interpreter."""

    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=_BACKEND_ROOT,
        env=os.environ.copy(),
        check=True,
    )


def compute_menu_backfill(
    existing_rows: Iterable[tuple[int, int | None, str]],
) -> list[tuple[int, int | None, str]]:
    """Compute the transitive, idempotent legacy WEB_MENU compatibility grants."""

    keys_by_scope: dict[tuple[int, int | None], set[str]] = {}
    scope_order: list[tuple[int, int | None]] = []
    for role_id, tenant_id, menu_key in existing_rows:
        scope = (role_id, tenant_id)
        if scope not in keys_by_scope:
            keys_by_scope[scope] = set()
            scope_order.append(scope)
        keys_by_scope[scope].add(menu_key)

    missing: list[tuple[int, int | None, str]] = []
    changed = True
    while changed:
        changed = False
        for scope in scope_order:
            keys = keys_by_scope[scope]
            for parent_keys, child_keys in MENU_COMPATIBILITY_RULES:
                if not any(parent in keys for parent in parent_keys):
                    continue
                for child in child_keys:
                    if child in keys:
                        continue
                    keys.add(child)
                    missing.append((*scope, child))
                    changed = True
    return missing


def choose_migration_action(runs: Sequence[MigrationRunSnapshot]) -> str:
    """Choose the only safe next operation for the durable F048 state."""

    if not runs:
        return "bootstrap_and_migrate"
    if len(runs) != 1:
        raise UpgradePreconditionError(f"Expected zero or one F048 migration run, found {len(runs)}")

    run = runs[0]
    if run.phase not in FORMAL_PHASES:
        raise UpgradePreconditionError(f"F048 run {run.id} has unknown phase {run.phase!r}")
    if run.phase == "READY_TO_START":
        if run.status != "COMPLETED":
            raise UpgradePreconditionError(f"F048 run {run.id} is READY_TO_START but status is {run.status!r}")
        return "already_complete"
    if run.status not in {"RUNNING", "BLOCKED"}:
        raise UpgradePreconditionError(f"F048 run {run.id} cannot be resumed from status {run.status!r}")
    if run.phase == "VERIFYING":
        return "verify"
    return "resume_migrate"


def _migration_context_settings(live_settings: Any) -> Any:
    """Disable online F048 discovery while the explicit migration owns clients."""

    copy_settings = getattr(live_settings, "model_copy", None)
    openfga = getattr(live_settings, "openfga", None)
    copy_openfga = getattr(openfga, "model_copy", None)
    if not callable(copy_settings) or not callable(copy_openfga):
        return live_settings
    return copy_settings(update={"openfga": copy_openfga(update={"enabled": False})})


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def assert_clean_legacy_redis() -> dict[str, Any]:
    """Require the retired F006 completion/lock state to be absent."""

    from bisheng.core.cache.redis_manager import get_redis_client

    redis_client = await get_redis_client()
    raw_keys = [key async for key in redis_client.async_connection.scan_iter(match=LEGACY_REDIS_PATTERN)]
    keys = sorted(key.decode("utf-8") if isinstance(key, bytes) else str(key) for key in raw_keys)
    if keys:
        raise UpgradePreconditionError(
            "Legacy F006 Redis state still exists; use an empty Redis or remove "
            f"these keys before retrying: {', '.join(keys)}"
        )
    return {"pattern": LEGACY_REDIS_PATTERN, "matching_keys": []}


async def assert_no_permission_runtime_heartbeats() -> dict[str, Any]:
    """Prove that no API/Worker/Linsight permission runtime is still active."""

    from bisheng.core.openfga.runtime_heartbeat import list_runtime_heartbeats

    heartbeats = await list_runtime_heartbeats()
    if heartbeats:
        raise UpgradePreconditionError(
            "Permission runtime heartbeats are still active; stop API, Worker, "
            f"and Linsight before retrying (count={len(heartbeats)})"
        )
    return {"active_heartbeats": 0}


async def load_migration_runs() -> list[MigrationRunSnapshot]:
    """Load every durable F048 run so ambiguous recovery fails closed."""

    from sqlmodel import select

    from bisheng.core.context.tenant import bypass_tenant_filter
    from bisheng.core.database import get_async_db_session
    from bisheng.permission.domain.models import PermissionMigrationRun

    with bypass_tenant_filter():
        async with get_async_db_session() as session:
            rows = (await session.exec(select(PermissionMigrationRun).order_by(PermissionMigrationRun.id))).all()
    snapshots: list[MigrationRunSnapshot] = []
    for row in rows:
        if row.id is None:
            raise UpgradePreconditionError("Persisted F048 migration run has no ID")
        snapshots.append(
            MigrationRunSnapshot(
                id=int(row.id),
                phase=row.phase,
                status=row.status,
                store_id=row.store_id,
                source_model_id=row.source_model_id,
                target_model_id=row.target_model_id,
            )
        )
    return snapshots


async def backfill_legacy_menu_access(*, apply: bool) -> dict[str, Any]:
    """Backfill all menu keys introduced after v2.4 without widening parents."""

    from sqlmodel import select

    from bisheng.core.context.tenant import bypass_tenant_filter
    from bisheng.core.database import get_async_db_session
    from bisheng.database.models.role_access import RoleAccess

    async with get_async_db_session() as session:
        with bypass_tenant_filter():
            rows = (
                await session.exec(select(RoleAccess).where(RoleAccess.type == WEB_MENU).order_by(RoleAccess.id))
            ).all()
            existing = [(row.role_id, row.tenant_id, row.third_id) for row in rows]
            missing = compute_menu_backfill(existing)
            if apply:
                for role_id, tenant_id, menu_key in missing:
                    session.add(
                        RoleAccess(
                            role_id=role_id,
                            tenant_id=tenant_id,
                            type=WEB_MENU,
                            third_id=menu_key,
                        )
                    )
                if missing:
                    await session.commit()
    return {
        "apply": apply,
        "existing_web_menu_rows": len(existing),
        "backfilled": len(missing),
        "backfilled_grants": [
            {"role_id": role_id, "tenant_id": tenant_id, "menu_key": menu_key}
            for role_id, tenant_id, menu_key in missing
        ],
    }


async def _default_runtime_factory(*, run_id: int | None) -> Any:
    from bisheng.common.services.config_service import settings
    from scripts.f048_migration_runtime import build_f048_migration_runtime

    return await build_f048_migration_runtime(settings, run_id=run_id)


async def execute_data_upgrade(
    *,
    live_settings: Any = None,
    initialize_context: Callable[..., Awaitable[None]] | None = None,
    close_context: Callable[[], Awaitable[None]] | None = None,
    legacy_redis_checker: Callable[[], Any] = assert_clean_legacy_redis,
    heartbeat_checker: Callable[[], Any] = assert_no_permission_runtime_heartbeats,
    run_loader: Callable[[], Any] = load_migration_runs,
    bootstrapper: Callable[..., Any] | None = None,
    menu_backfill: Callable[..., Any] = backfill_legacy_menu_access,
    runtime_factory: Callable[..., Any] = _default_runtime_factory,
) -> dict[str, Any]:
    """Execute the post-Alembic recovery pipeline inside one app context."""

    if live_settings is None:
        from bisheng.common.services.config_service import settings

        live_settings = settings
    if initialize_context is None or close_context is None:
        from bisheng.core.context.manager import close_app_context, initialize_app_context

        initialize_context = initialize_context or initialize_app_context
        close_context = close_context or close_app_context
    if bootstrapper is None:
        from scripts.bootstrap_v24_permission_source import execute_in_context

        bootstrapper = execute_in_context

    if not getattr(getattr(live_settings, "openfga", None), "enabled", False):
        raise UpgradePreconditionError("OpenFGA is disabled in the live configuration")

    runtime = None
    await initialize_context(config=_migration_context_settings(live_settings))
    try:
        redis_report = await _maybe_await(legacy_redis_checker())
        heartbeat_report = await _maybe_await(heartbeat_checker())
        runs = list(await _maybe_await(run_loader()))
        action = choose_migration_action(runs)
        current_run = runs[0] if runs else None

        bootstrap_report = None
        if action == "bootstrap_and_migrate":
            bootstrap_report = await _maybe_await(bootstrapper(apply=True))

        menu_report = await _maybe_await(menu_backfill(apply=True))
        report: dict[str, Any] = {
            "mode": "apply",
            "alembic": "head",
            "legacy_redis": redis_report,
            "permission_runtime": heartbeat_report,
            "migration_action": action,
            "initial_run": asdict(current_run) if current_run is not None else None,
            "legacy_source": bootstrap_report,
            "menu_backfill": menu_report,
        }

        if action == "already_complete":
            report.update(
                {
                    "run_id": current_run.id,
                    "final_phase": current_run.phase,
                    "final_status": current_run.status,
                }
            )
            return report

        run_id = current_run.id if current_run is not None else None
        runtime = await _maybe_await(runtime_factory(run_id=run_id))
        if bootstrap_report is not None:
            if runtime.source_client.store_id != bootstrap_report.get("store_id"):
                raise UpgradePreconditionError("F048 runtime discovered a Store different from the bootstrapped source")
            if runtime.source_client.model_id != bootstrap_report.get("source_model_id"):
                raise UpgradePreconditionError("F048 runtime discovered a model different from the bootstrapped source")

        if action in {"bootstrap_and_migrate", "resume_migrate"}:
            migrated = await runtime.coordinator.migrate(
                expected_store_id=runtime.source_client.store_id,
                lock_token=uuid4().hex,
                run_id=run_id,
            )
            if migrated.phase != "VERIFYING":
                raise UpgradePreconditionError(f"F048 migrate stopped at unexpected phase {migrated.phase!r}")
            run_id = migrated.run_id
            report["migration"] = {
                "run_id": migrated.run_id,
                "phase": migrated.phase,
                "status": migrated.status,
                "store_id": migrated.store_id,
                "source_model_id": migrated.source_model_id,
                "target_model_id": migrated.target_model_id,
                "source_checksum": migrated.source_checksum,
                "target_checksum": migrated.target_checksum,
            }

        if run_id is None:
            raise UpgradePreconditionError("F048 verification has no durable run ID")
        ready = await runtime.verifier.verify(run_id=run_id)
        if ready.phase != "READY_TO_START" or ready.status != "COMPLETED":
            raise UpgradePreconditionError(f"F048 verification ended at phase={ready.phase!r} status={ready.status!r}")
        report.update(
            {
                "run_id": ready.id,
                "final_phase": ready.phase,
                "final_status": ready.status,
                "store_id": ready.store_id,
                "source_model_id": ready.source_model_id,
                "target_model_id": ready.target_model_id,
            }
        )
        return report
    finally:
        try:
            if runtime is not None:
                await runtime.aclose()
        finally:
            await close_context()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply schema, SQL, and OpenFGA writes (default: print plan only)",
    )
    return parser.parse_args(argv)


def _is_formal_migration_block(exc: Exception) -> bool:
    try:
        from bisheng.common.errcode.permission import PermissionMigrationBlockedError
    except ImportError:
        return False
    return isinstance(exc, PermissionMigrationBlockedError)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        _require_backend_cwd()
        if not args.apply:
            report = build_dry_run_report()
        else:
            run_alembic_upgrade()
            report = asyncio.run(execute_data_upgrade())
    except UpgradePreconditionError as exc:
        print(f"Upgrade blocked: {exc}", file=sys.stderr)
        return EXIT_BLOCKED
    except Exception as exc:
        if _is_formal_migration_block(exc):
            print(f"Upgrade blocked: {exc}", file=sys.stderr)
            return EXIT_BLOCKED
        traceback.print_exc()
        return EXIT_RUNTIME_ERROR
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
