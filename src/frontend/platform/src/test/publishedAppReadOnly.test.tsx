import { WorkflowHeader } from "@/pages/BuildPage/flow/Header";
import { FlowPage } from "@/pages/BuildPage/flow";
import { AssistantPrompt } from "@/pages/BuildPage/assistant/editAssistant/Prompt";
import useFlowStore from "@/pages/BuildPage/flow/flowStore";
import { getVersionDetails, getWorkFlowVersions, saveWorkflow, updateVersion, createWorkFlowVersion, onlineWorkflowApi } from "@/controllers/API/workflow";
import { getFlowApi } from "@/controllers/API/flow";
import type { WorkFlow } from "@/types/flow";
import { fireEvent, render, screen, waitFor } from "@/test/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

const permission = vi.hoisted(() => ({ actions: ['visible', 'use'] }));
const blocker = vi.hoisted(() => vi.fn(() => ({ state: 'unblocked' })));
const editor = vi.hoisted(() => vi.fn());
const dispatchAssistant = vi.hoisted(() => vi.fn());
vi.mock('@/store/assistantStore', () => ({ useAssistantStore: () => ({
    assistantState: { prompt: 'Original instructions' }, dispatchAssistant,
}) }));
vi.mock('@/pages/BuildPage/assistant/editAssistant/AutoPromptDialog', () => ({ default: () => null }));
vi.mock('react-router-dom', async importOriginal => ({
    ...await importOriginal<typeof import('react-router-dom')>(),
    unstable_useBlocker: blocker,
    useParams: () => ({ id: 'app-1' }),
}));
vi.mock('@/components/bs-comp/permission/useResourceActions', () => ({
    useResourceActions: () => ({ actions: permission.actions, loading: false }),
    hasResourceAction: (actions: string[], _id: string, action: string) => actions.includes(action),
}));
vi.mock('@/controllers/API/workflow', () => ({
    getWorkFlowVersions: vi.fn(), getVersionDetails: vi.fn(), updateVersion: vi.fn(),
    saveWorkflow: vi.fn(), createWorkFlowVersion: vi.fn(), onlineWorkflowApi: vi.fn(),
    copyReportTemplate: vi.fn(), onlineWorkflow: vi.fn(), deleteVersion: vi.fn(),
}));
vi.mock('@/controllers/API/flow', () => ({ getFlowApi: vi.fn() }));
vi.mock('@/controllers/request', () => ({ captureAndAlertRequestErrorHoc: <T,>(promise: Promise<T>) => promise }));
vi.mock('@/contexts/tabsContext', async () => {
    const { createContext } = await import('react');
    return { TabsContext: createContext({ version: { id: 1, name: 'v1' }, setVersion: vi.fn() }) };
});
vi.mock('@/components/bs-comp/cardComponent/avatar', () => ({ default: () => null }));
vi.mock('@/components/bs-comp/permission/PermissionDialog', () => ({ PermissionDialog: () => null }));
vi.mock('@/pages/BuildPage/CreateApp', async () => ({ default: (await import('react')).forwardRef(() => null) }));
vi.mock('@/pages/BuildPage/flow/FlowChat/ChatTest', async () => ({ ChatTest: (await import('react')).forwardRef(() => null) }));
vi.mock('@/components/bs-icons', () => ({ DelIcon: () => null, LoadIcon: () => null }));
vi.mock('@/pages/BuildPage/flow/Notification', () => ({ default: () => null }));
vi.mock('@/pages/BuildPage/flow/useNodeEvent', () => ({ useNodeEvent: () => async () => [] }));
vi.mock('@/pages/BuildPage/flow/Panne', () => ({ default: (props: { flow: WorkFlow }) => {
    editor(props);
    return <div data-testid="original-workflow-editor">{props.flow.nodes[0]?.data.name as string}</div>;
} }));
vi.mock('@/util/flowCompatible', () => ({ flowVersionCompatible: (flow: WorkFlow) => flow }));
vi.mock('@/util/flowUtils', () => ({ importFlow: vi.fn() }));

