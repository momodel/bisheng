/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/useMessages.ts. Edit this copy for custom chat.
import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useRecoilState, useRecoilValue } from "recoil";
import { getChatHistoryApi } from "~/api/apps";
import { useAutoScroll } from "~/hooks/useAutoScroll";
import { chatIdState, chatsState, currentChatState } from "~/customizations/agentChat/store/atoms";
export const useMessage = (shareToken) => {
    const { conversationId } = useParams();
    const chatState = useRecoilValue(currentChatState);
    const [chatId] = useRecoilState(chatIdState);
    const { flow, messages } = chatState || { flow: null, messages: [] };
    const messageScrollRef = useRef<HTMLDivElement>(null);
    useAutoScroll(messageScrollRef, messages);
    useLoadMessage({ chatId, chatState, messageScrollRef, shareToken });
    return {
        chatId: conversationId,
        messages,
        messageScrollRef
    };
};
const useLoadMessage = ({ chatId, chatState, messageScrollRef, shareToken }: {
    chatId: string;
    chatState: any;
    messageScrollRef: React.RefObject<HTMLDivElement>;
    shareToken: string;
}) => {
    const [chats, setChats] = useRecoilState(chatsState);
    const { flow, messages, running, historyEnd } = chatState || {};
    useEffect(() => {
        if (chatId && messageScrollRef.current) {
            requestAnimationFrame(() => {
                if (messageScrollRef.current) {
                    messageScrollRef.current.scrollTop = messageScrollRef.current.scrollHeight;
                }
            });
        }
    }, [chatId]);
    const loadMore = async (chatId: string) => {
        if (running || historyEnd || !messages?.[0]?.id || !flow)
            return;
        const messageId = messages[0].id;
        if (typeof messageId === 'string' && messageId.startsWith('u-'))
            return;
        const msgs = await getChatHistoryApi({ flowId: flow.id, chatId, flowType: flow.flow_type, id: messages[0].id || 0, shareToken });
        setChats((prev) => {
            const chatData = prev[chatId];
            const param = msgs.length ?
                { ...chatData, messages: [...msgs.reverse(), ...chatData!.messages] }
                : { ...chatData, historyEnd: true };
            return {
                ...prev,
                [chatId]: param
            };
        });
    };
    const queryLockRef = useRef(false);
    useEffect(() => {
        function handleScroll() {
            const scrollElement = messageScrollRef.current;
            if (queryLockRef.current)
                return;
            if (!scrollElement)
                return;
            const { scrollTop } = scrollElement;
            if (scrollTop <= 90) {
                console.log("Loading messages:", 1);
                queryLockRef.current = true;
                loadMore(chatId);
                setTimeout(() => {
                    queryLockRef.current = false;
                }, 1000);
            }
        }
        messageScrollRef.current?.addEventListener('scroll', handleScroll);
        return () => messageScrollRef.current?.removeEventListener('scroll', handleScroll);
    }, [messageScrollRef.current, chatState, chatId, shareToken]);
};
