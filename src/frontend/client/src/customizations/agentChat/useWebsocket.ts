/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/useWebsocket.ts. Edit this copy for custom chat.
"use client";
import { useEffect, useRef } from "react";
import { useRecoilState, useRecoilValue } from "recoil";
import { NotificationSeverity } from "~/common";
import { useLocalize, useToast } from "~/hooks";
import { SkillMethod } from "~/customizations/agentChat/appUtils/skillMethod";
import { chatApiVersionState, submitDataState } from "~/customizations/agentChat/store/atoms";
import { appConversationsState } from "~/customizations/agentChat/store/appSidebarAtoms";
import { genTitle } from "~/api/chat/data-service";
import logger from "~/utils/logger";
import { useOptionalStandaloneChatContext } from "~/pages/standaloneChat/StandaloneChatContext";
import { buildWorkflowInitMessage, claimWorkflowHandshake, createWorkflowActivation, decideWorkflowCloseAction, isWorkflowFinishedStatusCheck, syncWorkflowActivation, } from "~/customizations/agentChat/workflowAutoRerun";
import type { WorkflowCloseAction } from "~/customizations/agentChat/workflowAutoRerun";
export const AppLostMessage = '11111';
const wsMap = new Map<string, WebSocket>();
const sessionInfoMap = new Map<string, any>();
const restartCallbacks = new Map<string, () => void>();
export const closeAppChatWebSocket = (chatId: string) => {
    const ws = wsMap.get(chatId);
    if (ws) {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'stop' }));
            }
            ws.onmessage = null;
            ws.onerror = null;
            ws.onclose = null;
            ws.close();
        }
        catch {
        }
    }
    wsMap.delete(chatId);
    sessionInfoMap.delete(chatId);
    restartCallbacks.delete(chatId);
};
// Dispose only this frontend copy's connections when its route scope unmounts.
export function disposeCustomChatSockets() {
    for (const ws of wsMap.values()) {
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
    }
    wsMap.clear();
    sessionInfoMap.clear();
    restartCallbacks.clear();
}

