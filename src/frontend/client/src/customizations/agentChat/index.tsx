/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/index.tsx. Edit this copy for custom chat.
import i18n from "~/locales/i18n";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "recoil";
import { ChatMessageType, FlowData } from "~/@types/chat";
import { getAssistantDetailApi, getChatHistoryApi, getDeleteFlowApi, getFlowApi, postBuildInit } from "~/api/apps";
import { checkResourceAction } from "~/api/permission";
import { NotificationSeverity } from "~/common";
import { useToastContext } from "~/Providers";
import { useLocalize } from "~/hooks";
import store from "~/store";
import { ChatView } from "~/customizations/agentChat/ChatView";
import { appConversationsState } from "~/customizations/agentChat/store/appSidebarAtoms";
import { chatApiVersionState, chatIdState, chatsState, currentChatState, runningState, tabsState } from "~/customizations/agentChat/store/atoms";
import { AppLostMessage } from "~/customizations/agentChat/useWebsocket";
const API_VERSION = 'v1';
const TRAFFIC_LIMIT_ERROR_CODES = new Set([429, 503, 12045]);
const getInitialChatError = (res: any) => {
    const code = Number(res?.status_code);
    if (TRAFFIC_LIMIT_ERROR_CODES.has(code)) {
        return { code: String(code), data: res?.data ?? null };
    }
    return { code: AppLostMessage, data: null };
};
// Assistant detail API returns `desc` while flow API returns `description`.
// Normalize at the source so downstream readers only use `description`.
interface FlowDescriptionSource {
    description?: string;
    desc?: string;
}
const normalizeFlowDescription = <T extends FlowDescriptionSource>(data: T) => ({
    ...data,
    description: data.description || data.desc || '',
});
export const enum FLOW_TYPES {
    WORK_FLOW = 10,
    ASSISTANT = 5,
    SKILL = 1
}
export function AppChat({ chatId = '', flowId = '', shareToken = '', flowType = '', apiVersion = '', isGuestMode = false }) {
    const { conversationId: _cid, fid: _fid, type: _type } = useParams();
    const cid = _cid || chatId;
    const fid = _fid || flowId;
    const type = _type || flowType;
    const effectiveApiVersion = apiVersion || API_VERSION;
    const [readOnly] = useState(shareToken);
    const setApiVersion = useRecoilState(chatApiVersionState)[1];
    useEffect(() => {
        setApiVersion(effectiveApiVersion as 'v1' | 'v2');
        return () => { setApiVersion('v1'); };
    }, [effectiveApiVersion, setApiVersion]);
    const [chats, setChats] = useRecoilState(chatsState);
    const [__, setRunningState] = useRecoilState(runningState);
    const [_, setChatId] = useRecoilState(chatIdState);
    const chatState = useRecoilValue(currentChatState);
    const conversations = useRecoilValue(appConversationsState);
    const setChatMobileHeader = useSetRecoilState(store.chatMobileHeaderState);
    const localize = useLocalize();
    const build = useBuild();
    const navigate = useNavigate();
    const { showToast } = useToastContext();
    const flow = chatState?.flow;
    const headerTitleForMobile = useMemo(() => {
        if (!cid)
            return localize("com_ui_new_chat");
        const activeConversation = conversations.find((item) => item.id === cid);
        return ([activeConversation?.title, flow?.name]
            .map((item) => String(item || "").trim())
            .find(Boolean) || localize("com_ui_new_chat"));
    }, [cid, conversations, flow?.name, localize]);
    const hideShareForMobile = flow?.can_share !== true;
    useEffect(() => {
        if (!cid || !fid || !type)
            return;
        setChatMobileHeader({
            title: headerTitleForMobile,
            conversationId: cid,
            flowId: flow?.id || String(fid),
            flowType: Number(flow?.flow_type ?? type) || 15,
            readOnly: !!readOnly,
            hideShare: hideShareForMobile,
        });
        return () => setChatMobileHeader(null);
    }, [
        cid,
        fid,
        type,
        flow?.id,
        flow?.flow_type,
        headerTitleForMobile,
        readOnly,
        hideShareForMobile,
        setChatMobileHeader,
    ]);
    const init = async () => {
        if (!cid)
            return;
        let flowData: (FlowData & { guide_question?: string[] }) | null = null;
        let messages: ChatMessageType[] = [];
        const currentData = chats[cid];
        let error: {
            code: string;
            data: any;
        } = { code: '', data: null };
        setChatId(cid!);
        const numericType = Number(type);
        const ensureUseAppPermission = async (objectType: "workflow" | "assistant") => {
            if (shareToken || isGuestMode)
                return true;
            const permission = await checkResourceAction({
                resource_type: objectType,
                resource_id: fid!,
                action: "use",
            })
                .catch(() => ({ allowed: false }));
            if (permission?.allowed)
                return true;
            showToast?.({ message: i18n.t("com_app.custom_no_access"), severity: NotificationSeverity.ERROR });
            navigate('/apps', { replace: true });
            return false;
        };
        if (numericType === FLOW_TYPES.WORK_FLOW && !(await ensureUseAppPermission("workflow")))
            return;
        if (numericType === FLOW_TYPES.ASSISTANT && !(await ensureUseAppPermission("assistant")))
            return;
        if (currentData) {
            numericType === FLOW_TYPES.SKILL && setRunningState((prev) => {
                return {
                    ...prev,
                    [cid]: {
                        ...(prev?.[cid] || {}),
                        inputDisabled: false,
                    },
                };
            });
            return;
        }
        ;
        switch (numericType) {
            case FLOW_TYPES.SKILL:
                navigate('/404', { replace: true });
                return;
            case FLOW_TYPES.WORK_FLOW:
                const [flowRes, msgRes] = await Promise.all([
                    getFlowApi(fid!, effectiveApiVersion, shareToken),
                    getChatHistoryApi({ flowId: fid, chatId: cid, flowType: type, shareToken, apiVersion: effectiveApiVersion })
                ]);
                if (flowRes.status_code !== 200) {
                    error = getInitialChatError(flowRes);
                    const lostFlow = await getDeleteFlowApi(cid);
                    flowRes.data = {
                        id: lostFlow.data.flow_id,
                        name: lostFlow.data.flow_name,
                        logo: lostFlow.data.flow_logo,
                        flow_type: lostFlow.data.flow_type,
                    };
                }
                messages = msgRes.reverse();
                flowData = { ...normalizeFlowDescription(flowRes.data), isNew: !messages.length };
                break;
            case FLOW_TYPES.ASSISTANT:
                const [assistantRes, historyRes] = await Promise.all([
                    getAssistantDetailApi(fid, shareToken, false, effectiveApiVersion),
                    getChatHistoryApi({ flowId: fid, chatId: cid, flowType: type, shareToken, apiVersion: effectiveApiVersion })
                ]);
                if (assistantRes.status_code !== 200) {
                    error = getInitialChatError(assistantRes);
                    const lostFlow = await getDeleteFlowApi(cid);
                    assistantRes.data = {
                        name: lostFlow.data.flow_name,
                        logo: lostFlow.data.flow_logo,
                        flow_type: lostFlow.data.flow_type,
                    };
                }
                messages = historyRes.reverse();
                flowData = { ...normalizeFlowDescription(assistantRes.data), flow_type: FLOW_TYPES.ASSISTANT, isNew: !messages.length };
                break;
            default:
        }
        if (!flowData) return;
        const loadedFlow = flowData;
        setChats(prevChats => ({
            ...prevChats,
            [cid]: {
                flow: loadedFlow,
                messages,
                historyEnd: false
            }
        }));
        if (shareToken) {
            error = { code: '', data: null };
        }
        setRunningState((prev) => {
            return {
                ...prev,
                [cid]: {
                    running: false,
                    inputDisabled: !!error.code || numericType === FLOW_TYPES.WORK_FLOW,
                    error,
                    inputForm: numericType !== FLOW_TYPES.WORK_FLOW || null,
                    showUpload: numericType === FLOW_TYPES.WORK_FLOW,
                    showStop: false,
                    guideWord: flowData?.guide_question,
                    showReRun: false
                }
            };
        });
    };
    useEffect(() => {
        init();
    }, [cid]);
    if (!cid || !chatState?.flow)
        return null;
    return <ChatView data={chatState.flow} cid={cid} v={effectiveApiVersion} readOnly={readOnly} isGuestMode={isGuestMode}/>;
}
;
const useBuild = () => {
    const { showToast } = useToastContext();
    const [_, setTabsState] = useRecoilState(tabsState);
    async function streamNodeData(flow: any, chatId: string) {
        const res = await postBuildInit({ flow, chatId });
        const flowId = res.data.flowId;
        let validationResults: boolean[] = [];
        let finished = false;
        let buildEnd = false;
        const apiUrl = `${__APP_ENV__.BASE_URL}/api/v1/build/stream/${flowId}?chat_id=${chatId}`;
        const eventSource = new EventSource(apiUrl);
        eventSource.onmessage = (event) => {
            if (!event.data) {
                return;
            }
            const parsedData = JSON.parse(event.data);
            if (parsedData.end_of_stream) {
                eventSource.close();
                buildEnd = true;
                return;
            }
            else if (parsedData.log) {
            }
            else if (parsedData.input_keys) {
                setTabsState((old) => {
                    return {
                        ...old,
                        [flowId]: {
                            ...old[flowId],
                            formKeysData: parsedData,
                        },
                    };
                });
            }
            else {
                validationResults.push(parsedData.valid);
            }
        };
        eventSource.onerror = (error: any) => {
            buildEnd = true;
            console.error("EventSource failed:", error);
            eventSource.close();
        };
        while (!finished) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            finished = buildEnd;
        }
        return validationResults.every((result) => result);
    }
    async function enforceMinimumLoadingTime(startTime: number, minimumLoadingTime: number) {
        const elapsedTime = Date.now() - startTime;
        const remainingTime = minimumLoadingTime - elapsedTime;
        if (remainingTime > 0) {
            return new Promise((resolve) => setTimeout(resolve, remainingTime));
        }
    }
    async function handleBuild(flow: any, chatId: string) {
        try {
            const minimumLoadingTime = 200;
            const startTime = Date.now();
            await streamNodeData(flow, chatId);
            await enforceMinimumLoadingTime(startTime, minimumLoadingTime);
        }
        catch (error) {
            console.error("Error:", error);
        }
        finally {
        }
    }
    return handleBuild;
};
