/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/components/MessageButtons.tsx. Edit this copy for custom chat.
import i18n from "~/locales/i18n";
import { useState } from "react";
import { Outlined } from "bisheng-icons";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { copyTrackingApi, disLikeCommentApi, likeChatApi } from "~/api/apps";
import { MessageFeedbackButtons } from "~/components/Chat/MessageFeedbackButtons";
import { TextToSpeechButton } from "~/components/Voice/TextToSpeechButton";
import { chatIdState, chatsState } from "~/customizations/agentChat/store/atoms";
const ACTION_BTN = "flex size-6 items-center justify-center rounded-md transition-colors hover:bg-fill-1";
interface MessageButtonsProps { id?: number; text: string; onCopy: () => void; data?: number; children?: React.ReactNode; }
export function MessageButtons({ id, text, onCopy, data, children = null }: MessageButtonsProps) {
    const [copied, setCopied] = useState(false);
    const chatId = useRecoilValue(chatIdState);
    const setChats = useSetRecoilState(chatsState);
    const handleLike = (liked: number) => {
        const pending = likeChatApi(id, liked);
        if (!chatId)
            return pending;
        setChats((prev) => {
            const chat = prev[chatId];
            if (!chat?.messages)
                return prev;
            return {
                ...prev,
                [chatId]: {
                    ...chat,
                    messages: chat.messages.map((msg) => msg.id === id ? { ...msg, liked } : msg),
                },
            };
        });
        return pending;
    };
    const handleCopy = (e) => {
        setCopied(true);
        onCopy();
        setTimeout(() => {
            setCopied(false);
        }, 2000);
        copyTrackingApi(id);
    };
    return <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {children}
        <TextToSpeechButton messageId={String(id)} text={text}/>
        <button type="button" className={ACTION_BTN} onClick={handleCopy} title={copied ? i18n.t("com_ui_copied") : i18n.t("com_ui_copy")} aria-label={i18n.t("com_ui_copy")}>
            {copied
            ? <Outlined.Copied size={14} className="text-blue-500"/>
            : <Outlined.Copy size={14} className="text-text-3"/>}
        </button>
        <MessageFeedbackButtons liked={data} onLike={handleLike} onDislikeComment={(comment) => disLikeCommentApi(id, comment)}/>
    </div>;
}
;
