// @ts-strict-ignore
import ApiMainPage from "@/components/bs-comp/apiComponent";
import { useMessageStore } from "@/components/bs-comp/chatComponent/messageStore";
import { hasResourceAction, useResourceActions } from "@/components/bs-comp/permission/useResourceActions";
import { Button } from "@/components/bs-ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/bs-ui/dialog";
import { useToast } from "@/components/bs-ui/toast/use-toast";
import { changeAssistantStatusApi, getAssistantDetailApi, saveAssistanttApi } from "@/controllers/API/assistant";
import { captureAndAlertRequestErrorHoc } from "@/controllers/request";
import { useAssistantStore } from "@/store/assistantStore";
import { OnlineState } from "@/types/flow";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { unstable_useBlocker as useBlocker, useNavigate, useParams } from "react-router-dom";
import Header from "./Header";
import { AssistantPrompt } from "./Prompt";
import Setting from "./Setting";
import TestChat from "./TestChat";

export function EditAssistantPage() {
    const { t } = useTranslation()
    const { id: assisId } = useParams()
    const navigate = useNavigate()
    const { state } = useLocation();
    const loca = state?.flow; // Get the passed flow data

    // assistant data
    const { assistantState, changed, setAssistantDetail, changeStatus, saveAfter, destroy } = useAssistantStore()
    const { startNewRound, insetSystemMsg, insetBsMsg, destory, setShowGuideQuestion } = useMessageStore()
    const [checking, setChecking] = useState(true)
    const assistantId = assisId ? String(assisId) : ''
    const { actions, loading: actionsLoading } = useResourceActions('assistant', assistantId ? [assistantId] : [], ['edit', 'publish', 'unpublish'])
    const canEdit = assistantId ? hasResourceAction(actions, assistantId, 'edit') : false

    useEffect(() => {
        let disposed = false
        setChecking(true)
        captureAndAlertRequestErrorHoc(getAssistantDetailApi(assisId, 'v1')).then((res) => {
            if (disposed || !res) return
            setAssistantDetail(res)
            setChecking(false)
            setShowGuideQuestion(true)
            setGuideQuestion(res.guide_question?.filter((item) => item) || [])
            res.guide_word && insetBsMsg(res.guide_word)
        })
        return () => { disposed = true; destroy() }
    }, [assisId, destroy, setAssistantDetail, setShowGuideQuestion, insetBsMsg])

    // Store displayed guide words independently
    const [guideQuestion, setGuideQuestion] = useState([])
    const [openChat, setOpenChat] = useState(true)
    const handleStartChat = async (save) => {
        if (!handleCheck()) return
        if (save && !canEdit) return
        if (save && !(await handleSave(true))) return
        destory()
        setOpenChat(false)
        await new Promise((resolve) => setTimeout(resolve, 0))
        saveAfter()
        startNewRound(t('build.configurationUpdated'))
        setGuideQuestion(assistantState.guide_question.filter((item) => item))
        assistantState.guide_word && insetBsMsg(assistantState.guide_word)
        setOpenChat(true)
    }

    const { message, toast } = useToast()
    // Save assistant details
    const handleSave = async (showMessage = false) => {
        if (!canEdit || !handleCheck()) return false
        const res = await captureAndAlertRequestErrorHoc(saveAssistanttApi({
            ...assistantState,
            flow_list: assistantState.flow_list.map(item => item.id),
            tool_list: assistantState.tool_list.map(item => item.id),
            knowledge_list: assistantState.knowledge_list.map(item => item.id),
            guide_question: assistantState.guide_question.filter((item) => item),
            logo: assistantState.viewLogo ? assistantState.logo : '',
        }))
        if (!res) return false
        showMessage && message({
            title: t('prompt'),
            variant: 'success',
            description: t('skills.saveSuccessful')
        })
        saveAfter()
        return true
    }

    // Publish assistant online
    const handleOnline = async (online: boolean) => {
        if (!hasResourceAction(actions, assistantId, online ? 'publish' : 'unpublish')) return
        if (online) {
            if (canEdit && !(await handleSave())) return
            const res = await captureAndAlertRequestErrorHoc(changeAssistantStatusApi(assistantState.id, 2))
            if (res !== null) return
            changeStatus(2)
            message({
                title: t('prompt'),
                variant: 'success',
                description: t('skills.onlineSuccessful')
            })
            navigate('/build')
        } else {
            const res = await captureAndAlertRequestErrorHoc(changeAssistantStatusApi(assistantState.id, 1))
            if (res === null) changeStatus(1)
        }
    }

    // Validate assistant data
    const handleCheck = () => {
        const errors = []
        if (
            assistantState.max_token === undefined ||
            !Number.isInteger(assistantState.max_token) ||
            assistantState.max_token < 0 ||
            assistantState.max_token > 100 * 10000
        ) {
            errors.push(t('skills.chatHistoryMaxToken'));
        }
        if (!assistantState.model_name) {
            errors.push(t('build.modelRequired'))
        }
        if (assistantState.guide_question.some(que => que.length > 50)) {
            errors.push(t('skills.guideQuestions50'))
        }
        if (assistantState.guide_word.length > 1000) {
            errors.push(t('skills.promptWords1000'))
        }

        if (errors.length) {
            message({
                title: t('prompt'),
                variant: 'error',
                description: errors
            })
            return false
        }
        return true
    }

    const [showApiPage, setShowApiPage] = useState(false)
    // Save on leave
    const blocker = useBeforeUnload(changed && canEdit, checking || !canEdit)
    const handleSaveAndClose = async () => {
        if (!canEdit) return blocker.reset?.()
        if (await handleSave(true)) blocker.proceed?.()
    }

    if (checking || actionsLoading) return null

    return <div className="bg-background-main">
        <Header loca={loca} canEdit={canEdit} onSave={() => handleSave(true)} onLine={handleOnline} onTabChange={(t) => setShowApiPage(t === 'api')}></Header>
        <div className="h-[calc(100vh-70px-var(--license-banner-h,0px))]">
            <div className={`flex h-full ${showApiPage ? 'hidden' : ''}`}>
                <div className="w-[60%]">
                    <div className="text-md font-medium leading-none p-4 shadow-sm">{t('build.assistantConfiguration')}</div>
                    <div className="flex h-[calc(100vh-120px-var(--license-banner-h,0px))]">
                        <AssistantPrompt canEdit={canEdit} />
                        <Setting></Setting>
                    </div>
                </div>
                <div className="w-[40%] h-full bg-[#fff] dark:bg-background-main relative">
                    {openChat && <TestChat guideQuestion={guideQuestion} assisId={assisId} onClear={() => handleStartChat(false)}></TestChat>}
                    {/* Mask button triggered by changes to save */}
                    {changed && canEdit && <div className="absolute w-full bottom-0 h-60" onClick={() => handleStartChat(true)}></div>}
                </div>
            </div>
            <div className={`h-full ${showApiPage ? '' : 'hidden'}`}>
                <ApiMainPage />
            </div>
        </div>
        <Dialog open={blocker.state === "blocked"}>
            <DialogContent className="sm:max-w-[425px]" close={false}>
                <DialogHeader>
                    <DialogTitle>{t('prompt')}</DialogTitle>
                    <DialogDescription>{assistantState.status === OnlineState.OnLine ? t('build.assistantOnlineNoEdit') : t('build.unsavedChangesLeave')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    {
                        assistantState.status !== OnlineState.OnLine && <Button className="leave h-8" onClick={handleSaveAndClose}>
                            {t('build.leaveAndSave')}
                        </Button>
                    }
                    <Button className="h-8" variant="destructive" onClick={() => blocker.proceed?.()}>
                        {t('build.leaveWithoutSave')}
                    </Button>
                    <Button className="h-8" variant="outline" onClick={() => {
                        blocker.reset?.()
                    }}>
                        {t('cancel')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </div>
};


// Save prompt when leaving page
const useBeforeUnload = (changed, checking) => {
    const { t } = useTranslation()

    // Prompt to save when leaving
    useEffect(() => {
        if (checking) return // Don't prompt when checking permissions
        const fun = (e) => {
            const confirmationMessage = `${t('flow.unsavedChangesConfirmation')}`;
            (e || window.event).returnValue = confirmationMessage; // Compatible with different browsers
            return confirmationMessage;
        }
        window.addEventListener('beforeunload', fun);
        return () => { window.removeEventListener('beforeunload', fun) }
    }, [checking])

    return useBlocker(changed);
}
