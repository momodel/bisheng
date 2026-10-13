"""Shared application publication policy for assistant and workflow services."""

import asyncio
from functools import wraps
from inspect import signature

from bisheng.core.cache.redis_manager import get_redis_client
from bisheng.database.models.group import GroupDao
from bisheng.database.models.user_group import UserGroupDao
from bisheng.permission.application.identity import resolve_permission_actor
from bisheng.permission.application.published_viewers import sync_published_viewers


def serialized_publication(resource_type: str, id_parameter: str):
    """Serialize opposite transitions across API replicas, with a bounded lease."""

    def decorate(method):
        method_signature = signature(method)

        @wraps(method)
        async def wrapped(*args, **kwargs):
            values = method_signature.bind(*args, **kwargs).arguments
            resource_id = values[id_parameter]
            redis = await get_redis_client()
            async with redis.async_connection.lock(
                f"application-publication:{resource_type}:{resource_id}",
                timeout=600,
                blocking_timeout=10,
            ):
                # Stop work before the lease expires, including agent initialization.
                async with asyncio.timeout(540):
                    return await method(*args, **kwargs)

        return wrapped

    return decorate


async def sync_application_publication(
    login_user, *, resource_type: str, resource_id: str, tenant_id: int, online: bool
):
    group_ids: set[int] = set()
    actor = None
    if online:
        actor = await resolve_permission_actor(login_user)
        if actor.super_admin:
            page = 1
            while True:
                groups, total = await GroupDao.aget_all_groups(page=page, limit=200)
                group_ids.update(int(group.id) for group in groups if group.tenant_id == tenant_id)
                if page * 200 >= total:
                    break
                page += 1
        else:
            memberships = await UserGroupDao.aget_user_group(login_user.user_id)
            ids = [row.group_id for row in memberships if row.tenant_id == tenant_id]
            groups = await GroupDao.aget_group_by_ids(ids) if ids else ()
            group_ids.update(int(group.id) for group in groups if group.tenant_id == tenant_id)
    await sync_published_viewers(
        login_user,
        resource_type=resource_type,
        resource_id=str(resource_id),
        group_ids=tuple(group_ids),
        online=online,
        actor=actor,
    )
