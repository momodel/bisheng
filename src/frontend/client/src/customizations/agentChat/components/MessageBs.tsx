// Frontend fork of pages/appChat/components/MessageBs.tsx. Edit this copy for custom chat.
import i18n from "~/locales/i18n";
import { CheckIcon, ChevronDown, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ChatMessageType } from "~/@types/chat";
import Markdown from "~/components/Chat/Messages/Content/Markdown";
import CitationReferencesDrawer, { type CitationReferencesDesktopPayload } from "~/components/Chat/Messages/Content/CitationReferencesDrawer";
import { ExportSelectionButton, MessageCheckbox, } from "~/components/Chat/MessageSelection";
import { LoadingIcon } from "~/components/ui/icon/Loading";
import { useMessageSelection } from "~/hooks/useMessageSelection";
import { cn, copyText, formatStrTime } from "~/utils";
import { AppChatFileList } from "~/customizations/agentChat/components/AppChatFileList";
import { MessageButtons } from "~/customizations/agentChat/components/MessageButtons";
import useLocalize from "~/hooks/useLocalize";
import { QuestionMessageContent } from '~/customizations/questionHelper/QuestionMessageContent';
import { CUSTOM_APP_IDS } from '~/customizations/config';
import { HtmlCoursewareMessage } from '~/customizations/htmlCourseware/HtmlCoursewareMessage';
import { LessonPlanMessage } from '~/customizations/lessonPlan/LessonPlanMessage';
export const ReasoningLog = ({ loading, msg = '' }) => {
    const t = useLocalize();
    const [open, setOpen] = useState(true);
    if (!msg)
        return null;
    return <div className="py-1 mb-4">
        <div className="rounded-sm border">
            <div className="flex justify-between items-center px-4 py-2 cursor-pointer" onClick={() => setOpen(!open)}>
                {loading ? <div className="flex items-center font-bold gap-2 text-sm">
                    <Loader2 className="text-primary duration-300 animate-spin"/>
                    <span>{t('com_bs_reasoning_thinking')}</span>
                </div>
            : <div className="flex items-center font-bold gap-2 text-sm">
                        <div className="w-5 h-5 bg-[#05B353] rounded-full p-1">
                            <CheckIcon size={14} className='text-white'/>
                        </div>
                        <span>{t('com_bs_reasoning_done')}</span>
                    </div>}
                <ChevronDown className={open ? 'rotate-180' : undefined}/>
            </div>
            <div className={cn('bg-[#F5F6F8] dark:bg-[#313336] px-4 py-2 overflow-hidden text-sm ', open ? 'h-auto' : 'h-0 p-0')}>
                {msg.split('\n').map((line, index) => (<p className="text-md mb-1 text-muted-foreground" key={index}>{line}</p>))}
            </div>
        </div>
    </div>;
};
type MessageBsProps = {
    logo: React.ReactNode;
    title: string;
    data: ChatMessageType;
    isGuestMode?: boolean;
    readOnly?: any;
    onOpenCitationPanel?: (payload: CitationReferencesDesktopPayload) => void;
    activeCitationMessageId?: string | null;
};
export function MessageBs({ logo, title, data, readOnly, isGuestMode = false, onOpenCitationPanel, activeCitationMessageId, }: MessageBsProps) {
    const t = useLocalize();
    const [message, reasoningLog] = useMemo(() => {
        const msg = typeof data.message === 'string' ? data.message : (data.message as { msg?: string })?.msg;
        if (!msg) {
            return ['', ''];
        }
        const regex = /<think>(.*?)<\/think>/s;
        const match = msg.match(regex);
        if (match) {
            const outsideContent = msg.replace(regex, '');
            const insideContent = match[1];
            return [outsideContent, insideContent];
        }
        return [msg, ''];
    }, [data.message]);
    const referenceWebContent = useMemo(() => {
        const webMatch = message.match(/:::web([\s\S]*?):::/);
        if (!webMatch)
            return [];
        try {
            const str = webMatch[1].trim();
            return str ? JSON.parse(str) : [];
        }
        catch {
            return [];
        }
    }, [message]);
    const referenceContent = useMemo(() => {
        return message.replace(/:::web[\s\S]*?:::/, '').trim();
    }, [message]);
    const messageRef = useRef<HTMLDivElement>(null);
    const handleCopyMessage = () => {
        messageRef.current && copyText(messageRef.current);
    };
    const { conversationId: chatIdFromUrl, fid } = useParams();
    const fullWidthContent = fid === CUSTOM_APP_IDS.htmlCourseware || fid === CUSTOM_APP_IDS.lessonPlan;
    const chatId = chatIdFromUrl || "";
    const messageId = String(data.id ?? "");
    const { isActiveForChat } = useMessageSelection();
    const showCheckbox = !!chatId && isActiveForChat(chatId);
    return <div className="bisheng-message flex w-full py-2 items-start gap-2">
        {showCheckbox && messageId && (<MessageCheckbox chatId={chatId} messageId={messageId} className="mt-2 ml-2 shrink-0"/>)}
        <div className={cn("w-fit group max-w-[90%]", fullWidthContent && "w-full")}>
            <ReasoningLog loading={!data.end && (data.reasoning_log || reasoningLog)} msg={data.reasoning_log || reasoningLog}/>
            {!(data.reasoning_log && !message && !(data.files?.length ?? 0)) && <>
                <div className="flex gap-2 items-center">
                    {data.sender ? <p className="text-gray-600 text-xs mb-1 ml-2">{data.sender}</p> : <p />}
                    
                </div>
                <div className="min-h-8 px-4 rounded-2xl">
                    <div className="flex gap-3">
                        {logo}
                        <div className={fullWidthContent ? 'min-w-0 flex-1' : ''}>
                            <p className="select-none font-semibold text-base mb-1">{title}</p>
                            {message || (data.files?.length ?? 0) ?
                <div ref={messageRef} className="">
                                    {message && <div className="bs-mkdown text-base break-words [word-break:break-all]">
                                        {fid === CUSTOM_APP_IDS.questionHelper
                                            ? <QuestionMessageContent key={messageId} content={message} complete={data.end && !('interrupted' in data && data.interrupted)} readOnly={!!readOnly || isGuestMode}
                                                isLatestMessage={false} webContent={undefined} citations={data.citations} messageId={messageId} onOpenCitationPanel={onOpenCitationPanel}/>
                                            : fid === CUSTOM_APP_IDS.htmlCourseware
                                                ? <HtmlCoursewareMessage key={messageId} content={message} complete={data.end && !('interrupted' in data && data.interrupted)} readOnly={!!readOnly || isGuestMode}
                                                    isLatestMessage={false} webContent={undefined} citations={data.citations} messageId={messageId} onOpenCitationPanel={onOpenCitationPanel}/>
                                                : fid === CUSTOM_APP_IDS.lessonPlan
                                                    ? <LessonPlanMessage key={messageId} content={message} complete={data.end && !('interrupted' in data && data.interrupted)} readOnly={!!readOnly || isGuestMode}
                                                        isLatestMessage={false} webContent={undefined} citations={data.citations} messageId={messageId} onOpenCitationPanel={onOpenCitationPanel}/>
                                                    : <Markdown content={message} isLatestMessage={false} webContent={undefined} citations={data.citations} messageId={messageId} onOpenCitationPanel={onOpenCitationPanel}/>}
                                    </div>}
                                    {(data.files?.length ?? 0) > 0 && (<AppChatFileList files={data.files ?? []} className="mt-2"/>)}
                                    
                                    {data.receiver && <p className="text-blue-500 text-sm">@ {data.receiver.user_name}</p>}
                                </div>
                : <div>{!data.end && <LoadingIcon className="size-6 text-primary"/>}</div>}
                        </div>
                    </div>
                </div>
            </>}
            
            {data.end && <div className="flex justify-between">
                    <CitationReferencesDrawer content={referenceContent} webContent={referenceWebContent} citations={(data as any).citations} messageId={String(data.id)} desktopMode={onOpenCitationPanel ? "inline-panel" : "overlay"} open={onOpenCitationPanel ? activeCitationMessageId === String(data.id) : undefined} onDesktopOpen={onOpenCitationPanel} buttonClassName="ml-4"/>
                    {!readOnly && <MessageButtons id={data.id} data={data.liked} text={message} onCopy={handleCopyMessage}>
                        <span className="text-slate-400 text-sm pt-0.5">{formatStrTime(data.create_time, i18n.t("com_app.custom_message_date"))}</span>
                        {chatId && messageId && (<ExportSelectionButton chatId={chatId} messageId={messageId}/>)}
                    </MessageButtons>}
                </div>}
        </div>
    </div>;
}
;
