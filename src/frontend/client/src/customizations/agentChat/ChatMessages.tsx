/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/ChatMessages.tsx. Edit this copy for custom chat.
import { useMemo } from "react";
import { useRecoilValue } from "recoil";
import type { CitationReferencesDesktopPayload } from "~/components/Chat/Messages/Content/CitationReferencesDrawer";
import { SelectionMessagesProvider, SelectAllBelowBanner } from "~/components/Chat/MessageSelection";
import type { SelectableMessage } from "~/hooks/useMessageSelection";
import { useLocalize } from "~/hooks";
import { GuideWord } from "~/customizations/agentChat/components/GuideWord";
import { InputForm } from "~/customizations/agentChat/components/InputForm";
import { InputFormSkill } from "~/customizations/agentChat/components/InputFormSkill";
import { MessageBs, ReasoningLog } from "~/customizations/agentChat/components/MessageBs";
import { MessageBsChoose } from "~/customizations/agentChat/components/MessageBsChoose";
import { MessageFile } from "~/customizations/agentChat/components/MessageFile";
import { MessageNodeRun } from "~/customizations/agentChat/components/MessageNodeRun";
import { MessageRemark } from "~/customizations/agentChat/components/MessageRemark";
import { MessageRunlog } from "~/customizations/agentChat/components/MessageRunlog";
import { MessageSystem } from "~/customizations/agentChat/components/MessageSystem";
import { MessageUser } from "~/customizations/agentChat/components/MessageUser";
import { currentChatState, currentRunningState } from "~/customizations/agentChat/store/atoms";
import { useMessage } from "~/customizations/agentChat/useMessages";
const _SELECTABLE_CATEGORIES = new Set([
    "question",
    "answer",
    "agent_answer",
    "output_msg",
    "stream_msg",
]);
type ChatMessagesProps = {
    useName?: string;
    readOnly: any;
    title: string;
    logo: React.ReactNode;
    disabledSearch?: boolean;
    isGuestMode?: boolean;
    onOpenCitationPanel?: (payload: CitationReferencesDesktopPayload) => void;
    activeCitationMessageId?: string | null;
    selectionActive?: boolean;
};
export function ChatMessages({ useName, readOnly, title, logo, disabledSearch = false, isGuestMode = false, onOpenCitationPanel, activeCitationMessageId = null, selectionActive = false, }: ChatMessagesProps) {
    const { messageScrollRef, messages } = useMessage(readOnly);
    const { inputForm, guideWord, inputDisabled } = useRecoilValue(currentRunningState) ?? { inputForm: null, guideWord: [], inputDisabled: true };
    const chatState = useRecoilValue(currentChatState);
    const localize = useLocalize();
    const selectableMessages = useMemo<SelectableMessage[]>(() => {
        return (messages ?? [])
            .filter((m: any) => m?.id != null && _SELECTABLE_CATEGORIES.has(m?.category))
            .map((m: any) => ({
            messageId: String(m.id),
            parentMessageId: "",
            isCreatedByUser: m.category === "question",
        }));
    }, [messages]);
    console.log("messages :>> ", chatState, messages, guideWord);
    const remark = chatState?.flow?.guide_word;
    if (!chatState) return null;
    return <div id="customChatMessageScrollPane" ref={messageScrollRef} className="h-full overflow-y-auto scrollbar-hide pt-2 pb-44 px-4">
        <SelectionMessagesProvider messages={selectableMessages}>
        {selectionActive && messages.length > 0 && (<SelectAllBelowBanner scrollRef={messageScrollRef}/>)}
        {remark && <MessageRemark readOnly={readOnly} logo={logo} title={title} message={remark}/>}

        {messages.map((msg) => {
            if (msg.files?.length && msg.category !== 'question') {
                return <MessageFile key={msg.id} title={title} data={msg} logo={logo}/>;
            }
            else if (['tool', 'flow', 'knowledge'].includes(msg.category)) {
                return <MessageRunlog key={msg.id || msg.extra} data={msg}/>;
            }
            else if (msg.thought) {
                return <MessageSystem logo={logo} title={title} key={msg.id} data={msg}/>;
            }
            switch (msg.category) {
                case 'input':
                    return null;
                case 'question':
                    return <MessageUser readOnly={readOnly} key={msg.id} useName={msg.user_name || useName} data={msg} disabledSearch={disabledSearch} showButton={!inputDisabled && chatState?.flow.flow_type !== 10}/>;
                case 'guide_word':
                    return <MessageRemark key={msg.id} logo={logo} title={title} message={msg.message.guide_word}/>;
                case 'output_msg':
                case 'stream_msg':
                case 'answer':
                    return <MessageBs readOnly={readOnly} key={msg.id} data={msg} logo={logo} title={title} isGuestMode={isGuestMode} onOpenCitationPanel={onOpenCitationPanel} activeCitationMessageId={activeCitationMessageId}/>;
                case 'divider':
                    return <div key={msg.id} className="flex items-center justify-center py-4 text-gray-400 text-sm">
                            ----------- {localize(msg.message)} -----------
                        </div>;
                case 'output_with_choose_msg':
                    return <MessageBsChoose key={msg.id} data={msg} logo={logo} disabled={readOnly} flow={chatState.flow}/>;
                case 'output_with_input_msg':
                    return <MessageBsChoose type='input' key={msg.id} data={msg} logo={logo} disabled={readOnly} flow={chatState.flow}/>;
                case 'node_run':
                    return <MessageNodeRun key={msg.id} data={msg}/>;
                case 'system':
                    return <MessageSystem logo={logo} title={title} key={msg.id} data={msg}/>;
                case 'reasoning':
                case 'reasoning_answer':
                    return <ReasoningLog key={msg.id} loading={false} msg={msg.message}/>;
                default:
                    return <div className="text-sm mt-2 border rounded-md p-2" key={msg.id}>Unknown message type</div>;
            }
        })}

        {!remark
            && !messages.some(msg => msg.category === 'guide_word')
            && !!guideWord?.length
            && <MessageRemark logo={logo} title={title} message={''}/>}
        {guideWord && !inputDisabled && !inputForm && !readOnly && <GuideWord data={guideWord}/>}
        {inputForm && (chatState?.flow.flow_type === 10 ?
            <InputForm data={inputForm} flow={chatState.flow} logo={logo}/> :
            <InputFormSkill flow={chatState.flow} logo={logo}/>)}

        </SelectionMessagesProvider>
    </div>;
}
;
