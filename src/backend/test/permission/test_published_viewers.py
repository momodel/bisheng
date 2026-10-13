"""Publication source lifecycle, authorization boundaries, and bounded batches."""

from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from bisheng.api.services import application_publication as business
from bisheng.common.errcode.permission import PermissionDeniedError
from bisheng.permission.application import published_viewers as application
from bisheng.permission.application.runtime import F048PermissionRuntime
from bisheng.permission.domain.schemas import VerifiedPermissionTarget
from bisheng.permission.domain.services.grant_service import CanonicalGrantChange, GrantMutationContext, GrantService
from bisheng.permission.domain.services.grant_source_service import (
    GrantModelSnapshot,
    GrantSnapshot,
    GrantSourceService,
)
from bisheng.permission.domain.services.permission_action_service import PermissionActor
from bisheng.permission.domain.services.visibility_projection_service import VisibilityProjectionCompiler
from test.permission.test_f048_grant_policy import FakeGrantState
from test.permission.test_f048_projection_service import _plan, _service


def context(resource_type="workflow", sources=()):
    target = VerifiedPermissionTarget.from_business_service(
        tenant_id=5,
        resource_type=resource_type,
        resource_id="app-1",
        resource_version=3,
        context_version="ctx",
    )
    viewer = GrantModelSnapshot(model_key="viewer", active=True, action_codes=("visible", "use"), derived_level=1)
    grant = GrantSnapshot(
        grant_id="viewer-grant",
        tenant_id=5,
        resource_type=resource_type,
        resource_id="app-1",
        model=viewer,
        active=bool(sources),
        sources=tuple(sources),
    )
    return GrantMutationContext(
        target=target,
        current_catalog_release_id=8,
        store_id="store",
        model_id="model",
        operator_id=7,
        mode="CUSTOM",
        system_authorized=False,
        capabilities=(),
        models=(viewer,),
        grants=(grant,),
    )


def apply_changes(current, changes):
    service = GrantSourceService()
    grant = current.grants[0]
    for change in changes:
        if change.operation == "ADD":
            grant = service.add_source(grant, change.source).grant
        else:
            grant = service.remove_source(grant, source_id=change.assignee_id).grant
    return replace(current, grants=(grant,))


@pytest.mark.parametrize("resource_type", ["workflow", "assistant"])
def test_publish_is_idempotent_and_unpublish_preserves_manual_group_access(resource_type):
    manual = GrantSourceService().canonicalize_source(
        source_id=17,
        subject_type="user_group",
        subject_id="9",
        source_type="USER_GROUP",
    )
    current = context(resource_type, (manual,))
    changes = application.published_viewer_changes(current, group_ids=(9, 9), online=True)
    assert len(changes) == 1
    automatic = changes[0].source
    assert automatic.projected_subject == manual.projected_subject
    assert automatic.source_fingerprint != manual.source_fingerprint
    current = apply_changes(current, changes)
    assert not application.published_viewer_changes(current, group_ids=(9,), online=True)
    removals = application.published_viewer_changes(current, group_ids=(100,), online=False)
    assert [row.assignee_id for row in removals] == [automatic.source_id]
    current = apply_changes(current, removals)
    assert current.grants[0].sources == (manual,)
    assert current.grants[0].active


def test_more_than_one_batch_and_empty_memberships():
    current = context()
    assert not application.published_viewer_changes(current, group_ids=(), online=True)
    batch_sizes = []
    while changes := application.published_viewer_changes(current, group_ids=tuple(range(1, 54)), online=True):
        batch_sizes.append(len(changes))
        current = apply_changes(current, changes)
    assert batch_sizes == [20, 20, 13]
    assert len(current.grants[0].sources) == 53
    while changes := application.published_viewer_changes(current, group_ids=(), online=False):
        current = apply_changes(current, changes)
    assert not current.grants[0].active


