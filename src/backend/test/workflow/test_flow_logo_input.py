import pytest

from bisheng.database.models.flow import Flow, FlowCreate, FlowRead, FlowUpdate

ICON_PATH = "/icon/c9946cecf36548deb313e17a43194a2e.png"
SIGNED_LOGO = (
    f"{ICON_PATH}?X-Amz-Algorithm=AWS4-HMAC-SHA256"
    "&X-Amz-Credential=test%2F20261008%2Fus-east-1%2Fs3%2Faws4_request"
    "&X-Amz-Date=20261008T020546Z&X-Amz-Expires=604800"
    f"&X-Amz-SignedHeaders=host&X-Amz-Signature={'a' * 64}"
)


def test_copy_workflow_persists_icon_path_from_signed_detail() -> None:
    source = FlowRead(
        id="source-workflow",
        name="Problem solver",
        description="Solve problems step by step",
        logo=SIGNED_LOGO,
        data={"nodes": [{"id": "start"}], "edges": []},
    )
    payload = source.model_dump(exclude={"id"})
    payload["name"] += "-copy"

    copied_flow = Flow.model_validate(FlowCreate.model_validate(payload))

    assert len(SIGNED_LOGO) > 255
    assert source.logo == SIGNED_LOGO
    assert copied_flow.logo == ICON_PATH
    assert copied_flow.name == "Problem solver-copy"
    assert copied_flow.data == source.data
    assert copied_flow.description == source.description


@pytest.mark.parametrize("schema", [FlowCreate, FlowUpdate])
@pytest.mark.parametrize("logo", [None, "", "icon/default.png", ICON_PATH, "icon/space%20name.png"])
def test_logo_input_preserves_existing_icon_paths(schema, logo) -> None:
    value = schema(name="Workflow", logo=logo)

    assert value.logo == logo


def test_update_workflow_strips_temporary_signature() -> None:
    update = FlowUpdate(logo=SIGNED_LOGO)

    assert update.model_dump(exclude_unset=True) == {"logo": ICON_PATH}


def test_update_without_logo_does_not_overwrite_icon() -> None:
    update = FlowUpdate(name="Renamed workflow")

    assert update.model_dump(exclude_unset=True) == {"name": "Renamed workflow"}
