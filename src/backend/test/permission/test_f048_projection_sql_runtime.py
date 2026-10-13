"""SQL reservation and finalization contracts for F048 projections."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession

from bisheng.common.errcode.permission import (
    PermissionPublishNotReadyError,
    PermissionVersionConflictError,
)
from bisheng.core.context.tenant import (
    bypass_tenant_filter,
    current_tenant_id,
    set_current_tenant_id,
)
from bisheng.permission.application import control_state, sql_runtime
from bisheng.permission.application.control_state import (
    SqlGrantMutationState,
    SqlPermissionControlState,
)
from bisheng.permission.application.published_viewers import published_viewer_changes
from bisheng.permission.application.sql_runtime import (
    SqlProjectionFinalizer,
    SqlProjectionScopeGuard,
)
from bisheng.permission.domain.models import (
    PermissionGrant,
    PermissionGrantAssignee,
    PermissionProjectionOperation,
    PermissionVisibleSourceProjection,
    ResourcePermissionMode,
)
from bisheng.permission.domain.repositories.projection_repository import ProjectionRepository
from bisheng.permission.domain.schemas import VerifiedPermissionTarget
from bisheng.permission.domain.services.grant_service import CanonicalGrantChange, GrantMutationContext, GrantService
from bisheng.permission.domain.services.grant_source_service import (
    GrantModelSnapshot,
    GrantSnapshot,
    GrantSourceService,
)
from bisheng.permission.domain.services.projection_plan import (
    ProjectionPlan,
    ProjectionTupleDelta,
)
from bisheng.permission.domain.services.projection_service import ProjectionService
from bisheng.permission.domain.services.visibility_projection_service import (
    VisibilityProjectionCompiler,
)
from test.permission.test_f048_projection_service import FakeFGAProjection, FakeRecentMarker


@pytest.fixture(autouse=True)
def tenant_context() -> AsyncIterator[None]:
    token = set_current_tenant_id(7)
    yield
    current_tenant_id.reset(token)


@pytest.fixture
async def session_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator:
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    metadata = sa.MetaData()
    for name in (
        "permission_projection_operation",
        "permission_projection_tuple",
        "permission_migration_run",
        "permission_migration_item",
        "permission_visible_source_projection",
        "permission_grant",
        "permission_grant_assignee",
        "resource_permission_mode",
    ):
        cloned = SQLModel.metadata.tables[name].to_metadata(metadata)
        cloned.c.id.type = sa.Integer()
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)

    @asynccontextmanager
    async def factory() -> AsyncIterator[AsyncSession]:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            yield session

    monkeypatch.setattr(sql_runtime, "get_async_db_session", factory)
    monkeypatch.setattr(control_state, "get_async_db_session", factory)
    yield factory
    await engine.dispose()


@pytest.mark.parametrize("resource_type", ["workflow", "assistant"])
@pytest.mark.parametrize("manual_access", [False, True])
async def test_published_viewer_repeated_lifecycle_keeps_sql_and_fga_consistent(
    session_factory, monkeypatch, resource_type, manual_access
):
    state = SqlPermissionControlState()
    monkeypatch.setattr(state, "_assert_catalog_writable", AsyncMock())
    model = GrantModelSnapshot(model_key="viewer", active=True, action_codes=("visible", "use"), derived_level=1)
    target = VerifiedPermissionTarget.from_business_service(
        tenant_id=7, resource_type=resource_type, resource_id="app-cycle", resource_version=0, context_version="cycle"
    )
    async with session_factory() as session:
        async with session.begin():
            session.add(
                ResourcePermissionMode(
                    tenant_id=7,
                    resource_type=resource_type,
                    resource_id=target.resource_id,
                    mode="CUSTOM",
                    version=0,
                    projection_state="CURRENT",
                )
            )
    fga = FakeFGAProjection(set())
    fga.reject_existing_writes = True
    projection = ProjectionService(
        repository=ProjectionRepository(session_factory=session_factory),
        marker=FakeRecentMarker(),
        scope_guard=SqlProjectionScopeGuard(),
        fga=fga,
        finalizer=SqlProjectionFinalizer(),
    )
    service = GrantService(
        source_service=GrantSourceService(), projection=projection, state=SqlGrantMutationState(state)
    )
    current_version = 0
    for index, online in enumerate((True, False, True, False, True, False, True)):
        target = target.model_copy(update={"resource_version": current_version})
        context = GrantMutationContext(
            target=target,
            current_catalog_release_id=8,
            store_id="store",
            model_id="model",
            operator_id=9,
            mode="CUSTOM",
            system_authorized=True,
            capabilities=(),
            models=(model,),
            grants=await state.load_grants(target=target, models=(model,)),
            existing_visible_sources=await state.load_visible_sources(target=target),
        )
        changes = published_viewer_changes(context, group_ids=(9,), online=online)
        if manual_access and index == 0:
            manual = GrantSourceService().canonicalize_source(
                source_id=17, subject_type="user_group", subject_id="9", source_type="USER_GROUP"
            )
            changes = (*changes, CanonicalGrantChange(operation="ADD", model_key="viewer", source=manual))
        changes = await state.restore_inactive_sources(target=target, changes=changes)
        result = await service.mutate(
            context,
            changes=changes,
            expected_resource_version=current_version,
            expected_catalog_release_id=8,
            idempotency_key=f"cycle-{index}",
        )
        current_version = result.resource_version
        async with session_factory() as session:
            mode = (await session.execute(select(ResourcePermissionMode))).scalars().one()
            assignees = list((await session.execute(select(PermissionGrantAssignee))).scalars())
            visible = list((await session.execute(select(PermissionVisibleSourceProjection))).scalars())
            operations = list((await session.execute(select(PermissionProjectionOperation))).scalars())
        assert mode.projection_state == "CURRENT"
        assert all(operation.status == "FINALIZED" for operation in operations)
        active_sources = {row.id: row.version for row in assignees if row.state == "ACTIVE"}
        automatic = next(row for row in assignees if row.source_type == "OTHER")
        assert automatic.version == index + 1
        assert automatic.state == ("ACTIVE" if online else "INACTIVE")
        active_visible = {
            int(row.source_owner_key.removeprefix("grant_assignee:")): row.source_version
            for row in visible
            if row.state == "ACTIVE"
        }
        assert active_visible == active_sources
        assert (("user_group:9#member", "visible", f"{resource_type}:app-cycle") in fga.present) == (
            online or manual_access
        )


async def test_visible_sources_are_loaded_in_one_query_for_a_publication_batch(session_factory, monkeypatch):
    sources = GrantSourceService()
    grant = GrantSnapshot(
        grant_id="g-bulk",
        tenant_id=7,
        resource_type="workflow",
        resource_id="bulk-app",
        model=GrantModelSnapshot(model_key="viewer", active=True, action_codes=("visible",), derived_level=1),
        active=True,
        sources=tuple(
            sources.canonicalize_source(
                source_id=index, subject_type="user_group", subject_id=str(index), source_type="USER_GROUP"
            )
            for index in range(1, 54)
        ),
    )
    compilation = VisibilityProjectionCompiler().compile(tenant_id=7, grants=(grant,), existing_sources=())
    async with session_factory() as session:
        async with session.begin():
            session.execute = AsyncMock(wraps=session.execute)
            await SqlPermissionControlState._prepare_visible_sources(
                session, tenant_id=7, visibility=compilation, operation_id=1
            )
            assert session.execute.await_count == 1
            session.execute.reset_mock()
            await SqlPermissionControlState._prepare_visible_sources(
                session, tenant_id=7, visibility=compilation, operation_id=2
            )
            assert session.execute.await_count == 1
        rows = list((await session.execute(select(PermissionVisibleSourceProjection))).scalars())
    assert len(rows) == 53
    assert all(row.operation_id == 2 for row in rows)
    async with session_factory() as session:
        async with session.begin():
            session.add(
                ResourcePermissionMode(
                    tenant_id=7,
                    resource_type="workflow",
                    resource_id="bulk-app",
                    mode="CUSTOM",
                    version=0,
                    projection_state="PROJECTING",
                    operation_id=2,
                )
            )
            grant_row = await SqlPermissionControlState()._upsert_grant(
                session, grant=grant, state="PENDING", projection_state="PROJECTING"
            )
            for source in grant.sources:
                await SqlPermissionControlState._upsert_assignee(
                    session, grant_row=grant_row, source=source, state="PENDING"
                )

    owner_queries = []

    @asynccontextmanager
    async def counting_factory():
        async with session_factory() as session:
            execute = session.execute

            async def counted_execute(statement, *args, **kwargs):
                if isinstance(statement, sa.sql.Select) and "JOIN permission_grant" in str(statement):
                    owner_queries.append(statement)
                return await execute(statement, *args, **kwargs)

            session.execute = counted_execute
            yield session

    monkeypatch.setattr(sql_runtime, "get_async_db_session", counting_factory)
    plan = replace(_plan(), scope_key="workflow:bulk-app", expected_version=0, target_version=1)
    await SqlProjectionFinalizer().finalize(plan, 2)
    assert len(owner_queries) == 1
    async with session_factory() as session:
        rows = list((await session.execute(select(PermissionVisibleSourceProjection))).scalars())
    assert all(row.state == "ACTIVE" for row in rows)


def _plan() -> ProjectionPlan:
    return ProjectionPlan(
        tenant_id=7,
        idempotency_key="mode-switch-7",
        operation_type="MODE_SWITCH",
        scope_type="resource",
        scope_key="folder:42",
        expected_version=3,
        target_version=4,
        store_id="store",
        model_id="model",
        operator_id=9,
        change_item_count=1,
        deltas=(
            ProjectionTupleDelta(
                phase="COMMIT",
                sequence=0,
                action="DELETE",
                user="user:*",
                relation="custom_mode",
                object="folder:42",
            ),
            ProjectionTupleDelta(
                phase="COMMIT",
                sequence=1,
                action="WRITE",
                user="user:*",
                relation="inherit_mode",
                object="folder:42",
            ),
        ),
    )


async def _seed_projecting_state(
    session_factory,
    *,
    projection_state: str = "PROJECTING",
) -> int:
    with bypass_tenant_filter():
        async with session_factory() as session:
            async with session.begin():
                operation = PermissionProjectionOperation(
                    tenant_id=7,
                    idempotency_key="mode-switch-7",
                    request_checksum="a" * 64,
                    operation_type="MODE_SWITCH",
                    scope_type="resource",
                    scope_key="folder:42",
                    expected_version=3,
                    target_version=4,
                    store_id="store",
                    model_id="model",
                    status="COMMITTED",
                    before_checksum="b" * 64,
                    after_checksum="c" * 64,
                    operator_id=9,
                )
                session.add(operation)
                await session.flush()
                mode = ResourcePermissionMode(
                    tenant_id=7,
                    resource_type="folder",
                    resource_id="42",
                    mode="CUSTOM",
                    version=3,
                    projection_state=projection_state,
                    operation_id=int(operation.id),
                )
                grant = PermissionGrant(
                    tenant_id=7,
                    resource_type="folder",
                    resource_id="42",
                    model_key="viewer",
                    state="PENDING",
                    projection_state="PROJECTING",
                )
                session.add_all((mode, grant))
                await session.flush()
                common = {
                    "tenant_id": 7,
                    "grant_id": int(grant.id),
                    "subject_type": "user",
                    "userset_relation": None,
                    "include_children": False,
                    "source_type": "DIRECT",
                    "protected": False,
                }
                session.add_all(
                    (
                        PermissionGrantAssignee(
                            id=101,
                            subject_id="11",
                            source_ref="user:11",
                            source_locator="direct:user:11",
                            source_fingerprint="d" * 64,
                            projected_subject="user:11",
                            state="PENDING",
                            version=1,
                            **common,
                        ),
                        PermissionGrantAssignee(
                            id=102,
                            subject_id="12",
                            source_ref="user:12",
                            source_locator="direct:user:12",
                            source_fingerprint="e" * 64,
                            projected_subject="user:12",
                            state="PENDING_DELETE",
                            version=4,
                            **common,
                        ),
                    )
                )
                session.add_all(
                    (
                        PermissionVisibleSourceProjection(
                            tenant_id=7,
                            resource_type="folder",
                            resource_id="42",
                            visibility_class="ordinary",
                            projected_subject="user:11",
                            source_kind="GRANT_ASSIGNEE",
                            source_owner_key="grant_assignee:101",
                            source_locator="direct:user:11",
                            source_fingerprint="d" * 64,
                            contribution_fingerprint="1" * 64,
                            model_key="viewer",
                            source_version=1,
                            tuple_fingerprint="2" * 64,
                            state="PENDING",
                            operation_id=int(operation.id),
                        ),
                        PermissionVisibleSourceProjection(
                            tenant_id=7,
                            resource_type="folder",
                            resource_id="42",
                            visibility_class="ordinary",
                            projected_subject="user:12",
                            source_kind="GRANT_ASSIGNEE",
                            source_owner_key="grant_assignee:102",
                            source_locator="direct:user:12",
                            source_fingerprint="e" * 64,
                            contribution_fingerprint="3" * 64,
                            model_key="viewer",
                            source_version=4,
                            tuple_fingerprint="4" * 64,
                            state="PENDING",
                            operation_id=int(operation.id),
                        ),
                    )
                )
            return int(operation.id)


@pytest.mark.asyncio
async def test_resource_scope_reservation_requires_bound_operation(
    session_factory,
) -> None:
    operation_id = await _seed_projecting_state(session_factory)
    guard = SqlProjectionScopeGuard()

    await guard.reserve(_plan(), operation_id)
    assert await guard.is_expected_version(_plan(), operation_id) is True
    assert await guard.is_expected_version(_plan(), operation_id + 1) is False
    with pytest.raises(PermissionPublishNotReadyError):
        await guard.reserve(_plan(), operation_id + 1)


@pytest.mark.asyncio
async def test_source_only_finalizer_keeps_mode_and_converges_pending_sources(session_factory) -> None:
    operation_id = await _seed_projecting_state(session_factory)
    plan = replace(_plan(), operation_type="GRANT_MUTATION", deltas=())
    finalizer = SqlProjectionFinalizer()
    await finalizer.finalize(plan, operation_id)
    await finalizer.finalize(plan, operation_id)
    with bypass_tenant_filter():
        async with session_factory() as session:
            mode = (await session.exec(select(ResourcePermissionMode))).one()
            assignees = (await session.exec(select(PermissionGrantAssignee).order_by(PermissionGrantAssignee.id))).all()
    assert (mode.version, mode.projection_state, mode.mode) == (4, "CURRENT", "CUSTOM")
    assert [(row.state, row.version) for row in assignees] == [("ACTIVE", 1), ("INACTIVE", 5)]


@pytest.mark.asyncio
async def test_resource_finalizer_atomically_converges_and_replays(
    session_factory,
) -> None:
    operation_id = await _seed_projecting_state(session_factory)
    finalizer = SqlProjectionFinalizer()

    await finalizer.finalize(_plan(), operation_id)
    await finalizer.finalize(_plan(), operation_id)

    with bypass_tenant_filter():
        async with session_factory() as session:
            mode = (await session.execute(select(ResourcePermissionMode))).scalars().one()
            grant = (await session.execute(select(PermissionGrant))).scalars().one()
            assignees = list(
                (await session.execute(select(PermissionGrantAssignee).order_by(PermissionGrantAssignee.id))).scalars()
            )
            visible_sources = list(
                (
                    await session.execute(
                        select(PermissionVisibleSourceProjection).order_by(PermissionVisibleSourceProjection.id)
                    )
                ).scalars()
            )

    assert (mode.version, mode.projection_state, mode.mode) == (
        4,
        "CURRENT",
        "INHERIT",
    )
    assert (grant.state, grant.projection_state) == ("ACTIVE", "CURRENT")
    assert [(row.state, row.version) for row in assignees] == [
        ("ACTIVE", 1),
        ("INACTIVE", 5),
    ]
    assert [row.state for row in visible_sources] == ["ACTIVE", "RETIRED"]


@pytest.mark.asyncio
async def test_resource_finalizer_forward_recovers_failed_closed_mirror(
    session_factory,
) -> None:
    operation_id = await _seed_projecting_state(
        session_factory,
        projection_state="FAILED_CLOSED",
    )
    guard = SqlProjectionScopeGuard()

    assert await guard.is_failed_closed_recovery_scope(_plan(), operation_id) is True
    await SqlProjectionFinalizer().finalize(_plan(), operation_id)

    with bypass_tenant_filter():
        async with session_factory() as session:
            mode = (await session.execute(select(ResourcePermissionMode))).scalars().one()
            grant = (await session.execute(select(PermissionGrant))).scalars().one()
    assert (mode.version, mode.projection_state, mode.mode) == (
        4,
        "CURRENT",
        "INHERIT",
    )
    assert (grant.state, grant.projection_state) == ("ACTIVE", "CURRENT")


@pytest.mark.asyncio
async def test_resource_finalizer_retires_old_model_source_after_assignee_move(
    session_factory,
) -> None:
    plan = ProjectionPlan(
        tenant_id=7,
        idempotency_key="move-visible-7",
        operation_type="GRANT_MUTATION",
        scope_type="resource",
        scope_key="folder:42",
        expected_version=3,
        target_version=4,
        store_id="store",
        model_id="model",
        operator_id=9,
        change_item_count=1,
        deltas=(
            ProjectionTupleDelta(
                phase="COMMIT",
                sequence=0,
                action="WRITE",
                user="user:11",
                relation="ordinary_assignee",
                object="permission_grant:g-editor",
            ),
        ),
    )
    with bypass_tenant_filter():
        async with session_factory() as session:
            async with session.begin():
                operation = PermissionProjectionOperation(
                    tenant_id=7,
                    idempotency_key=plan.idempotency_key,
                    request_checksum="a" * 64,
                    operation_type=plan.operation_type,
                    scope_type=plan.scope_type,
                    scope_key=plan.scope_key,
                    expected_version=plan.expected_version,
                    target_version=plan.target_version,
                    store_id=plan.store_id,
                    model_id=plan.model_id,
                    status="COMMITTED",
                    before_checksum="b" * 64,
                    after_checksum="c" * 64,
                    operator_id=plan.operator_id,
                )
                session.add(operation)
                await session.flush()
                mode = ResourcePermissionMode(
                    tenant_id=7,
                    resource_type="folder",
                    resource_id="42",
                    mode="CUSTOM",
                    version=3,
                    projection_state="PROJECTING",
                    operation_id=int(operation.id),
                )
                old_grant = PermissionGrant(
                    tenant_id=7,
                    resource_type="folder",
                    resource_id="42",
                    model_key="viewer",
                    state="ACTIVE",
                    projection_state="PROJECTING",
                )
                target_grant = PermissionGrant(
                    tenant_id=7,
                    resource_type="folder",
                    resource_id="42",
                    model_key="editor",
                    state="PENDING",
                    projection_state="PROJECTING",
                )
                session.add_all((mode, old_grant, target_grant))
                await session.flush()
                session.add(
                    PermissionGrantAssignee(
                        id=201,
                        tenant_id=7,
                        grant_id=int(target_grant.id),
                        subject_type="user",
                        subject_id="11",
                        userset_relation=None,
                        include_children=False,
                        source_type="DIRECT",
                        source_ref="user:11",
                        source_locator="direct:user:11",
                        source_fingerprint="d" * 64,
                        projected_subject="user:11",
                        protected=False,
                        state="PENDING",
                        version=2,
                    )
                )
                session.add_all(
                    (
                        PermissionVisibleSourceProjection(
                            tenant_id=7,
                            resource_type="folder",
                            resource_id="42",
                            visibility_class="ordinary",
                            projected_subject="user:11",
                            source_kind="GRANT_ASSIGNEE",
                            source_owner_key="grant_assignee:201",
                            source_locator="direct:user:11",
                            source_fingerprint="d" * 64,
                            contribution_fingerprint="5" * 64,
                            model_key="viewer",
                            source_version=1,
                            tuple_fingerprint="7" * 64,
                            state="PENDING",
                            operation_id=int(operation.id),
                        ),
                        PermissionVisibleSourceProjection(
                            tenant_id=7,
                            resource_type="folder",
                            resource_id="42",
                            visibility_class="ordinary",
                            projected_subject="user:11",
                            source_kind="GRANT_ASSIGNEE",
                            source_owner_key="grant_assignee:201",
                            source_locator="direct:user:11",
                            source_fingerprint="d" * 64,
                            contribution_fingerprint="6" * 64,
                            model_key="editor",
                            source_version=2,
                            tuple_fingerprint="7" * 64,
                            state="PENDING",
                            operation_id=int(operation.id),
                        ),
                    )
                )
                operation_id = int(operation.id)

    await SqlProjectionFinalizer().finalize(plan, operation_id)

    with bypass_tenant_filter():
        async with session_factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(PermissionVisibleSourceProjection).order_by(PermissionVisibleSourceProjection.model_key)
                    )
                ).scalars()
            )
    assert [(row.model_key, row.state) for row in rows] == [
        ("editor", "ACTIVE"),
        ("viewer", "RETIRED"),
    ]


@pytest.mark.asyncio
async def test_assignee_move_preserves_identity_and_advances_version(
    session_factory,
) -> None:
    source = GrantSourceService().canonicalize_source(
        source_id=101,
        subject_type="user",
        subject_id="11",
        source_type="DIRECT",
    )
    with bypass_tenant_filter():
        async with session_factory() as session:
            async with session.begin():
                old_grant = PermissionGrant(
                    tenant_id=7,
                    resource_type="folder",
                    resource_id="42",
                    model_key="viewer",
                    state="ACTIVE",
                    projection_state="CURRENT",
                )
                target_grant = PermissionGrant(
                    tenant_id=7,
                    resource_type="folder",
                    resource_id="42",
                    model_key="editor",
                    state="PENDING",
                    projection_state="PROJECTING",
                )
                session.add_all((old_grant, target_grant))
                await session.flush()
                session.add(
                    PermissionGrantAssignee(
                        id=source.source_id,
                        tenant_id=7,
                        grant_id=int(old_grant.id),
                        subject_type=source.subject_type,
                        subject_id=source.subject_id,
                        userset_relation=source.userset_relation,
                        include_children=source.include_children,
                        source_type=source.source_type,
                        source_ref=source.source_ref,
                        source_locator=source.source_locator,
                        source_fingerprint=source.source_fingerprint,
                        projected_subject=source.projected_subject,
                        protected=source.protected,
                        state="ACTIVE",
                        version=1,
                    )
                )
                await session.flush()

                moved = await SqlPermissionControlState._upsert_assignee(
                    session,
                    grant_row=target_grant,
                    source=replace(source, version=2),
                    state="PENDING",
                )

                assert moved.id == 101
                assert moved.grant_id == target_grant.id
                assert moved.version == 2


@pytest.mark.asyncio
async def test_assignee_move_replaces_inactive_target_identity(
    session_factory,
) -> None:
    source = GrantSourceService().canonicalize_source(
        source_id=101,
        subject_type="user",
        subject_id="11",
        source_type="DIRECT",
    )
    with bypass_tenant_filter():
        async with session_factory() as session:
            async with session.begin():
                old_grant = PermissionGrant(
                    tenant_id=7,
                    resource_type="folder",
                    resource_id="42",
                    model_key="viewer",
                    state="ACTIVE",
                    projection_state="CURRENT",
                )
                target_grant = PermissionGrant(
                    tenant_id=7,
                    resource_type="folder",
                    resource_id="42",
                    model_key="editor",
                    state="ACTIVE",
                    projection_state="CURRENT",
                )
                session.add_all((old_grant, target_grant))
                await session.flush()
                session.add_all(
                    (
                        PermissionGrantAssignee(
                            id=source.source_id,
                            tenant_id=7,
                            grant_id=int(old_grant.id),
                            subject_type=source.subject_type,
                            subject_id=source.subject_id,
                            userset_relation=source.userset_relation,
                            include_children=source.include_children,
                            source_type=source.source_type,
                            source_ref=source.source_ref,
                            source_locator=source.source_locator,
                            source_fingerprint=source.source_fingerprint,
                            projected_subject=source.projected_subject,
                            protected=source.protected,
                            state="ACTIVE",
                            version=1,
                        ),
                        PermissionGrantAssignee(
                            id=202,
                            tenant_id=7,
                            grant_id=int(target_grant.id),
                            subject_type=source.subject_type,
                            subject_id=source.subject_id,
                            userset_relation=source.userset_relation,
                            include_children=source.include_children,
                            source_type=source.source_type,
                            source_ref=source.source_ref,
                            source_locator=source.source_locator,
                            source_fingerprint=source.source_fingerprint,
                            projected_subject=source.projected_subject,
                            protected=source.protected,
                            state="INACTIVE",
                            version=4,
                        ),
                        PermissionVisibleSourceProjection(
                            tenant_id=7,
                            resource_type="folder",
                            resource_id="42",
                            visibility_class="ordinary",
                            projected_subject=source.projected_subject,
                            source_kind="GRANT_ASSIGNEE",
                            source_owner_key="grant_assignee:202",
                            source_locator=source.source_locator,
                            source_fingerprint=source.source_fingerprint,
                            contribution_fingerprint="8" * 64,
                            model_key="editor",
                            source_version=4,
                            tuple_fingerprint="9" * 64,
                            state="RETIRED",
                        ),
                    )
                )
                await session.flush()

                moved = await SqlPermissionControlState._upsert_assignee(
                    session,
                    grant_row=target_grant,
                    source=replace(source, version=2),
                    state="PENDING",
                )

                assert moved.id == 101
                assert moved.grant_id == target_grant.id
                assert moved.version == 2

            rows = list(
                (await session.execute(select(PermissionGrantAssignee).order_by(PermissionGrantAssignee.id)))
                .scalars()
                .all()
            )

    assert [(row.id, row.grant_id, row.state, row.version) for row in rows] == [
        (101, target_grant.id, "PENDING", 2),
    ]


@pytest.mark.asyncio
async def test_visible_source_after_state_is_frozen_then_finalized(
    session_factory,
) -> None:
    source = GrantSourceService().canonicalize_source(
        source_id=201,
        subject_type="user",
        subject_id="21",
        source_type="DIRECT",
    )
    grant = GrantSnapshot(
        grant_id="g-viewer",
        tenant_id=7,
        resource_type="folder",
        resource_id="42",
        model=GrantModelSnapshot(
            model_key="viewer",
            active=True,
            action_codes=("download",),
            derived_level=1,
        ),
        active=True,
        sources=(source,),
    )
    compiler = VisibilityProjectionCompiler()
    added = compiler.compile(
        tenant_id=7,
        grants=(grant,),
        existing_sources=(),
    )

    with bypass_tenant_filter():
        async with session_factory() as session:
            async with session.begin():
                operation = PermissionProjectionOperation(
                    tenant_id=7,
                    idempotency_key="visible-add",
                    request_checksum="a" * 64,
                    operation_type="GRANT_MUTATION",
                    scope_type="resource",
                    scope_key="folder:42",
                    expected_version=3,
                    target_version=4,
                    store_id="store",
                    model_id="model",
                    status="PREPARED",
                    before_checksum="b" * 64,
                    after_checksum="c" * 64,
                    operator_id=9,
                )
                session.add(operation)
                await session.flush()
                operation_id = int(operation.id)
                await SqlPermissionControlState._prepare_visible_sources(
                    session,
                    tenant_id=7,
                    visibility=added,
                    operation_id=operation_id,
                )
        async with session_factory() as session:
            pending = (await session.execute(select(PermissionVisibleSourceProjection))).scalars().one()
            assert (pending.state, pending.operation_id) == ("PENDING", operation_id)
        async with session_factory() as session:
            async with session.begin():
                await SqlPermissionControlState._finalize_visible_sources(
                    session,
                    tenant_id=7,
                    visibility=added,
                    operation_id=operation_id,
                )
        async with session_factory() as session:
            active = (await session.execute(select(PermissionVisibleSourceProjection))).scalars().one()
            assert active.state == "ACTIVE"

    removed = compiler.compile(
        tenant_id=7,
        grants=(replace(grant, active=False, sources=()),),
        existing_sources=added.active_sources,
    )
    with bypass_tenant_filter():
        async with session_factory() as session:
            async with session.begin():
                await SqlPermissionControlState._prepare_visible_sources(
                    session,
                    tenant_id=7,
                    visibility=removed,
                    operation_id=operation_id,
                )
        async with session_factory() as session:
            pending = (await session.execute(select(PermissionVisibleSourceProjection))).scalars().one()
            assert pending.state == "PENDING"
        async with session_factory() as session:
            async with session.begin():
                await SqlPermissionControlState._finalize_visible_sources(
                    session,
                    tenant_id=7,
                    visibility=removed,
                    operation_id=operation_id,
                )
        async with session_factory() as session:
            retired = (await session.execute(select(PermissionVisibleSourceProjection))).scalars().one()
            assert retired.state == "RETIRED"


def test_resource_claim_rejects_competing_same_version_operation() -> None:
    row = ResourcePermissionMode(
        tenant_id=7,
        resource_type="folder",
        resource_id="42",
        mode="CUSTOM",
        version=3,
        projection_state="CURRENT",
        operation_id=8,
    )

    SqlPermissionControlState._claim_projection_operation(
        row,
        expected_version=3,
        operation_id=9,
        allowed_initial_states=("CURRENT",),
    )
    SqlPermissionControlState._claim_projection_operation(
        row,
        expected_version=3,
        operation_id=9,
        allowed_initial_states=("CURRENT",),
    )
    with pytest.raises(PermissionVersionConflictError):
        SqlPermissionControlState._claim_projection_operation(
            row,
            expected_version=3,
            operation_id=10,
            allowed_initial_states=("CURRENT",),
        )
