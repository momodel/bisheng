/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/useChatHelpers.ts. Edit this copy for custom chat.
import { produce } from "immer";
import { useMemo } from "react";
import { useRecoilState, useRecoilValue } from "recoil";
import { Chat } from "~/@types/chat";
import { baseMsgItem } from "~/api/apps";
import { formatDate, generateUUID } from "~/utils";
import { FLOW_TYPES } from "~/customizations/agentChat/index";
import { runLogsTypes, SkillMethod } from "~/customizations/agentChat/appUtils/skillMethod";
import { bishengConfState, chatApiVersionState, chatIdState, chatsState, currentChatState, currentRunningState, runningState } from "~/customizations/agentChat/store/atoms";
import { emitAreaTextEvent, EVENT_TYPE } from "~/customizations/agentChat/useAreaText";
type SentMessageFile = {
    file_id?: string;
    file_name?: string;
    file_url?: string;
    name?: string;
    filepath?: string;
    file_path?: string;
};
export function useChatHelpers() {
    const chatState = useRecoilValue(currentChatState);
    const runState = useRecoilValue(currentRunningState);
    const [bishengConfig] = useRecoilState(bishengConfState);
    const [_, setChats] = useRecoilState(chatsState);
    const [__, setRunningState] = useRecoilState(runningState);
    const [chatId] = useRecoilState(chatIdState);
    const apiVersion = useRecoilValue(chatApiVersionState);
    const wsUrl = useMemo(() => {
        if (!chatState)
            return "";
        const { flow } = chatState;
        const type = Number(flow.flow_type);
        const host = bishengConfig?.websocket_url || window.location.host;
        const basePath = __APP_ENV__.BASE_URL;
        const v = apiVersion;
        const routeConfig = {
            [FLOW_TYPES.SKILL]: `${host}${basePath}/api/${v}/chat/${flow.id}?type=L1`,
            [FLOW_TYPES.ASSISTANT]: `${window.location.host}${basePath}/api/${v}/assistant/chat/${flow.id}`,
            [FLOW_TYPES.WORK_FLOW]: `${host}${basePath}/api/${v}/workflow/chat/${flow.id}?chat_id=${chatId}`
        };
        return routeConfig[type] || '';
    }, [chatState, chatId, bishengConfig, apiVersion]);
    const appLost = useMemo(() => {
        return runState?.error?.code;
    }, [runState]);
    const handleMsgError = (errorMsg: {
        code: string;
        data: any;
    }, close: boolean = false) => {
        setRunningState((prev) => ({
            ...prev,
            [chatId]: {
                ...prev[chatId],
                running: false,
                showStop: false,
                showUpload: false,
                inputDisabled: close || !!errorMsg.code,
                error: close ? prev[chatId].error : errorMsg,
            },
        }));
    };
    const clearError = () => {
        setRunningState((prev) => ({
            ...prev,
            [chatId]: {
                ...prev[chatId],
                error: { code: '', data: null },
            },
        }));
    };
    const stopShow = (show: boolean) => {
        setRunningState((prev) => ({
            ...prev,
            [chatId]: {
                ...prev[chatId],
                running: true,
                showStop: show,
            },
        }));
    };
    const reRunShow = (show: boolean) => {
        setRunningState((prev) => ({
            ...prev,
            [chatId]: {
                ...prev[chatId],
                showReRun: show,
            },
        }));
    };
    const showInputForm = (inputSchema) => {
        const { tab, value } = inputSchema;
        let showUpload = false;
        if (tab === "dialog_input") {
            const schemaItem = value?.find((el) => el?.key === "dialog_file_accept");
            const fileAccept = schemaItem?.value;
            emitAreaTextEvent({ action: EVENT_TYPE.FILE_ACCEPTS, chatId, fileAccept });
            const switchItem = value?.find((el) => el?.key === "user_input_file");
            showUpload = switchItem ? switchItem.value : true;
        }
        const runstate = tab === "form_input" ? { inputDisabled: true, inputForm: inputSchema } : { showUpload, inputDisabled: false };
        setRunningState((prev) => ({
            ...prev,
            [chatId]: {
                ...prev[chatId],
                showStop: false,
                ...runstate,
            },
        }));
    };
    const showGuideQuestion = (chatid, question) => {
        setRunningState((prev) => {
            if (prev[chatid].guideWord?.length)
                return prev;
            return {
                ...prev,
                [chatid]: {
                    ...prev[chatid],
                    guideWord: question,
                },
            };
        });
    };
    const message = {
        createNodeMsg: (chatid: string, data: any) => {
            if (['output', 'condition'].includes(data.message?.node_id.split('_')[0]))
                return;
            setChats((prev) => updateChatMessages(prev, chatid, (messages) => {
                const { category, flow_id, chat_id, files, is_bot, liked, message, receiver, type, source, user_id } = data;
                if (type === "end") {
                    return messages.filter((msg) => msg.id !== message.unique_id);
                }
                return [
                    ...messages,
                    {
                        category,
                        flow_id,
                        chat_id,
                        id: message.unique_id,
                        files,
                        is_bot,
                        message,
                        receiver,
                        source,
                        user_id,
                        liked: !!liked,
                        end: false,
                        sender: "",
                        node_id: message?.node_id || "",
                        create_time: formatDate(new Date(), "yyyy-MM-ddTHH:mm:ss"),
                    },
                ];
            }));
        },
        createMsg: (chatid: string, data: any) => {
            setChats((prev) => updateChatMessages(prev, chatid, (messages) => {
                const { category, flow_id, chat_id, message_id, files, is_bot, extra, liked, message: msg, receiver, type, source, citations, user_id, reasoning_log, thought } = data;
                const _files = Array.isArray(files) ? files : [];
                const messageId = message_id || (category === "guide_word" ? 'u-' + generateUUID(6) : "");
                const filteredMessages = deduplicateMessages(messages, message_id);
                return [
                    ...filteredMessages,
                    {
                        category,
                        flow_id,
                        chat_id,
                        id: messageId,
                        files: _files.map(el => ({
                            file_name: el.file_name || el.name,
                            file_url: el.file_url || el.url || el.path || el.filepath,
                            filepath: el.filepath || el.file_path || el.file_url || el.url || el.path,
                            file_id: el.file_id,
                        })),
                        is_bot,
                        message: msg,
                        receiver,
                        source,
                        citations,
                        user_id,
                        liked: !!liked,
                        end: type === "over",
                        sender: "",
                        node_id: msg?.node_id || "",
                        create_time: formatDate(new Date(), "yyyy-MM-ddTHH:mm:ss"),
                        extra,
                        reasoning_log,
                        thought
                    },
                ];
            }));
        },
        streamMsg: (chatid: string, data: any) => {
            setChats((prev) => updateChatMessages(prev, chatid, (messages) => {
                const { unique_id, output_key, reasoning_content } = data.message;
                const messageId = unique_id + output_key;
                const currentMessageIndex = messages.findIndex((msg) => msg.id === messageId);
                if (currentMessageIndex === -1) {
                    const { category, flow_id, chat_id, files, is_bot, extra, liked, receiver, type, source, user_id } = data;
                    const { citations } = data;
                    const message = data.message.msg;
                    const reasoning_log = reasoning_content || "";
                    const filteredMessages = deduplicateMessages(messages, messageId);
                    return [
                        ...filteredMessages,
                        {
                            category,
                            flow_id,
                            chat_id,
                            id: messageId,
                            files,
                            is_bot,
                            message,
                            receiver,
                            source,
                            citations,
                            user_id,
                            liked: !!liked,
                            end: type === "over",
                            sender: "",
                            node_id: data.message?.node_id || "",
                            create_time: formatDate(new Date(), "yyyy-MM-ddTHH:mm:ss"),
                            extra,
                            reasoning_log,
                        },
                    ];
                }
                else {
                    const currentMsg = messages[currentMessageIndex];
                    const updatedMessages = [...messages];
                    updatedMessages[currentMessageIndex] = {
                        ...currentMsg,
                        id: data.type === "end" ? (data.message_id || currentMsg.id) : currentMsg.id,
                        message: data.type === "end" ? data.message.msg : currentMsg.message + data.message.msg,
                        reasoning_log: reasoning_content
                            ? currentMsg.reasoning_log + reasoning_content
                            : currentMsg.reasoning_log,
                        create_time: formatDate(new Date(), "yyyy-MM-ddTHH:mm:ss"),
                        source: data.source,
                        citations: data.citations ?? currentMsg.citations,
                        end: data.type === "end",
                        extra: data.extra,
                    };
                    return updatedMessages;
                }
            }));
        },
        closeAllMsg: (chatid: string) => {
            setChats((prev) => updateChatMessages(prev, chatid, (messages) => {
                return messages.reduce((acc, msg) => {
                    if (msg.message || msg.reasoning_log || msg.files?.length) {
                        acc.push({ ...msg, end: true });
                    }
                    return acc;
                }, [] as any[]);
            }));
        },
        closeAllLogMsg: (chatid: string) => {
            setChats((prev) => updateChatMessages(prev, chatid, (messages) => {
                return messages.filter((msg) => msg.category !== "node_run");
            }));
        },
        skillStreamMsg: (chatid: string, data: any) => {
            setChats((prev) => updateChatMessages(prev, chatid, (messages) => {
                const next = SkillMethod.updateStreamMessage(data, chatid, messages, data.type === 'end_cover' && data.category === 'anwser');
                const dbId = data?.message_id;
                if (dbId && !['tool', 'flow', 'knowledge'].includes(data.category)) {
                    for (let i = next.length - 1; i >= 0; i--) {
                        const m = next[i];
                        if (!m?.is_bot)
                            break;
                        if (['tool', 'flow', 'knowledge'].includes(m.category))
                            continue;
                        const idStr = String(m.id ?? '');
                        const idMissingOrTemp = !m.id || idStr.startsWith('tmp-') || idStr.startsWith('u-');
                        if (idMissingOrTemp) {
                            m.id = dbId;
                        }
                        break;
                    }
                }
                return next;
            }));
        },
        skillCloseMsg: () => {
            setChats((prev) => updateChatMessages(prev, chatId, (messages) => messages.map((msg) => runLogsTypes.includes(msg.category) && !msg.end
                ? { ...msg, end: true, interrupted: true }
                : msg)));
            setRunningState((prev) => {
                return {
                    ...prev,
                    [chatId]: {
                        ...prev[chatId],
                        running: false,
                        inputDisabled: !!prev[chatId].error?.code,
                        inputForm: false,
                        showStop: false
                    },
                };
            });
        },
        endMsg: (chatid: string, data: any) => {
            if (data.type === "end_cover" && data.message) {
                console.log("Safety audit triggered; removing unfinished messages");
                data.category = "stream_msg";
                data.type = "over";
                data.id = generateUUID(8);
                message.createMsg(chatid, data);
                setTimeout(() => {
                    setChats((prev) => updateChatMessages(prev, chatId, (messages) => messages.filter((msg) => msg.end)));
                }, 0);
            }
        },
        insetSeparator: (chatid: string, msg: string) => {
            setChats((prev) => updateChatMessages(prev, chatid, (messages) => {
                if (messages[messages.length - 1]?.category === "divider")
                    return messages;
                return [
                    ...messages,
                    {
                        ...baseMsgItem,
                        category: "divider",
                        id: generateUUID(8),
                        message: msg,
                        create_time: formatDate(new Date(), "yyyy-MM-ddTHH:mm:ss"),
                    },
                ];
            }));
        },
        createSendMsg: (msg: string, files: SentMessageFile[] = []) => {
            setChats((prev) => updateChatMessages(prev, chatId, (messages) => [
                ...messages,
                {
                    ...baseMsgItem,
                    category: "question",
                    id: 'u-' + generateUUID(8),
                    message: msg,
                    files,
                    create_time: formatDate(new Date(), "yyyy-MM-ddTHH:mm:ss"),
                },
            ]));
            const dom = document.getElementById('customChatMessageScrollPane');
            setTimeout(() => {
                if (dom) {
                    dom.scrollTop = dom.scrollHeight;
                }
            }, 0);
        },
        closeOutputMsg: (input) => {
            setChats((prev) => updateChatMessages(prev, chatId, (messages) => {
                const updatedMessages = messages.map(msg => {
                    if (["output_with_input_msg", "output_with_choose_msg"].includes(msg.category)) {
                        return {
                            ...msg,
                            message: {
                                ...msg.message,
                                hisValue: input
                            }
                        };
                    }
                    return msg;
                });
                return updatedMessages;
            }));
        }
    };
    return {
        wsUrl,
        appLost,
        chatId,
        running: runState?.running,
        message,
        flow: chatState?.flow,
        stopShow,
        reRunShow,
        handleMsgError,
        clearError,
        showInputForm,
        showGuideQuestion
    };
}
;
const updateChatMessages = (chats: Record<string, Chat>, chatId: string, updater: (messages: any[]) => any[]): Record<string, Chat> => {
    return produce(chats, (draft) => {
        if (draft[chatId]) {
            const currentMessages = draft[chatId].messages || [];
            const updatedMessages = updater(currentMessages);
            if (updatedMessages !== currentMessages) {
                draft[chatId].messages = updatedMessages;
            }
        }
    });
};
export const deduplicateMessages = (messages: any[], messageId: string): any[] => {
    if (!messageId)
        return messages;
    const seenIds = new Set<string>();
    return messages.filter((msg) => {
        const shouldExclude = msg.id === messageId && msg.his;
        if (shouldExclude)
            return false;
        if (seenIds.has(msg.id))
            return false;
        seenIds.add(msg.id);
        return true;
    });
};
