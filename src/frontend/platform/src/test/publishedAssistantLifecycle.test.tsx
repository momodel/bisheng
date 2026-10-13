import { EditAssistantPage } from '@/pages/BuildPage/assistant/editAssistant';
import { changeAssistantStatusApi, getAssistantDetailApi, saveAssistanttApi } from '@/controllers/API/assistant';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(), saveAfter: vi.fn(), setAssistantDetail: vi.fn(), changeStatus: vi.fn(), destroy: vi.fn(),
    startNewRound: vi.fn(), insetSystemMsg: vi.fn(), insetBsMsg: vi.fn(), destory: vi.fn(), setShowGuideQuestion: vi.fn(),
}));
const assistant = {
    id: 'app-1', prompt: '', name: 'App', status: 1, max_token: 1024, model_name: 'model',
    flow_list: [], tool_list: [], knowledge_list: [], guide_question: [], guide_word: '', logo: '',
};
vi.mock('@/store/assistantStore', () => ({
    useAssistantStore: () => ({ assistantState: assistant, changed: false, ...mocks }),
}));
vi.mock('@/components/bs-comp/chatComponent/messageStore', () => ({ useMessageStore: () => mocks }));
vi.mock('react-router-dom', async importOriginal => ({
    ...await importOriginal<typeof import('react-router-dom')>(),
    useParams: () => ({ id: 'app-1' }), useNavigate: () => mocks.navigate,
    unstable_useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/components/bs-comp/permission/useResourceActions', () => ({
    useResourceActions: () => ({ actions: ['edit', 'publish', 'unpublish'], loading: false }),
    hasResourceAction: (actions: string[], _id: string, action: string) => actions.includes(action),
}));
vi.mock('@/controllers/API/assistant', () => ({
    getAssistantDetailApi: vi.fn(), saveAssistanttApi: vi.fn(), changeAssistantStatusApi: vi.fn(),
}));
vi.mock('@/controllers/request', () => ({ captureAndAlertRequestErrorHoc: <T,>(promise: Promise<T>) => promise }));
vi.mock('@/components/bs-comp/apiComponent', () => ({ default: () => null }));
vi.mock('@/pages/BuildPage/assistant/editAssistant/Setting', () => ({ default: () => null }));
vi.mock('@/pages/BuildPage/assistant/editAssistant/TestChat', () => ({ default: () => null }));
vi.mock('@/pages/BuildPage/assistant/editAssistant/Prompt', () => ({ AssistantPrompt: () => null }));
vi.mock('@/pages/BuildPage/assistant/editAssistant/Header', () => ({
    default: ({ onLine }: { onLine: (online: boolean) => Promise<void> }) => <>
        <button onClick={() => onLine(true)}>Publish</button>
        <button onClick={() => onLine(false)}>Unpublish</button>
    </>,
}));

describe('assistant publication result handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getAssistantDetailApi).mockResolvedValue(assistant as unknown as Awaited<ReturnType<typeof getAssistantDetailApi>>);
        vi.mocked(saveAssistanttApi).mockResolvedValue(assistant as Awaited<ReturnType<typeof saveAssistanttApi>>);
    });

    it('stops publishing after a failed save without marking edits saved', async () => {
        vi.mocked(saveAssistanttApi).mockResolvedValue(undefined as Awaited<ReturnType<typeof saveAssistanttApi>>);
        render(<EditAssistantPage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
        await waitFor(() => expect(saveAssistanttApi).toHaveBeenCalledTimes(1));
        expect(changeAssistantStatusApi).not.toHaveBeenCalled();
        expect(mocks.saveAfter).not.toHaveBeenCalled();
        expect(mocks.navigate).not.toHaveBeenCalled();
    });

    it('keeps the app open when the publication request fails', async () => {
        // The interceptor unwraps data, while this legacy API is typed as AxiosResponse.
        vi.mocked(changeAssistantStatusApi).mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof changeAssistantStatusApi>>);
        render(<EditAssistantPage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
        await waitFor(() => expect(changeAssistantStatusApi).toHaveBeenCalledWith('app-1', 2));
        expect(mocks.navigate).not.toHaveBeenCalled();
        expect(mocks.changeStatus).not.toHaveBeenCalled();
    });

    it('navigates immediately after a confirmed successful publication', async () => {
        vi.mocked(changeAssistantStatusApi).mockResolvedValue(null as unknown as Awaited<ReturnType<typeof changeAssistantStatusApi>>);
        render(<EditAssistantPage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
        await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/build'));
        expect(mocks.changeStatus).toHaveBeenCalledWith(2);
        expect(mocks.saveAfter).toHaveBeenCalledTimes(1);
    });
});
