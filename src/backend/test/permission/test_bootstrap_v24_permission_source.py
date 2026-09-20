from __future__ import annotations

import pytest

from scripts.bootstrap_v24_permission_source import (
    LegacyV24TuplePlanner,
    TupleAccumulator,
    resolve_knowledge_parent,
)


def test_tuple_accumulator_keeps_highest_priority_relation() -> None:
    accumulator = TupleAccumulator()

    accumulator.add("user:7", "viewer", "assistant:9")
    accumulator.add("user:7", "owner", "assistant:9")
    accumulator.add("user:7", "editor", "assistant:9")

    assert [item.relation for item in accumulator.tuples()] == ["owner"]
    assert accumulator.candidate_count == 3


@pytest.mark.parametrize(
    ("knowledge_id", "knowledge_type", "level_path", "expected"),
    [
        (11, 1, None, ("knowledge_library", "11")),
        (12, 3, "", ("knowledge_space", "12")),
        (13, 1, "/4/8/", ("folder", "8")),
        (14, 1, "/not-a-folder/", None),
    ],
)
def test_resolve_knowledge_parent(
    knowledge_id: int,
    knowledge_type: int,
    level_path: str | None,
    expected: tuple[str, str] | None,
) -> None:
    assert resolve_knowledge_parent(knowledge_id, knowledge_type, level_path) == expected


class _SessionThatMustNotExecute:
    async def execute(self, _statement):
        raise AssertionError("missing optional table must not be queried")


async def test_optional_missing_table_is_skipped() -> None:
    planner = LegacyV24TuplePlanner(_SessionThatMustNotExecute(), table_names=set())

    assert await planner._rows("SELECT * FROM optional", optional_table="optional") == []


class _BrokenSession:
    async def execute(self, _statement):
        raise RuntimeError("query failed")


async def test_existing_table_query_failure_is_not_swallowed() -> None:
    planner = LegacyV24TuplePlanner(_BrokenSession(), table_names={"optional"})

    with pytest.raises(RuntimeError, match="query failed"):
        await planner._rows("SELECT * FROM optional", optional_table="optional")
