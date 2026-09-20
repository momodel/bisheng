from __future__ import annotations

from types import SimpleNamespace

import pytest

from scripts.upgrade_v24_to_current import (
    MigrationRunSnapshot,
    UpgradePreconditionError,
    choose_migration_action,
    compute_menu_backfill,
    execute_data_upgrade,
)


def _run(
    *,
    run_id: int = 7,
    phase: str = "SOURCE_VALIDATING",
    status: str = "RUNNING",
) -> MigrationRunSnapshot:
    return MigrationRunSnapshot(
        id=run_id,
        phase=phase,
        status=status,
        store_id="store-1",
        source_model_id="legacy-model",
        target_model_id="target-model" if phase != "SOURCE_VALIDATING" else None,
    )


def test_compute_menu_backfill_is_transitive_and_idempotent() -> None:
    existing = [
        (1, 10, "build"),
        (1, 10, "knowledge"),
        (2, 20, "frontend"),
        (2, 20, "apps"),
    ]

    missing = compute_menu_backfill(existing)

    assert missing == [
        (1, 10, "create_app"),
        (1, 10, "create_knowledge"),
        (2, 20, "home"),
        (2, 20, "subscription"),
        (2, 20, "linsight_task_mode"),
    ]
    assert compute_menu_backfill([*existing, *missing]) == []


@pytest.mark.parametrize(
    ("runs", "expected"),
    [
        ([], "bootstrap_and_migrate"),
        ([_run()], "resume_migrate"),
        ([_run(phase="VERIFYING", status="BLOCKED")], "verify"),
        ([_run(phase="READY_TO_START", status="COMPLETED")], "already_complete"),
    ],
)
def test_choose_migration_action(
    runs: list[MigrationRunSnapshot],
    expected: str,
) -> None:
    assert choose_migration_action(runs) == expected


def test_choose_migration_action_fails_closed_on_ambiguous_or_invalid_state() -> None:
    with pytest.raises(UpgradePreconditionError, match="found 2"):
        choose_migration_action([_run(run_id=1), _run(run_id=2)])
    with pytest.raises(UpgradePreconditionError, match="cannot be resumed"):
        choose_migration_action([_run(status="FAILED_CLOSED")])
    with pytest.raises(UpgradePreconditionError, match="READY_TO_START"):
        choose_migration_action([_run(phase="READY_TO_START", status="RUNNING")])


class _FakeRuntime:
    def __init__(self, calls: list[object]) -> None:
        self.calls = calls
        self.source_client = SimpleNamespace(store_id="store-1", model_id="legacy-model")
        self.coordinator = self
        self.verifier = self

    async def migrate(self, **kwargs):
        self.calls.append(("migrate", kwargs))
        return SimpleNamespace(
            run_id=kwargs["run_id"] or 9,
            phase="VERIFYING",
            status="RUNNING",
            store_id="store-1",
            source_model_id="legacy-model",
            target_model_id="target-model",
            source_checksum="source-checksum",
            target_checksum="target-checksum",
        )

    async def verify(self, *, run_id: int):
        self.calls.append(("verify", run_id))
        return SimpleNamespace(
            id=run_id,
            phase="READY_TO_START",
            status="COMPLETED",
            store_id="store-1",
            source_model_id="legacy-model",
            target_model_id="target-model",
        )

    async def aclose(self) -> None:
        self.calls.append("runtime_close")


async def _execute_with_state(runs: list[MigrationRunSnapshot]):
    calls: list[object] = []
    runtime = _FakeRuntime(calls)

    async def initialize_context(**_kwargs) -> None:
        calls.append("context_init")

    async def close_context() -> None:
        calls.append("context_close")

    async def bootstrapper(*, apply: bool):
        calls.append(("bootstrap", apply))
        return {
            "store_id": "store-1",
            "source_model_id": "legacy-model",
            "tuple_count": 3,
        }

    async def runtime_factory(*, run_id: int | None):
        calls.append(("runtime", run_id))
        return runtime

    report = await execute_data_upgrade(
        live_settings=SimpleNamespace(openfga=SimpleNamespace(enabled=True)),
        initialize_context=initialize_context,
        close_context=close_context,
        legacy_redis_checker=lambda: {"matching_keys": []},
        heartbeat_checker=lambda: {"active_heartbeats": 0},
        run_loader=lambda: runs,
        bootstrapper=bootstrapper,
        menu_backfill=lambda **_kwargs: {"backfilled": 2},
        runtime_factory=runtime_factory,
    )
    return report, calls


async def test_pipeline_bootstraps_new_source_then_migrates_and_verifies() -> None:
    report, calls = await _execute_with_state([])

    assert report["migration_action"] == "bootstrap_and_migrate"
    assert ("bootstrap", True) in calls
    assert ("runtime", None) in calls
    assert any(isinstance(call, tuple) and call[0] == "migrate" for call in calls)
    assert ("verify", 9) in calls
    assert report["final_phase"] == "READY_TO_START"
    assert calls[-2:] == ["runtime_close", "context_close"]


async def test_pipeline_resumes_the_same_durable_run() -> None:
    report, calls = await _execute_with_state([_run(run_id=17)])

    assert report["migration_action"] == "resume_migrate"
    assert not any(isinstance(call, tuple) and call[0] == "bootstrap" for call in calls)
    assert ("runtime", 17) in calls
    migrate_call = next(call for call in calls if isinstance(call, tuple) and call[0] == "migrate")
    assert migrate_call[1]["run_id"] == 17
    assert ("verify", 17) in calls


async def test_pipeline_verifies_without_rerunning_migration() -> None:
    report, calls = await _execute_with_state([_run(run_id=21, phase="VERIFYING")])

    assert report["migration_action"] == "verify"
    assert not any(isinstance(call, tuple) and call[0] == "migrate" for call in calls)
    assert ("verify", 21) in calls


async def test_pipeline_treats_completed_run_as_no_op() -> None:
    report, calls = await _execute_with_state([_run(run_id=25, phase="READY_TO_START", status="COMPLETED")])

    assert report["migration_action"] == "already_complete"
    assert report["run_id"] == 25
    assert not any(isinstance(call, tuple) and call[0] == "runtime" for call in calls)
    assert calls[-1] == "context_close"
