// Frontend fork of pages/appChat/appUtils/skillMethod.ts. Edit this copy for custom chat.
import { formatDate } from "~/utils";
export const runLogsTypes = ['tool', 'flow', 'knowledge'];
export const SkillMethod = {
    getSendParam: ({ tabs, flow, chatId, message }) => {
        const msgData = {
            chatHistory: [],
            flow_id: flow.id,
            chat_id: chatId,
            name: flow.name,
            description: flow.description || flow.desc,
            inputs: {}
        } as any;
        if (flow.flow_type === 1) {
            const inputs = tabs[flow.id].formKeysData.input_keys;
            const input = inputs.find((el: any) => !el.type);
            const inputKey = input ? Object.keys(input)[0] : '';
            if (message)
                msgData.inputs = { ...input, [inputKey]: message };
        }
        else {
            msgData.inputs = {
                data: {
                    chatId,
                    id: flow.id,
                    type: 5
                },
                input: message
            };
        }
        return msgData;
    },
    getStartParam: (data: any, chatId) => {
        data.message = runLogsTypes.includes(data.category) ? JSON.parse(data.message) : '';
        data.thought = data.intermediate_steps || '';
        data.category = runLogsTypes.includes(data.category) ? data.category : 'stream_msg';
        data.chat_id = chatId;
        return data;
    },
    updateStreamMessage: (data: any, chatId, messages: any, cover?: boolean) => {
        const wsdata = data.type === 'stream' ? {
            chat_id: chatId,
            message: data.message,
            category: runLogsTypes.includes(data.category) ? data.category : 'stream_msg',
            thought: data.intermediate_steps
        } : {
            ...data,
            chat_id: chatId,
            end: true,
            thought: data.intermediate_steps || '',
            messageId: data.message_id,
            noAccess: false,
            liked: 0,
            category: runLogsTypes.includes(data.category) ? data.category : 'stream_msg',
            create_time: formatDate(new Date(), 'yyyy-MM-ddTHH:mm:ss')
        };
        const isRunLog = runLogsTypes.includes(wsdata.category);
        let currentMessageIndex = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (!messages[i].is_bot)
                break;
            if (isRunLog && messages[i].extra === wsdata.extra) {
                currentMessageIndex = i;
                break;
            }
            else if (!isRunLog && !runLogsTypes.includes(messages[i].category)) {
                currentMessageIndex = i;
                break;
            }
            else if (wsdata.type === 'end_cover' && messages[i].category === 'tool') {
                currentMessageIndex = i;
                break;
            }
        }
        const currentMessage = messages[currentMessageIndex];
        let message = '';
        let reasoning_log = currentMessage.reasoning_log || '';
        if (isRunLog) {
            message = JSON.parse(wsdata.message);
        }
        else if (typeof wsdata.message !== 'string' && wsdata.message && 'reasoning_content' in wsdata.message) {
            message = currentMessage.message + (wsdata.message.content || '');
            reasoning_log += (wsdata.message.reasoning_content || '');
        }
        else {
            message = currentMessage.message + (wsdata.message || '');
        }
        if (wsdata.type === 'end_cover' && currentMessage.category === 'tool') {
            messages.forEach((msg) => {
                msg.end = true;
            });
            cover = false;
        }
        const realMessageId = !isRunLog && wsdata.messageId;
        const newCurrentMessage = {
            ...currentMessage,
            ...wsdata,
            id: realMessageId || currentMessage.id || (isRunLog ? wsdata.extra : undefined),
            message,
            reasoning_log,
            thought: currentMessage.thought + (wsdata.thought ? `${wsdata.thought}\n` : ''),
            files: wsdata.files || [],
            category: wsdata.category || '',
            source: wsdata.source
        };
        if (!newCurrentMessage.id) {
            newCurrentMessage.id = 'tmp-' + Math.random().toString(36).slice(2, 10);
        }
        messages[currentMessageIndex] = newCurrentMessage;
        if (!isRunLog) {
            if (newCurrentMessage.end && !(newCurrentMessage.files.length || newCurrentMessage.thought || newCurrentMessage.message)) {
                messages.pop();
            }
            const prevMessage = messages[currentMessageIndex - 1];
            if (wsdata.type === 'end_cover' && prevMessage.is_bot) {
                cover = true;
            }
            if (prevMessage?.reasoning_log) {
                if ((prevMessage
                    && prevMessage.message === newCurrentMessage.message
                    && prevMessage.thought === newCurrentMessage.thought)
                    || cover) {
                    const removedMsg = messages.pop();
                    prevMessage.message = removedMsg.message;
                }
            }
            else {
                if ((prevMessage
                    && prevMessage.message === newCurrentMessage.message && newCurrentMessage.end
                    && prevMessage.thought === newCurrentMessage.thought)
                    || cover) {
                    const removedMsg = messages.pop();
                    Object.keys(prevMessage).forEach((key) => {
                        prevMessage[key] = removedMsg[key];
                    });
                }
            }
        }
        return [...messages];
    }
};
