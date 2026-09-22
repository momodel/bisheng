/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/hooks/useAppSidebar.ts. Edit this copy for custom chat.
import i18n from "~/locales/i18n";
import { lessonPlanSearch } from '~/customizations/lessonPlan/lessonPlanUtils';
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "recoil";
import { NotificationSeverity } from "~/common";
import type { AppConversation, AppItem, ConversationGroup } from "~/@types/app";
import { getAppConversationsApi, getAssistantDetailApi, getFlowApi } from "~/api/apps";
import { groupConversationsByTime, getAppShareUrl } from "~/pages/apps/appUtils";
import { copyText, generateUUID } from "~/utils";
import { useToastContext } from "~/Providers";
import { appConversationsState, currentAppInfoState, sidebarVisibleState, } from "~/customizations/agentChat/store/appSidebarAtoms";
import { currentChatState } from "~/customizations/agentChat/store/atoms";
import { copyAppChatOrigin, copyAppChatReturnTo } from "~/customizations/agentChat/appChatOrigin";
import { useLocalize } from "~/hooks";
const FLOW_TYPE_ASSISTANT = 5;
export function useAppSidebar() {
    const navigate = useNavigate();
    const location = useLocation();
    const localize = useLocalize();
    const { fid: flowId, type: flowType, conversationId } = useParams();
    const { showToast } = useToastContext();
    const showToastRef = useRef(showToast);
    showToastRef.current = showToast;
    const currentApp = useRecoilValue(currentAppInfoState);
    const chatState = useRecoilValue(currentChatState);
    const setCurrentApp = useSetRecoilState(currentAppInfoState);
    const [conversations, setConversations] = useRecoilState(appConversationsState);
    const [sidebarVisible, setSidebarVisible] = useRecoilState(sidebarVisibleState);
    const [loading, setLoading] = useState(false);
    const hadConversationsRef = useRef(false);
    const fetchConversations = useCallback(async (): Promise<AppConversation[]> => {
        if (!flowId)
            return [];
        setLoading(true);
        try {
            const res: any = await getAppConversationsApi(flowId, 1, 100);
            const list: AppConversation[] = (res.data?.list || []).map((item: any) => {
                return {
                    id: item.chat_id,
                    title: item.name || item.flow_name || i18n.t("com_ui_new_chat"),
                    flowId: item.flow_id || flowId,
                    flowType: Number(item.flow_type || flowType),
                    updatedAt: item.update_time || '',
                    createdAt: item.create_time || '',
                };
            });
            setConversations(list);
            if (list.length === 0 && hadConversationsRef.current) {
                showToastRef.current?.({ message: i18n.t("com_app.custom_history_deleted"), severity: NotificationSeverity.ERROR });
            }
            hadConversationsRef.current = list.length > 0;
            return list;
        }
        catch {
            console.error('Failed to fetch app conversations');
            return [];
        }
        finally {
            setLoading(false);
        }
    }, [flowId, flowType, setConversations]);
    const groups: ConversationGroup[] = groupConversationsByTime(conversations);
    const createNewChat = useCallback(() => {
        if (!flowId || !flowType)
            return;
        const chatId = generateUUID(32);
        if (conversationId)
            copyAppChatOrigin(conversationId, chatId);
        if (conversationId)
            copyAppChatReturnTo(conversationId, chatId);
        setConversations((prev) => [{
                id: chatId,
                title: localize('com_ui_new_chat'),
                flowId: flowId,
                flowType: Number(flowType),
                updatedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
            }, ...prev]);
        const nextPath = `/custom-app/${chatId}/${flowId}/${flowType}${lessonPlanSearch(flowId, location.search)}`;
        navigate(nextPath, { state: location.state });
    }, [flowId, flowType, conversationId, location.state, location.search, navigate, setConversations, localize]);
    const switchConversation = useCallback((conv: AppConversation) => {
        const nextPath = `/custom-app/${conv.id}/${conv.flowId}/${conv.flowType}${lessonPlanSearch(conv.flowId, location.search)}`;
        navigate(nextPath, { state: location.state });
    }, [location.state, location.search, navigate]);
    const toggleSidebar = useCallback(() => {
        setSidebarVisible((prev) => !prev);
    }, [setSidebarVisible]);
    const shareApp = useCallback(async () => {
        if (!flowId)
            return;
        const fromChat = chatState?.flow && String(chatState.flow.id) === String(flowId) ? chatState.flow.can_share : undefined;
        const fromSidebar = currentApp && String(currentApp.id) === String(flowId) ? currentApp.can_share : undefined;
        if (fromChat !== true && fromSidebar !== true)
            return;
        const url = getAppShareUrl(flowId, flowType || '');
        try {
            await copyText(url);
            showToast?.({ message: i18n.t("com_app_share_link_copied"), severity: NotificationSeverity.SUCCESS });
        }
        catch {
            showToast?.({ message: i18n.t("com_app_share_link_copy_failed"), severity: NotificationSeverity.ERROR });
        }
    }, [flowId, flowType, showToast, chatState?.flow, currentApp]);
    const hasAutoSelectedRef = useRef<string | null>(null);
    useEffect(() => {
        if (!flowId || !flowType)
            return;
        const numericType = Number(flowType);
        (async () => {
            try {
                const res = numericType === FLOW_TYPE_ASSISTANT
                    ? await getAssistantDetailApi(flowId, undefined, true)
                    : await getFlowApi(flowId, 'v1', undefined, true);
                if (res?.status_code !== 200)
                    return;
                const data = res.data;
                if (!data)
                    return;
                setCurrentApp({
                    id: data.id ?? flowId,
                    name: data.name ?? '',
                    description: data.description ?? data.desc ?? '',
                    logo: data.logo ?? '',
                    flow_type: Number(data.flow_type ?? numericType),
                    user_id: data.user_id ?? '',
                    can_share: data.can_share === true,
                } as AppItem);
            }
            catch {
            }
        })();
    }, [flowId, flowType, setCurrentApp]);
    useEffect(() => {
        fetchConversations().then((list) => {
            if (hasAutoSelectedRef.current === flowId)
                return;
            hasAutoSelectedRef.current = flowId!;
            if (conversationId && !list.some(c => c.id === conversationId)) {
                setConversations((prev) => [{
                        id: conversationId,
                        title: localize('com_ui_new_chat'),
                        flowId: flowId!,
                        flowType: Number(flowType),
                        updatedAt: new Date().toISOString(),
                        createdAt: new Date().toISOString(),
                    }, ...prev]);
            }
        });
    }, [fetchConversations]);
    return {
        currentApp,
        conversations,
        groups,
        loading,
        activeConversationId: conversationId,
        sidebarVisible,
        fetchConversations,
        createNewChat,
        switchConversation,
        toggleSidebar,
        shareApp,
    };
}
