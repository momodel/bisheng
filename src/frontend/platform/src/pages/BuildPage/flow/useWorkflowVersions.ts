import { bsConfirm } from "@/components/bs-ui/alertDialog/useConfirm";
import { TabsContext } from "@/contexts/tabsContext";
import { deleteVersion, getWorkFlowVersions, updateVersion } from "@/controllers/API/workflow";
import { captureAndAlertRequestErrorHoc } from "@/controllers/request";
import type { FlowVersionItem, WorkFlow } from "@/types/flow";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function useWorkflowVersions(flow: WorkFlow & { status?: number }, canEdit: boolean) {
    const { t } = useTranslation();
    const [versions, setVersions] = useState<FlowVersionItem[]>([]);
    const { version, setVersion } = useContext(TabsContext);
    const [onlineVid, setOnlineVid] = useState(0);
    const lastVersionIndexRef = useRef(0);
    const refrenshVersions = useCallback(async () => {
        const { data, total } = await getWorkFlowVersions(flow.id);
        setVersions(data);
        lastVersionIndexRef.current = total - 1;
        const versionWindow = window as Window & { flow_version?: number };
        const currentVid = versionWindow.flow_version;
        delete versionWindow.flow_version;
        setVersion(data.find(item => currentVid ? item.id === currentVid : item.is_current === 1) ?? null);
        setOnlineVid(flow.status === 2 ? data.find(item => item.is_current === 1)?.id ?? 0 : 0);
    }, [flow.id, flow.status, setVersion]);

    useEffect(() => { void captureAndAlertRequestErrorHoc(refrenshVersions()); }, [refrenshVersions]);

    const handleChangeName = async (id: number, name: string) => {
        if (!canEdit) return;
        const result = await captureAndAlertRequestErrorHoc(updateVersion(String(id), { name, description: '', data: null }));
        if (result !== false && result !== undefined) setVersions(items => items.map(item => item.id === id ? { ...item, name } : item));
    };
    const handleDeleteVersion = (selected: FlowVersionItem, index: number) => {
        if (!canEdit) return;
        bsConfirm({
            title: t('prompt'),
            desc: `${t('skills.deleteOrNot')} ${selected.name} ${t('skills.version')}?`,
            onOk: (next) => {
                void captureAndAlertRequestErrorHoc(deleteVersion(String(selected.id))).then(result => {
                    if (result === null) setVersions(items => items.filter((_, itemIndex) => itemIndex !== index));
                });
                next();
            },
        });
    };
    return {
        versions, version, lastVersionIndexRef, refrenshVersions,
        isOnlineVersion: version?.id === onlineVid,
        isOnlineVersionFun: () => version?.id === onlineVid,
        changeName: handleChangeName,
        deleteVersion: handleDeleteVersion,
    };
}