export const enum ActionType {
    INIT_DATA = 'init_data',
    INPUT = 'input',
    CHECK_STATUS = 'check_status',
    STOP = 'stop',
    RESTART = 'restart',
    FORM_SUBMIT = 'form_submit',
    MESSAGE_INPUT = 'message_input',
    SKILL_INPUT = 'skill_input',
    SKILL_FORM_SUBMIT = 'skill_form_submit'
}
export const useWebSocket = (helpers) => {
    const { showToast } = useToast();
    const [submitData, setSubmitData] = useRecoilState(submitDataState);
    const [, setAppConversations] = useRecoilState(appConversationsState);
    const apiVersion = useRecoilValue(chatApiVersionState);
    const localize = useLocalize();
    const standaloneContext = useOptionalStandaloneChatContext();
    const activationRef = useRef(createWorkflowActivation(helpers.chatId));
    activationRef.current = syncWorkflowActivation(activationRef.current, helpers.chatId);
    const websocket = wsMap.get(helpers.chatId);
    const currentChatId = useCurrentChatId(helpers.chatId);
    const hasGeneratedTitleRef = useRef<Record<string, boolean>>({});
    const triggerGenTitle = () => {
        const chatId = helpers.chatId;
        if (!helpers.flow?.isNew)
            return;
        if (hasGeneratedTitleRef.current[chatId])
            return;
        hasGeneratedTitleRef.current[chatId] = true;
        genTitle({ conversationId: chatId }, apiVersion)
            .then((res: {
            title?: string;
        }) => {
            if (!res?.title)
                return;
            setAppConversations((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: res.title! } : c)));
        })
            .catch(() => {
        });
    };
    const sendWorkflowStatusCheck = (ws: WebSocket) => {
        const activation = activationRef.current;
        if (!claimWorkflowHandshake(activation, helpers.chatId))
            return;
        ws.send(JSON.stringify({
            action: ActionType.CHECK_STATUS,
            chat_id: helpers.chatId,
            flow_id: helpers.flow.id,
        }));
    };
    const connect = (callBack?: (ws: WebSocket) => void) => {
        const replacingExistingSocket = !!websocket;
        if (websocket) {
            if (!callBack) {
                if (websocket.readyState === WebSocket.OPEN) {
                    if (helpers.flow.flow_type === 10) {
                        sendWorkflowStatusCheck(websocket);
                    }
                    return;
                }
                if (websocket.readyState === WebSocket.CONNECTING)
                    return;
                wsMap.delete(helpers.chatId);
            }
            else if (websocket.readyState === WebSocket.OPEN) {
                return;
            }
        }
        if (!helpers.wsUrl)
            return;
        if (helpers.appLost === AppLostMessage)
            return;
        const isSecureProtocol = window.location.protocol === "https:";
        const webSocketProtocol = isSecureProtocol ? "wss" : "ws";
        const ws = new WebSocket(`${webSocketProtocol}://${helpers.wsUrl}`);
        wsMap.set(helpers.chatId, ws);
        ws.onopen = () => {
            console.log("WebSocket connection established!");
            helpers.clearError();
            if (helpers.flow.flow_type === 10) {
                const shouldCheckStatus = replacingExistingSocket || !helpers.flow.isNew;
                if (shouldCheckStatus) {
                    sendWorkflowStatusCheck(ws);
                    return;
                }
                const { data, ...flow } = helpers.flow;
                const msg = {
                    action: ActionType.INIT_DATA,
                    chat_id: helpers.chatId,
                    flow_id: helpers.flow.id,
                    data: { ...flow, ...data },
                };
                claimWorkflowHandshake(activationRef.current, helpers.chatId);
                ws?.send(JSON.stringify(msg));
            }
            else {
                const msg = {
                    chatHistory: [],
                    chat_id: helpers.chatId,
                    flow_id: helpers.flow.id,
                    inputs: {
                        data: helpers.flow.flow_type === 5 ? {
                            id: helpers.flow.id,
                            chatId: helpers.chatId,
                            type: helpers.flow.flow_type,
                        } : undefined
                    },
                    name: helpers.flow.name,
                    description: helpers.flow.description || helpers.flow.desc
                };
                ws?.send(JSON.stringify(msg));
                if (helpers.flow.flow_type === 1 && callBack) {
                    callBack?.(ws);
                    callBack = undefined;
                }
            }
        };
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('data :>> ', data);
                handleMessages(data, ws);
                if (data.type === 'close' && callBack) {
                    callBack?.(ws);
                    callBack = undefined;
                }
            }
            catch (error) {
                console.error("WebSocket message parse error:", error);
            }
        };
        ws.onclose = (event) => {
            console.log('close chatId:>> ', helpers.chatId);
            console.error('ws close :>> ', event);
            helpers.handleMsgError({ code: '', data: null }, true);
        };
        ws.onerror = (error) => {
            console.error("WebSocket connection error", helpers.chatId, error);
            helpers.handleMsgError({ code: '', data: null });
        };
    };
    const handleMessages = (data, _ws) => {
        if ((data.category === 'end_cover' && data.type !== 'end_cover')) {
            return;
        }
        let workflowCloseAction: WorkflowCloseAction | null = null;
        if (helpers.flow.flow_type === 10 && data.type === 'close' && data.category === 'processing') {
            workflowCloseAction = decideWorkflowCloseAction({
                data,
                activation: activationRef.current,
                enabled: standaloneContext?.autoRerunOnOpen ?? false,
                isStandaloneWorkflow: standaloneContext?.flowType === 'workflow',
                isNewConversation: !!helpers.flow.isNew,
            });
            logger.debug('workflow-auto-rerun', {
                chatId: helpers.chatId,
                decision: workflowCloseAction,
            });
            if (workflowCloseAction === 'ignore')
                return;
            if (isWorkflowFinishedStatusCheck(data)) {
                activationRef.current.handled = true;
            }
        }
        if (data.type === 'begin') {
        }
        else if (data.type === 'close' && data.category === 'processing') {
            helpers.stopShow(false);
            helpers.message.closeAllLogMsg(helpers.chatId);
        }
        if (data.category === 'error' || data.type === 'error') {
            let code = 0, message = '';
            if (typeof data.message === 'string') {
                const _data = JSON.parse(data.message);
                code = _data.status_code;
                message = _data.status_message;
            }
            else {
                code = data.message.status_code;
                message = data.message.status_message;
            }
            if (![10421, 13002].includes(code)) {
                showToast({
                    message: code === 500 ? message : localize(`api_errors.${String(code)}`, { ...(data.message?.data || {}), defaultValue: localize('api_errors.fallback') }),
                    severity: NotificationSeverity.ERROR,
                });
            }
            else {
                helpers.handleMsgError({ code, data: data.message?.data });
            }
            return helpers.message.closeAllMsg(helpers.chatId);
        }
        else if (data.category === 'node_run') {
            return helpers.message.createNodeMsg(helpers.chatId, data);
        }
        else if (data.category === 'guide_word') {
            data.message.msg = data.message.guide_word;
        }
        else if (data.category === 'input') {
            const { node_id, input_schema } = data.message;
            sessionInfoMap.set(helpers.chatId, { node_id, message_id: data.message_id });
            helpers.showInputForm({ ...input_schema, node_id });
            return;
        }
        else if (data.category === 'guide_question') {
            return helpers.showGuideQuestion(helpers.chatId, data.message.guide_question.filter(q => q));
        }
        else if (data.category === 'stream_msg') {
            helpers.message.streamMsg(helpers.chatId, data);
            if (data.type === 'end')
                triggerGenTitle();
        }
        else if (data.category === 'end_cover' && data.type === 'end_cover') {
            _ws.send(JSON.stringify({ action: 'stop' }));
            return helpers.message.endMsg(helpers.chatId, data);
        }
        if (helpers.flow.flow_type !== 10) {
            if (Array.isArray(data) && data.length)
                return;
            if (data.type === 'start') {
                const _data = SkillMethod.getStartParam(data, helpers.chatId);
                helpers.message.createMsg(helpers.chatId, _data);
            }
            else if (data.type === 'stream') {
                helpers.message.skillStreamMsg(helpers.chatId, data);
            }
            if (['end', 'end_cover'].includes(data.type) && data.receiver?.is_self) {
                helpers.showInputForm({});
            }
            else if (['end', 'end_cover'].includes(data.type)) {
                helpers.message.skillStreamMsg(helpers.chatId, data);
            }
            else if (data.type === 'close') {
                helpers.message.skillCloseMsg();
            }
            return;
        }
        if (data.type === 'close' && data.category === 'processing') {
            helpers.message.insetSeparator(helpers.chatId, 'com_chat_round_finished');
            const restartCallback = restartCallbacks.get(helpers.chatId);
            if (restartCallback) {
                restartCallbacks.delete(helpers.chatId);
                restartCallback();
            }
            else {
                if (workflowCloseAction === 'auto') {
                    helpers.reRunShow(false);
                    helpers.stopShow(true);
                    _ws.send(JSON.stringify(buildWorkflowInitMessage(helpers.flow, helpers.chatId)));
                }
                else if (workflowCloseAction === 'manual') {
                    helpers.reRunShow(true);
                }
            }
        }
        else if (data.type === 'over') {
            helpers.message.createMsg(helpers.chatId, data);
        }
    };
    useEffect(() => {
        connect();
        return () => {
            if (currentChatId !== helpers.chatId) {
                if (websocket && !helpers.running) {
                    console.log('ws close', currentChatId, helpers.chatId);
                    websocket.close();
                    wsMap.delete(helpers.chatId);
                    restartCallbacks.delete(helpers.chatId);
                }
            }
        };
    }, [helpers.chatId, helpers.running]);
    const sendWsMsg = async (msg) => {
        try {
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                websocket.send(JSON.stringify(msg));
            }
            else {
                connect((_websocket) => {
                    _websocket.send(JSON.stringify(msg));
                });
            }
        }
        catch (error: any) {
            showToast({
                message: error.message,
                severity: NotificationSeverity.ERROR,
            });
        }
    };
    useEffect(() => {
        if (submitData
            && (submitData.action === 'skill_input' || websocket && websocket.readyState === WebSocket.OPEN)) {
            const action = submitData.action;
            switch (action) {
                case ActionType.RESTART: {
                    if (!submitData.flow || !submitData.chatId) break;
                    sendWsMsg({ action: 'stop' });
                    const initMessage = buildWorkflowInitMessage({ ...submitData.flow }, submitData.chatId);
                    restartCallbacks.set(submitData.chatId, () => {
                        sendWsMsg(initMessage);
                    });
                    break;
                }
                case ActionType.INPUT: {
                    if (!submitData.flow) break;
                    const sessionInfo = sessionInfoMap.get(helpers.chatId);
                    const node = submitData.flow.data.nodes.find(node => node.id === sessionInfo?.node_id);
                    const tab = node.data.tab.value;
                    let variable = '';
                    node.data.group_params.some(group => group.params.some(param => {
                        if (param.tab === tab) {
                            variable = param.key;
                            return true;
                        }
                        return false;
                    }));
                    let message = submitData.input;
                    let filePath = [];
                    if (submitData.files?.length) {
                        const [_filePath, fileNames] = submitData.files.reduce((acc, cur) => {
                            acc[0].push(cur.filepath ?? cur.file_path ?? cur.path);
                            acc[1].push(cur.name);
                            return acc;
                        }, [[], []]);
                        filePath = _filePath;
                        const _value = submitData.input;
                        message = fileNames.length > 0 ? fileNames.join('\n') + '\n' + _value : _value;
                    }
                    const messageFiles = (submitData.files || []).map((f) => ({
                        file_id: f.file_id ?? f.id,
                        file_name: f.name ?? f.file_name,
                        file_url: f.filepath ?? f.file_path ?? f.path,
                    }));
                    sendWsMsg({
                        action: 'input',
                        chat_id: submitData.chatId,
                        flow_id: submitData.flow.id,
                        data: {
                            [sessionInfo?.node_id]: {
                                data: {
                                    [variable]: message,
                                    dialog_files_content: filePath
                                },
                                message,
                                files: messageFiles,
                                message_id: sessionInfo.message_id,
                                category: 'question',
                                extra: '',
                                source: 0
                            }
                        },
                    });
                    helpers.message.createSendMsg(message, messageFiles);
                    break;
                }
                case ActionType.SKILL_INPUT:
                    sendWsMsg(submitData.data);
                    helpers.message.createSendMsg(submitData.input);
                    break;
                case ActionType.FORM_SUBMIT:
                    sendWsMsg({
                        action: 'input',
                        chat_id: submitData.chatId,
                        flow_id: submitData.flowId,
                        data: {
                            [submitData.nodeId!]: {
                                data: submitData.data,
                                message: submitData.input,
                                message_id: sessionInfoMap.get(helpers.chatId).message_id,
                                category: 'question',
                                extra: '',
                                source: 0
                            }
                        },
                    });
                    helpers.message.createSendMsg(submitData.input);
                    break;
                case ActionType.SKILL_FORM_SUBMIT:
                    sendWsMsg(submitData.data);
                    helpers.message.createSendMsg(submitData.input);
                    break;
                case ActionType.MESSAGE_INPUT:
                    sendWsMsg({
                        action: 'input',
                        chat_id: submitData.chatId,
                        flow_id: submitData.flowId,
                        data: {
                            [submitData.data.nodeId!]: {
                                data: submitData.data.data,
                                message: submitData.data.message,
                                message_id: submitData.data.msgId
                            }
                        },
                    });
                    helpers.message.closeOutputMsg(submitData.data.data.output_result);
                    break;
                case ActionType.STOP:
                    sendWsMsg({ action: 'stop' });
                    break;
            }
            setSubmitData(null);
        }
    }, [submitData]);
};
const useCurrentChatId = (chatId) => {
    const currentChatIdRef = useRef<string | null>(null);
    useEffect(() => {
        currentChatIdRef.current = chatId;
    }, [chatId]);
    return currentChatIdRef.current;
};
