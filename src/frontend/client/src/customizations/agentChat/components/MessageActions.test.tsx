import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ChatMessageType } from '~/@types/chat';
import { copyTrackingApi } from '~/api/apps';
import { copyText } from '~/utils';
import { CUSTOM_CHAT_VISIBILITY } from '../customChatVisibility';
import { MessageBs } from './MessageBs';

jest.mock('~/locales/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('~/hooks/useLocalize', () => ({ __esModule: true, default: () => (key: string) => key }));
jest.mock('~/api/apps', () => ({ copyTrackingApi: jest.fn(), likeChatApi: jest.fn(), disLikeCommentApi: jest.fn() }));
jest.mock('recoil', () => ({ useRecoilValue: () => 'conversation', useSetRecoilState: () => jest.fn() }));
jest.mock('../store/atoms', () => ({ chatIdState: 'chat-id', chatsState: 'chats' }));
jest.mock('~/utils', () => ({
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    copyText: jest.fn(), formatStrTime: () => '10:59',
}));
jest.mock('bisheng-icons', () => ({
    Outlined: { Copy: () => <span data-testid="copy-icon" />, Copied: () => <span data-testid="copied-icon" /> },
}));
jest.mock('~/components/Chat/Messages/Content/Markdown', () => ({
    __esModule: true, default: ({ content }: { content: string }) => <p>{content}</p>,
}));
jest.mock('~/components/Chat/Messages/Content/CitationReferencesDrawer', () => ({
    __esModule: true,
    default: ({ citations }: { citations?: unknown[] | null }) => citations?.length ? <button>References</button> : null,
}));
jest.mock('~/components/Chat/MessageSelection', () => ({
    MessageCheckbox: () => <input type="checkbox" />, ExportSelectionButton: () => <button>Export</button>,
}));
jest.mock('~/components/Voice/TextToSpeechButton', () => ({ TextToSpeechButton: () => <button>Speech</button> }));
jest.mock('~/components/Chat/MessageFeedbackButtons', () => ({ MessageFeedbackButtons: () => <button>Feedback</button> }));
jest.mock('~/hooks/useMessageSelection', () => ({ useMessageSelection: () => ({ isActiveForChat: () => false }) }));
jest.mock('~/components/ui/icon/Loading', () => ({ LoadingIcon: () => null }));
jest.mock('./AppChatFileList', () => ({ AppChatFileList: () => null }));
jest.mock('~/customizations/questionHelper/QuestionMessageContent', () => ({ QuestionMessageContent: () => null }));
jest.mock('~/customizations/htmlCourseware/HtmlCoursewareMessage', () => ({ HtmlCoursewareMessage: () => null }));
jest.mock('~/customizations/lessonPlan/LessonPlanMessage', () => ({ LessonPlanMessage: () => null }));

const message: ChatMessageType = {
    id: 42, message: 'Assistant answer', end: true, isSend: false,
    chatKey: 'conversation', user_name: 'Assistant',
    create_time: '2026-10-08T10:59:00', update_time: '2026-10-08T10:59:00',
};

function renderMessage(data = message, readOnly = false) {
    return render(<MemoryRouter initialEntries={['/custom-app/conversation/app/5']}>
        <Routes><Route path="/custom-app/:conversationId/:fid/:type" element={
            <MessageBs logo={null} title="Assistant" data={data} readOnly={readOnly} />
        } /></Routes>
    </MemoryRouter>);
}

describe('custom chat message visibility', () => {
    const originalVisibility = { ...CUSTOM_CHAT_VISIBILITY };
    beforeEach(() => {
        jest.useFakeTimers();
        Object.assign(CUSTOM_CHAT_VISIBILITY, {
            showMessageCopy: true, showMessageReferences: false, showMessageTimestamp: false,
            showMessageExport: false, showMessageSpeech: false, showMessageFeedback: false,
        });
    });
    afterEach(() => {
        Object.assign(CUSTOM_CHAT_VISIBILITY, originalVisibility);
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('shows only copying when the other switches are disabled and preserves the message content', () => {
        renderMessage();
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'com_ui_copy' })).toBeInTheDocument();
        expect(screen.queryByText('10:59')).not.toBeInTheDocument();
        expect(screen.getByText('Assistant answer')).toBeInTheDocument();
    });

    it('copies the message and preserves tracking and copied feedback', () => {
        renderMessage();
        fireEvent.click(screen.getByRole('button', { name: 'com_ui_copy' }));
        expect(copyText).toHaveBeenCalledWith(expect.any(HTMLDivElement));
        expect(copyTrackingApi).toHaveBeenCalledWith(42);
        expect(screen.getByTestId('copied-icon')).toBeInTheDocument();
        act(() => jest.advanceTimersByTime(2000));
        expect(screen.getByTestId('copy-icon')).toBeInTheDocument();
    });

    it('restores each hidden action through its configuration switch', () => {
        Object.assign(CUSTOM_CHAT_VISIBILITY, {
            showMessageReferences: true, showMessageTimestamp: true, showMessageExport: true,
            showMessageSpeech: true, showMessageFeedback: true,
        });
        renderMessage({ ...message, citations: [{ id: 'reference' }] });
        for (const label of ['References', 'Export', 'Speech', 'Feedback']) {
            expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
        }
        expect(screen.getByText('10:59')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'com_ui_copy' })).toBeInTheDocument();
    });

    it('can hide copying independently', () => {
        CUSTOM_CHAT_VISIBILITY.showMessageCopy = false;
        renderMessage();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('preserves the original footer layout when toggling references without citation data', () => {
        const { unmount } = renderMessage();
        const footer = screen.getByRole('button', { name: 'com_ui_copy' }).parentElement?.parentElement;
        expect(footer).toHaveClass('flex', 'justify-between');
        const originalClassName = footer?.className;
        unmount();

        CUSTOM_CHAT_VISIBILITY.showMessageReferences = true;
        renderMessage();
        expect(screen.queryByRole('button', { name: 'References' })).not.toBeInTheDocument();
        const enabledFooter = screen.getByRole('button', { name: 'com_ui_copy' }).parentElement?.parentElement;
        expect(enabledFooter?.className).toBe(originalClassName);
    });

    it('does not show copy actions for unfinished or read-only messages', () => {
        const { unmount } = renderMessage({ ...message, end: false });
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        unmount();
        renderMessage(message, true);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
