// @ts-strict-ignore
import TipPng from "@/assets/tip.jpg";
import AppAvator from "@/components/bs-comp/cardComponent/avatar";
import { PermissionDialog } from "@/components/bs-comp/permission/PermissionDialog";
import { DelIcon, LoadIcon } from "@/components/bs-icons";
import { hasResourceAction, useResourceActions } from "@/components/bs-comp/permission/useResourceActions";
import { bsConfirm } from "@/components/bs-ui/alertDialog/useConfirm";
import { Badge } from "@/components/bs-ui/badge";
import { Button } from "@/components/bs-ui/button";
import ActionButton from "@/components/bs-ui/button/actionButton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/bs-ui/dialog";
import TextInput from "@/components/bs-ui/input/textInput";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/bs-ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/bs-ui/radio";
import { useToast } from "@/components/bs-ui/toast/use-toast";
import { darkContext } from "@/contexts/darkContext";
import { copyReportTemplate, createWorkFlowVersion, getVersionDetails, onlineWorkflow, onlineWorkflowApi, saveWorkflow, updateVersion } from "@/controllers/API/workflow";
import { captureAndAlertRequestErrorHoc } from "@/controllers/request";
import { usePendingAction } from "@/hooks/usePendingAction";
import { AppType } from "@/types/app";
import type { WorkFlow } from "@/types/flow";
import { flowVersionCompatible } from "@/util/flowCompatible";
import { importFlow } from "@/util/flowUtils";
import { cloneDeep } from "lodash-es";
import { ChevronLeft, EllipsisVertical, PencilLineIcon, Play, Shield, ShieldCheck } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import CreateApp from "../CreateApp";
import { ChatTest } from "./FlowChat/ChatTest";
import useFlowStore from "./flowStore";
import Notification from "./Notification";
import { useNodeEvent } from "./useNodeEvent";
import { useWorkflowVersions } from "./useWorkflowVersions";
import { useWorkflowLeaveGuard } from "./useWorkflowLeaveGuard";

const APP_HEADER_ACTIONS = [
    'edit',
    'publish',
    'unpublish',
    'manage_permission',
    'use',
]

interface WorkflowHeaderProps {
    flow: WorkFlow & { status?: number; logo?: string; viewUrl?: string };
    nodes: WorkFlow['nodes'];
    preFlow: string;
    onTabChange: (type: string) => void;
    onPreFlowChange: () => void;
    onImportFlow: (nodes: WorkFlow['nodes'], edges: WorkFlow['edges'], viewport: WorkFlow['viewport']) => void;
}