@pytest.mark.parametrize("manual_first", [False, True])
@pytest.mark.parametrize("resource_type", ["workflow", "assistant"])
async def test_actual_grant_and_projection_preserve_overlapping_sources(manual_first, resource_type):
    sources = GrantSourceService()
    manual = sources.canonicalize_source(
        source_id=17, subject_type="user_group", subject_id="9", source_type="USER_GROUP"
    )
    current = replace(context(resource_type), system_authorized=True)
    fga_present = set()
    if manual_first:
        seeded = sources.add_source(current.grants[0], manual)
        current = replace(current, grants=(seeded.grant,))
        visible = VisibilityProjectionCompiler().compile(tenant_id=5, grants=current.grants, existing_sources=())
        fga_present = {delta.key for delta in (*seeded.deltas, *visible.deltas) if delta.action == "WRITE"}

    async def mutate(changes, key):
        nonlocal current, fga_present
        existing = (
            VisibilityProjectionCompiler()
            .compile(tenant_id=5, grants=current.grants, existing_sources=())
            .active_sources
        )
        current = replace(current, existing_visible_sources=existing)
        projection, repository, _, _, fga, _, _ = _service(_plan())
        fga.present = fga_present
        state = FakeGrantState()
        service = GrantService(source_service=sources, projection=projection, state=state)
        result = await service.mutate(
            current,
            changes=changes,
            expected_resource_version=current.target.resource_version,
            expected_catalog_release_id=8,
            idempotency_key=key,
        )
        assert repository.operation.status == "FINALIZED"
        assert len(state.prepared) == len(state.finalized) == 1
        current = replace(
            current,
            grants=result.grants,
            target=current.target.model_copy(update={"resource_version": result.resource_version}),
        )
        fga_present = fga.present
        return fga.calls

    calls = await mutate(application.published_viewer_changes(current, group_ids=(9,), online=True), "publish")
    if manual_first:
        assert calls == []
    else:
        assert calls
        assert await mutate((CanonicalGrantChange(operation="ADD", model_key="viewer", source=manual),), "manual") == []
    before = set(fga_present)
    assert any(key[1] == "visible" for key in before)
    assert await mutate(application.published_viewer_changes(current, group_ids=(), online=False), "unpublish") == []
    assert fga_present == before
    assert current.grants[0].sources == (manual,)


async def test_publisher_without_manage_permission_can_only_mutate_after_action_check():
    current = context()
    runtime = object.__new__(F048PermissionRuntime)
    runtime.check_action = AsyncMock(return_value=False)
    runtime.build_grant_context = AsyncMock(return_value=current)
    runtime._grants = SimpleNamespace(mutate=AsyncMock())
    runtime._state = SimpleNamespace(restore_inactive_sources=AsyncMock(side_effect=lambda **kwargs: kwargs["changes"]))
    actor = PermissionActor(user_id=7, current_tenant_id=5)
    args = {"actor": actor, "target": current.target, "group_ids": (9,), "online": True, "idempotency_key": "publish"}
    with pytest.raises(PermissionDeniedError):
        await runtime.sync_published_viewers(**args)
    runtime._grants.mutate.assert_not_awaited()
    runtime.check_action.return_value = True
    runtime.build_grant_context.return_value = replace(current, system_authorized=True)
    await runtime.sync_published_viewers(**args)
    mutation_context = runtime._grants.mutate.call_args.args[0]
    assert mutation_context.system_authorized
    assert runtime.build_grant_context.call_args.kwargs["system_authorized"] is True
    assert runtime.check_action.call_args.args[-1] == "publish"
    assert runtime._grants.mutate.call_args.kwargs["changes"][0].model_key == "viewer"
    runtime._state.restore_inactive_sources.assert_awaited_once()
    change = runtime._grants.mutate.call_args.kwargs["changes"][0]
    restored = replace(change, source=replace(change.source, version=5))
    runtime._state.restore_inactive_sources = AsyncMock(return_value=(restored,))
    await runtime.sync_published_viewers(**args)
    assert runtime._grants.mutate.call_args.kwargs["changes"] == (restored,)