const flow: WorkFlow & { status: number } = {
    id: 'app-1', name: 'Review app', description: '', status: 1,
    nodes: [{ id: 'node-1', position: { x: 0, y: 0 }, data: { name: 'Original node' } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 },
};

function renderHeader() {
    return render(<WorkflowHeader flow={flow} nodes={flow.nodes} preFlow={JSON.stringify({ ...flow, nodes: [] })}
        onTabChange={vi.fn()} onPreFlowChange={vi.fn()} onImportFlow={vi.fn()} />);
}

describe('viewer access in the original application editor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        permission.actions = ['visible', 'use'];
        useFlowStore.getState().setFlow(flow);
        delete (window as Window & { flow_version?: number }).flow_version;
        vi.mocked(getWorkFlowVersions).mockResolvedValue({
            data: [
                { id: 1, name: 'v1', is_current: 1, update_time: '2026-10-13T10:00:00' },
                { id: 2, name: 'v2', is_current: 0, update_time: '2026-10-13T10:00:00' },
            ], total: 2,
        });
        vi.mocked(getVersionDetails).mockResolvedValue({ data: flow } as Awaited<ReturnType<typeof getVersionDetails>>);
        vi.mocked(saveWorkflow).mockResolvedValue({} as Awaited<ReturnType<typeof saveWorkflow>>);
        vi.mocked(updateVersion).mockResolvedValue({} as Awaited<ReturnType<typeof updateVersion>>);
        vi.mocked(getFlowApi).mockResolvedValue({ ...flow, write: false, guide_word: '', data: { nodes: flow.nodes, edges: [], viewport: flow.viewport } });
    });

    it('mounts the original editor for viewers', async () => {
        render(<FlowPage />);
        expect(await screen.findByTestId('original-workflow-editor')).toHaveTextContent('Original node');
        expect(editor).toHaveBeenCalled();
    });

    it('keeps the original assistant prompt available for selecting, copying and local changes', () => {
        render(<AssistantPrompt canEdit={false} />);
        const input = screen.getByRole('textbox');
        expect(input).toBeEnabled();
        expect(input).toHaveValue('Original instructions');
        fireEvent.input(input, { target: { value: 'Local changes' } });
        expect(dispatchAssistant).toHaveBeenCalledWith('setPrompt', { prompt: 'Local changes' });
        expect(saveWorkflow).not.toHaveBeenCalled();
    });

    it('blocks persistence but keeps version browsing, run and export available', async () => {
        const user = userEvent.setup();
        renderHeader();
        await waitFor(() => expect(getWorkFlowVersions).toHaveBeenCalled());
        expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'skills.saveVersion' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'run' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'goOnline' })).toBeNull();
        expect(blocker).toHaveBeenLastCalledWith(false);
        await user.click(screen.getByRole('button', { name: 'more' }));
        expect(await screen.findByText('exportWorkflow')).toBeInTheDocument();
        await user.keyboard('{Escape}');
        const versionButton = screen.getByRole('button', { name: 'skills.saveVersion' });
        const dropdown = versionButton.parentElement?.parentElement?.querySelector('button[aria-haspopup="dialog"]');
        expect(dropdown).not.toBeNull();
        await user.click(dropdown!);
        await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
        expect(screen.queryByRole('textbox')).toBeNull();
        await user.click(screen.getAllByRole('radio')[1]);
        await waitFor(() => expect(getVersionDetails).toHaveBeenCalledWith('2'));
        expect(updateVersion).not.toHaveBeenCalled();
        expect(saveWorkflow).not.toHaveBeenCalled();
        expect(createWorkFlowVersion).not.toHaveBeenCalled();
        expect(onlineWorkflowApi).not.toHaveBeenCalled();
    });

    it('retains saving and version autosave for editors', async () => {
        const user = userEvent.setup();
        permission.actions = ['visible', 'use', 'edit', 'publish'];
        renderHeader();
        await waitFor(() => expect(getWorkFlowVersions).toHaveBeenCalled());
        expect(screen.getByRole('button', { name: 'save' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'goOnline' })).toBeEnabled();
        const versionButton = screen.getByRole('button', { name: 'skills.saveVersion' });
        const dropdown = versionButton.parentElement?.parentElement?.querySelector('button[aria-haspopup="dialog"]');
        await user.click(dropdown!);
        await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
        await user.click(screen.getAllByRole('radio')[1]);
        await waitFor(() => expect(updateVersion).toHaveBeenCalledWith(1, expect.any(Object)));
        expect(blocker).toHaveBeenLastCalledWith(true);
    });

    it('stops publishing when saving fails', async () => {
        permission.actions = ['visible', 'use', 'edit', 'publish'];
        vi.mocked(saveWorkflow).mockResolvedValue(false);
        renderHeader();
        fireEvent.click(await screen.findByRole('button', { name: 'goOnline' }));
        await waitFor(() => expect(saveWorkflow).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByRole('button', { name: 'goOnline' })).toBeEnabled());
        expect(onlineWorkflowApi).not.toHaveBeenCalled();
    });

    it('keeps publishing disabled while a transition is in flight', async () => {
        permission.actions = ['visible', 'use', 'edit', 'publish'];
        let finish!: () => void;
        vi.mocked(onlineWorkflowApi).mockImplementation(() => new Promise(resolve => {
            finish = () => resolve({} as Awaited<ReturnType<typeof onlineWorkflowApi>>);
        }));
        renderHeader();
        const control = await screen.findByRole('button', { name: 'goOnline' });
        fireEvent.click(control);
        await waitFor(() => expect(onlineWorkflowApi).toHaveBeenCalledTimes(1));
        expect(control).toBeDisabled();
        fireEvent.click(control);
        expect(onlineWorkflowApi).toHaveBeenCalledTimes(1);
        finish();
        await waitFor(() => expect(control).toBeEnabled());
    });
});