export function WorkflowHeader({ flow, nodes, onTabChange, preFlow, onPreFlowChange, onImportFlow }: WorkflowHeaderProps) {
    const { message } = useToast()
    const { dark } = useContext(darkContext);
    const testRef = useRef(null)
    const { pending: publishing, runAction: runPublication } = usePendingAction()
    const updateAppModalRef = useRef(null)
    // const { uploadFlow } = useFlowStore()
    const { t, i18n } = useTranslation('flow')
    const { t: tbs } = useTranslation('bs')
    const [modelVersionId, setModelVersionId] = useState(0)
    const navigate = useNavigate()
    const { state } = useLocation();
    const loca = state?.flow; // 获取传递的 flow 数据
    const flowId = flow?.id ? String(flow.id) : '';
    const { actions } = useResourceActions('workflow', flowId ? [flowId] : [], APP_HEADER_ACTIONS);
    const canEdit = flowId ? hasResourceAction(actions, flowId, 'edit') : false;
    const canPublish = flowId ? hasResourceAction(actions, flowId, 'publish') : false;
    const canUnpublish = flowId ? hasResourceAction(actions, flowId, 'unpublish') : false;
    const canRun = flowId ? hasResourceAction(actions, flowId, 'use') : false;
    /** 与构建列表卡片「权限」盾牌一致：所有者 / 管理者可管理应用成员与权限 */
    const canManage = flowId ? hasResourceAction(actions, flowId, 'manage_permission') : false;

    // console.log('flow :>> ', flow);

    const validateNodes = useNodeEvent(flow)
    const addNotification = useFlowStore((state) => state.addNotification);

    const handleRunClick = async () => {
        if (!canRun) return;
        // 记录错误日志
        const errors = await validateNodes()
        if (errors.length) {
            errors.map(el => addNotification({
                type: 'warning',
                title: '',
                description: el
            }))
            return message({
                description: errors,
                variant: 'warning'
            })
        }

        testRef.current?.run(flow)
    }

    const handleOnlineClick = async () => {
        if (!canPublish) return;
        const errors = await validateNodes()
        if (errors.length) {
            errors.map(el => addNotification({
                type: 'warning',
                title: '',
                description: el
            }))
            return message({
                description: errors,
                variant: 'warning'
            })
        }

        const saved = !canEdit || await captureAndAlertRequestErrorHoc(saveWorkflow(version.id, {
            ...flow,
            name: version.name,
            data: {
                nodes: flow.nodes,
                edges: flow.edges,
                viewport: flow.viewport
            }
        }))
        if (!saved) return
        setFlow({ ...flow })
        // api请求
        const res = await captureAndAlertRequestErrorHoc(onlineWorkflowApi({ flow_id: flow.id, version_id: version.id, status: 2 }))
        if (res === null) {
            message({
                variant: 'success',
                description: `${version?.name} ${t('hasBeenLaunched')}`
            })
            window.history.length > 1 ? window.history.back() : navigate('/build/apps')
        }
    }
    const handleOfflineClick = async () => {
        if (!canUnpublish) return;
        const res = await captureAndAlertRequestErrorHoc(onlineWorkflowApi({ flow_id: flow.id, version_id: version.id, status: 1 }))
        if (res === null) {
            message({
                variant: 'success',
                description: `${version?.name} ${t('hasBeenOffline')}`
            })

            flow.status = 1
            refrenshVersions()
        }
    }

    const handleSaveClick = async () => {
        if (!canEdit) return false;

        if (isOnlineVersionFun()) {
            message({
                description: t('currentVersionLaunched'),
                variant: 'warning'
            })
            return !hasChanged
        }
        // temp
        // localStorage.setItem('flow_tmp', JSON.stringify(flow))
        const res = await captureAndAlertRequestErrorHoc(saveWorkflow(version.id, {
            ...flow,
            name: version.name,
            data: {
                nodes: flow.nodes,
                edges: flow.edges,
                viewport: flow.viewport
            }
        }))
        res && message({
            variant: 'success',
            description: t('changesSaved')
        })

        return res
    }

    const handleExportClick = () => {
        setOpen(false)
        const nFlow = cloneDeep(flow)
        // 删除report节点文档key
        // nFlow.nodes.forEach(node => {
        //     if (node.data.type === 'report') {
        //         node.data.group_params[0].params[0].value.version_key = ''
        //     }
        // })
        const jsonString = `data:text/json;chatset=utf-8,${encodeURIComponent(
            JSON.stringify({ ...nFlow, source: location.host })
        )}`;
        const link = document.createElement("a");
        link.href = jsonString;
        link.download = `${flow.name || t('defaultWorkflowData')}.json`

        link.click();
    }

    const { toast } = useToast()
    const handleImportClick = () => {
        setOpen(false)
        bsConfirm({
            desc: t('confirmImport'),
            onOk(next) {
                _importFlow()
                next()
            }
        })

        const _importFlow = async () => {
            try {
                const flow = await importFlow()
                const newFlow = flowVersionCompatible(flow)
                const { nodes, edges, viewport } = newFlow
                onImportFlow(nodes, edges, viewport)
                setFitView()
            } catch (error) {
                console.error("Import flow error:", error);
                toast({
                    variant: 'error',
                    description: t('invalidFileError')
                })
            }
        }
    }

    const forceUpdateFlow = (_flow) => {
        setFlow(null)
        setTimeout(() => {
            setFlow(_flow)
        }, 0);
    }
    // versions
    const [loading, setLoading] = useState(false)
    const { flow: f, setFlow, setFitView } = useFlowStore()
    const { versions, version, lastVersionIndexRef, isOnlineVersion, isOnlineVersionFun, changeName, deleteVersion, refrenshVersions } = useWorkflowVersions(flow, canEdit)
    // 切换版本
    const handleChangeVersion = async (versionId) => {
        setLoading(true)
        // 切换版本UI
        window.flow_version = Number(versionId)
        // 加载选中版本data
        const res = await getVersionDetails(versionId)
        // 自动触发 page的 clone flow
        forceUpdateFlow({ ...f, ...res.data })

        message({
            variant: "success",
            title: t('switchToVersion', { versionName: res.name }),
            description: ""
        })
        setLoading(false)
        setFitView()
    }
    const [saveVersionId, setVersionId] = useState('')
    useEffect(() => {
        saveVersionId && handleChangeVersion(saveVersionId)
    }, [saveVersionId])
    // new version
    const handleSaveNewVersion = async () => {
        if (!canEdit) return;
        // 累加版本 vx ++
        const maxNo = lastVersionIndexRef.current + 1
        const { nodes, edges, viewport } = flow
        // 复制报告节点中报告模板
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            await copyReportTemplate(node.data)
        }
        const res = await captureAndAlertRequestErrorHoc(
            createWorkFlowVersion(flow.id, { name: `v${maxNo}`, description: '', data: { nodes, edges, viewport }, original_version_id: version.id })
        )
        message({
            variant: "success",
            title: `${t('skills.version', { ns: 'bs' })} v${maxNo} ${t('skills.saveSuccessful', { ns: 'bs' })}`,
            description: ""
        })
        // 更新版本列表
        await refrenshVersions()
        // 切换到最新版本

        setVersionId(res.id)
    }

    const [tabType, setTabType] = useState('edit')
    const [open, setOpen] = useState(false)
    // Save concurrency lock. A double-click used to launch two save pipelines,
    // each running forceUpdateFlow → unmount/remount → refrenshVersions. The
    // second refrenshVersions ran after window.flow_version was already
    // consumed (deleted) by the first, so it fell back to is_current===1 and
    // set the context version back to the online one while the flow store
    // still held the non-online version's data. Blocking re-entry fixes it.
    const savingRef = useRef(false)
    const [saving, setSaving] = useState(false)
    const [permDialogOpen, setPermDialogOpen] = useState(false)

    const {
        returnPage,
        blocker,
        hasChanged
    } = useWorkflowLeaveGuard(flow, nodes, preFlow, onPreFlowChange, canEdit)
    // 离开并保存
    const handleSaveAndClose = async () => {
        if (!canEdit) return blocker.proceed?.();
        if (isOnlineVersion) {
            handleSaveNewVersion()
            blocker.reset?.()
        } else {
            const res = await handleSaveClick()
            res ? blocker.proceed?.() : blocker.reset?.()
        }
    }

    return (
        <header className="flex justify-between items-center p-4 py-2 bisheng-bg border-b">
            {
                loading && <div className=" fixed left-0 top-0 w-full h-screen bg-background/60 z-50 flex items-center justify-center">
                    <LoadIcon className="mr-2 text-gray-600" />
                    <span>{t('switchToVersion', { versionName: version.name })}</span>
                </div>
            }
            {/* Left Section with Back Button and Title */}
            <div className="flex items-center">
                <Button variant="outline" size="icon" className={`${!dark && 'bg-[#fff]'} size-8`}
                    onClick={returnPage}
                ><ChevronLeft /></Button>
                <div className="flex items-center ml-5">
                    <AppAvator id={flow.name} url={flow.viewUrl || flow.logo || loca?.logo} flowType={10} className=""></AppAvator>
                    <div className="pl-3">
                        <h1 className="font-medium text-sm flex gap-2">
                            <span id="app-title" className="truncate max-w-48 font-bold">{flow.name}</span>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="size-6"
                                disabled={!canEdit}
                                onClick={() => updateAppModalRef.current?.edit(AppType.FLOW, flow)}>
                                <PencilLineIcon className="size-4 text-gray-500"></PencilLineIcon>
                            </Button>
                        </h1>
                        <div className="text-xs text-gray-500 mt-0.5">
                            <Badge variant="gray" className="font-light dark:bg-gray-950 dark:text-gray-400"><ShieldCheck size={14} />{t('currentVersion', { versionName: version?.name })}</Badge>
                        </div>
                    </div>
                </div>
            </div>
            <div>
                <Button variant="secondary" className={`${tabType === 'edit' ? 'bg-[#fff] dark:bg-gray-950 hover:bg-[#fff]/70 text-primary h-8"' : ''} h-8`}
                    onClick={() => { setTabType('edit'); onTabChange('edit') }}
                >
                    {t('processOrchestration')}
                </Button>
                {canEdit && <Button variant="secondary" className={`${tabType === 'api' ? 'bg-[#fff] dark:bg-gray-950 hover:bg-[#fff]/70 text-primary h-8"' : ''} h-8`}
                    onClick={() => {
                        setTabType('api');
                        onTabChange('api');
                        testRef.current.close()
                    }}>
                    {t('externalRelease')}
                </Button>}
            </div>
            {/* Right Section with Options */}
            <div className="header-right flex items-center gap-3">
                <Notification />
                <Button variant="outline" size="sm" className={`${!dark && 'bg-[#fff]'} h-8`} disabled={!canRun} onClick={handleRunClick}>
                    <Play className="size-3.5 mr-1" />
                    {t('run')}
                </Button>
                <Button variant="outline" size="sm" className={`${!dark && 'bg-[#fff]'} h-8 px-6`} disabled={!canEdit || saving} onClick={async () => {
                    if (!canEdit || savingRef.current) return
                    savingRef.current = true
                    setSaving(true)
                    try {
                        window.flow_version = Number(version.id)
                        await handleSaveClick()
                        forceUpdateFlow({ ...flow }) // 更新flow状态, 用于保存时对比差异
                    } finally {
                        // forceUpdateFlow unmounts this component, so these
                        // writes may hit the outgoing instance — that's fine;
                        // the remount initialises fresh ref/state.
                        savingRef.current = false
                        setSaving(false)
                    }
                }}>
                    {t('save')}
                </Button>
                {
                    version && <ActionButton
                        size="sm"
                        disabled={!canEdit}
                        className={`px-6 flex gap-2 ${!dark && 'bg-[#fff]'}`}
                        iconClassName={`${!dark && 'bg-[#fff]'}`}
                        align="end"
                        variant="outline"
                        onClick={handleSaveNewVersion}
                        delayDuration={200}
                        buttonTipContent={(
                            <div>
                                <img src={TipPng} alt="" className="w-80" />
                                <p className="mt-4 text-sm">{t('skills.supportVersions', { ns: 'bs' })}</p>
                            </div>
                        )}
                        dropDown={(
                            <div className=" overflow-y-auto max-h-96 max-h">
                                <RadioGroup value={version.id + ''} onValueChange={(vid) => {
                                    if (!canEdit) {
                                        handleChangeVersion(vid)
                                        return
                                    }
                                    if (isOnlineVersionFun() && hasChanged) return setModelVersionId(vid)
                                    const { edges, nodes, viewport } = flow
                                    updateVersion(version.id, {
                                        name: version.name, description: '', data: {
                                            edges, nodes, viewport
                                        }
                                    })
                                    handleChangeVersion(vid)
                                }} className="gap-0">
                                    {versions.map((vers, index) => (
                                        <div key={vers.id} className="group flex items-center gap-4 px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 border-b">
                                            <RadioGroupItem value={vers.id + ''} />
                                            <div className="w-[198px]">
                                                {canEdit ? <TextInput
                                                    className="h-[30px]"
                                                    type="hover"
                                                    value={vers.name}
                                                    maxLength={30}
                                                    onSave={val => changeName(vers.id, val || vers.name)}
                                                ></TextInput> : <span className="text-sm">{vers.name}</span>}
                                                <p className="text-sm text-muted-foreground mt-2">{vers.update_time.replace('T', ' ').substring(0, 16)}</p>
                                            </div>
                                            {
                                                // 最后一个 V0 版本和当前选中版本不允许删除
                                                canEdit && !(version.id === vers.id)
                                                && <Button
                                                    className="group-hover:flex hidden"
                                                    type="button"
                                                    size="icon"
                                                    variant="outline"
                                                    onClick={() => deleteVersion(vers, index)}
                                                ><DelIcon /></Button>
                                            }
                                        </div>
                                    ))}
                                </RadioGroup>
                            </div>
                        )}
                    >{t('skills.saveVersion', { ns: 'bs' })}</ActionButton>
                }
                {isOnlineVersion
                    ? (canUnpublish ? (
                        <Button size="sm" className="h-8 px-6" disabled={publishing} aria-busy={publishing} onClick={() => runPublication(handleOfflineClick)}>
                            {t('takeOffline')}
                        </Button>
                    ) : null)
                    : (canPublish ? (
                        <Button size="sm" className="h-8 px-6" disabled={publishing} aria-busy={publishing} onClick={() => runPublication(handleOnlineClick)}>
                            {t('goOnline')}
                        </Button>
                    ) : null)}
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild >
                        <Button size="icon" variant="outline" aria-label={tbs('more')} className={`${!dark && 'bg-[#fff]'} size-8`}>
                            <EllipsisVertical size={16} />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-2 cursor-pointer">
                        <div
                            className="rounded-sm py-1.5 pl-2 pr-8 text-sm hover:bg-[#EBF0FF] dark:text-gray-50 dark:hover:bg-gray-700"
                            onClick={handleImportClick}>{t('importWorkflow')}</div>
                        <div
                            className="rounded-sm py-1.5 pl-2 pr-8 text-sm hover:bg-[#EBF0FF] dark:text-gray-50 dark:hover:bg-gray-700"
                            onClick={handleExportClick}> {t('exportWorkflow')}</div>
                        {canManage && (
                            <div
                                className="flex items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm hover:bg-[#EBF0FF] dark:text-gray-50 dark:hover:bg-gray-700"
                                onClick={() => {
                                    setOpen(false)
                                    setPermDialogOpen(true)
                                }}
                            >
                                <Shield className="h-4 w-4 shrink-0" />
                                {tbs('build.authorizationManagement')}
                            </div>
                        )}
                    </PopoverContent>
                </Popover>
            </div>
            <ChatTest ref={testRef} />
            {/* 修改应用弹窗 flow&assistant */}
            <CreateApp ref={updateAppModalRef} loca={loca} onSave={(base) => {
                if (!canEdit) return;
                captureAndAlertRequestErrorHoc(onlineWorkflow({
                    ...f,
                    ...base,
                    logo: base.viewUrl ? base.logo : '' // When there is no change, the value is empty 
                }).then(res => {
                    f.name = base.name
                    f.description = base.description
                    f.logo = base.logo
                    setFlow({ ...f, ...base })
                }))
            }} />
            {/* 上线不可修改提示 */}
            <Dialog open={!!modelVersionId}>
                <DialogContent className="sm:max-w-[425px]" close={false}>
                    <DialogHeader>
                        <DialogTitle>{t('prompt')}</DialogTitle>
                        <DialogDescription>{t('currentVersionLaunched')}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-4">
                        <Button className="h-8" onClick={() => {
                            handleSaveNewVersion()
                            setModelVersionId(0)
                        }}>
                            {t('saveAsNewVersion')}
                        </Button>
                        <Button className="leave h-8" variant="destructive" onClick={() => {
                            handleChangeVersion(modelVersionId)
                            setModelVersionId(0)
                        }}>
                            {t('dontSaveAndSwitch')}
                        </Button>
                        <Button className="h-8" variant="outline" onClick={() => setModelVersionId(0)}>
                            {t('cancel')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {/* 离开并保存提示 */}
            <Dialog open={blocker.state === "blocked"}>
                <DialogContent className="sm:max-w-[425px]" close={false}>
                    <DialogHeader>
                        <DialogTitle>{t('prompt')}</DialogTitle>
                        <p className="bisheng-label pt-2">{isOnlineVersion ? t('onlineVersionMessage') : t('unsavedChangesMessage')}</p>
                    </DialogHeader>
                    <DialogFooter>
                        <Button className="leave h-8" onClick={handleSaveAndClose}>
                            {isOnlineVersion ? t('saveAsNewVersion') : t('leaveAndSave')}
                        </Button>
                        <Button className="h-8" variant="destructive" onClick={() => blocker.proceed?.()}>
                            {t('dontSave')}
                        </Button>
                        <Button className="h-8" variant="outline" onClick={() => {
                            const dom = document.getElementById("flow-page") as HTMLElement;
                            blocker.reset?.()
                            if (dom) dom.className = dom.className.replace('report-hidden', '');
                        }}>
                            {t('cancel')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {flowId && canManage ? (
                <PermissionDialog
                    open={permDialogOpen}
                    onOpenChange={setPermDialogOpen}
                    resourceType="workflow"
                    resourceId={flowId}
                    resourceName={flow?.name || ""}
                />
            ) : null}
        </header >
    );
};