@pytest.mark.parametrize("super_admin", [False, True])
async def test_default_groups_are_limited_to_resource_tenant(monkeypatch, super_admin):
    actor = PermissionActor(user_id=7, current_tenant_id=5, super_admin=super_admin)
    monkeypatch.setattr(business, "resolve_permission_actor", AsyncMock(return_value=actor))
    groups = [SimpleNamespace(id=9, tenant_id=5), SimpleNamespace(id=10, tenant_id=6)]
    monkeypatch.setattr(business.GroupDao, "aget_all_groups", AsyncMock(return_value=(groups, 2)))
    monkeypatch.setattr(business.GroupDao, "aget_group_by_ids", AsyncMock(return_value=groups))
    monkeypatch.setattr(
        business.UserGroupDao,
        "aget_user_group",
        AsyncMock(
            return_value=[
                SimpleNamespace(group_id=9, tenant_id=5),
                SimpleNamespace(group_id=10, tenant_id=6),
            ]
        ),
    )
    sync = AsyncMock()
    monkeypatch.setattr(business, "sync_published_viewers", sync)
    await business.sync_application_publication(
        SimpleNamespace(user_id=7),
        resource_type="workflow",
        resource_id="app-1",
        tenant_id=5,
        online=True,
    )
    assert sync.call_args.kwargs["group_ids"] == (9,)
    if super_admin:
        business.UserGroupDao.aget_user_group.assert_not_awaited()
    else:
        business.GroupDao.aget_all_groups.assert_not_awaited()


async def test_unpublish_never_looks_up_current_operator_groups(monkeypatch):
    membership = AsyncMock(side_effect=AssertionError("membership must not be read on unpublish"))
    monkeypatch.setattr(business.UserGroupDao, "aget_user_group", membership)
    sync = AsyncMock()
    monkeypatch.setattr(business, "sync_published_viewers", sync)
    await business.sync_application_publication(
        SimpleNamespace(user_id=123),
        resource_type="assistant",
        resource_id="app-1",
        tenant_id=5,
        online=False,
    )
    assert sync.call_args.kwargs["online"] is False
    assert sync.call_args.kwargs["group_ids"] == ()


@pytest.mark.parametrize("online", [False, True])
@pytest.mark.parametrize("group_count,expected_batches", [(1, 1), (53, 3)])
async def test_sync_finishes_without_trailing_permission_queries(monkeypatch, online, group_count, expected_batches):
    current = context()
    group_ids = tuple(range(1, group_count + 1))
    if not online:
        while changes := application.published_viewer_changes(current, group_ids=group_ids, online=True):
            current = apply_changes(current, changes)
    actor = PermissionActor(user_id=7, current_tenant_id=5)
    identity = AsyncMock(side_effect=AssertionError("identity must be reused"))
    monkeypatch.setattr(application, "resolve_permission_actor", identity)
    registry = SimpleNamespace(resolve=AsyncMock(side_effect=lambda **kwargs: current.target))

    async def sync(**kwargs):
        nonlocal current
        changes = application.published_viewer_changes(current, group_ids=group_ids, online=online)
        assert changes
        current = apply_changes(current, changes)
        current = replace(
            current, target=current.target.model_copy(update={"resource_version": current.target.resource_version + 1})
        )
        return SimpleNamespace(grants=current.grants)

    runtime = SimpleNamespace(sync_published_viewers=AsyncMock(side_effect=sync))
    monkeypatch.setattr(application, "get_f048_runtime", AsyncMock(return_value=runtime))
    monkeypatch.setattr(application, "get_f048_resource_registry", AsyncMock(return_value=registry))
    await application.sync_published_viewers(
        SimpleNamespace(user_id=7),
        resource_type="workflow",
        resource_id="app-1",
        group_ids=group_ids,
        online=online,
        actor=actor,
    )
    assert runtime.sync_published_viewers.await_count == expected_batches
    assert registry.resolve.await_count == expected_batches
    identity.assert_not_awaited()


async def test_publication_context_skips_grant_management_capability_checks():
    current = context()
    runtime = object.__new__(F048PermissionRuntime)
    runtime._runtime_catalog = AsyncMock(
        return_value=SimpleNamespace(
            release_id=8,
            store_id="store",
            model_id="model",
            models=tuple(SimpleNamespace(snapshot=model) for model in current.models),
        )
    )
    runtime._require_current_target = AsyncMock(return_value=SimpleNamespace(mode="CUSTOM"))
    runtime._state = SimpleNamespace(
        load_grants=AsyncMock(return_value=current.grants),
        load_visible_sources=AsyncMock(return_value=()),
    )
    runtime._grant_capabilities = AsyncMock(side_effect=AssertionError("publish must not query grant levels"))
    actor = PermissionActor(user_id=7, current_tenant_id=5)
    result = await runtime.build_grant_context(actor=actor, target=current.target, system_authorized=True)
    assert result.system_authorized and result.capabilities == ()
    runtime._grant_capabilities.assert_not_awaited()
