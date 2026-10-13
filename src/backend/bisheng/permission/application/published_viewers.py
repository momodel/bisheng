"""Business-triggered, source-specific viewer grants for published applications."""

from __future__ import annotations

from dataclasses import replace
from hashlib import sha256

from bisheng.common.errcode.permission import PermissionInvalidResourceError
from bisheng.permission.application.access import get_f048_resource_registry, get_f048_runtime
from bisheng.permission.application.identity import resolve_permission_actor
from bisheng.permission.application.sql_runtime import stable_assignee_id
from bisheng.permission.domain.schemas import VerifiedPermissionTarget
from bisheng.permission.domain.services.grant_service import CanonicalGrantChange, GrantMutationContext
from bisheng.permission.domain.services.grant_source_service import GrantSnapshot, GrantSourceService
from bisheng.permission.domain.services.permission_action_service import PermissionActor


def publication_synced(
    *, target: VerifiedPermissionTarget, grants: tuple[GrantSnapshot, ...], group_ids: tuple[int, ...], online: bool
) -> bool:
    """Use the finalized after-state instead of issuing a trailing no-op request."""
    prefix = f"app_publish:{target.resource_type}:{target.resource_id}:group:"
    active_refs = {
        source.source_ref
        for grant in grants
        for source in grant.sources
        if source.active and source.source_type == "OTHER" and source.source_ref.startswith(prefix)
    }
    return all(f"{prefix}{group_id}" in active_refs for group_id in group_ids) if online else not active_refs


def published_viewer_changes(
    context: GrantMutationContext,
    *,
    group_ids: tuple[int, ...],
    online: bool,
) -> tuple[CanonicalGrantChange, ...]:
    """Bound each projection below the atomic tuple limit; preserve other sources."""
    target = context.target
    prefix = f"app_publish:{target.resource_type}:{target.resource_id}:group:"
    existing = tuple(
        source
        for grant in context.grants
        for source in grant.sources
        if source.active and source.source_type == "OTHER" and source.source_ref.startswith(prefix)
    )
    if not online:
        return tuple(
            CanonicalGrantChange(
                operation="REMOVE",
                assignee_id=source.source_id,
                expected_assignee_version=source.version,
            )
            for source in existing[:20]
        )

    viewer = next((grant for grant in context.grants if grant.model.model_key == "viewer"), None)
    if viewer is None:
        raise PermissionInvalidResourceError()
    fingerprints = {source.source_fingerprint for source in existing}
    sources = GrantSourceService()
    changes = []
    for group_id in sorted(set(group_ids)):
        if group_id <= 0:
            raise PermissionInvalidResourceError()
        source = sources.canonicalize_source(
            source_id=1,
            subject_type="user_group",
            subject_id=str(group_id),
            userset_relation="member",
            source_type="OTHER",
            source_ref=f"{prefix}{group_id}",
        )
        if source.source_fingerprint in fingerprints:
            continue
        source = replace(
            source,
            source_id=stable_assignee_id(grant_key=viewer.grant_id, source_fingerprint=source.source_fingerprint),
        )
        changes.append(CanonicalGrantChange(operation="ADD", model_key="viewer", source=source))
        if len(changes) == 20:
            break
    return tuple(changes)


async def sync_published_viewers(
    login_user,
    *,
    resource_type: str,
    resource_id: str,
    group_ids=(),
    online: bool,
    actor: PermissionActor | None = None,
) -> None:
    """Re-resolve versions between durable batches; publishing permission is sufficient."""
    if resource_type not in {"workflow", "assistant"}:
        raise PermissionInvalidResourceError()
    actor = actor or await resolve_permission_actor(login_user)
    registry = await get_f048_resource_registry()
    runtime = await get_f048_runtime()
    action = "publish" if online else "unpublish"
    group_ids = tuple(sorted(set(group_ids)))
    desired = sha256(repr((online, group_ids)).encode()).hexdigest()[:16]
    while True:
        target = await registry.resolve(
            resource_type=resource_type,
            resource_id=str(resource_id),
            actor=actor,
            action=action,
        )
        operation_key = sha256(
            f"{target.tenant_id}|{resource_type}|{resource_id}|{target.resource_version}|{desired}".encode()
        ).hexdigest()[:48]
        result = await runtime.sync_published_viewers(
            actor=actor,
            target=target,
            group_ids=group_ids,
            online=online,
            idempotency_key=f"app-publish:{operation_key}",
        )
        if result is None or publication_synced(
            target=target, grants=result.grants, group_ids=group_ids, online=online
        ):
            return
