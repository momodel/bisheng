import type { WorkFlow } from "@/types/flow";
import { isEqual } from "lodash-es";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { unstable_useBlocker as useBlocker, useNavigate } from "react-router-dom";

export function useWorkflowLeaveGuard(
    flow: WorkFlow, nodes: WorkFlow['nodes'], preFlow: string, onPreFlowChange: () => void, canEdit: boolean,
) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    useEffect(() => {
        if (!canEdit) return;
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = t('flow.unsavedChangesConfirmation');
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [canEdit, t]);
    const hasChanged = useMemo(() => {
        if (!flow) return false;
        try {
            const previous = JSON.parse(preFlow) as WorkFlow | null;
            if (!previous) return true;
            return !(isEqual(flow.edges, previous.edges)
                && nodes.length === previous.nodes.length
                && nodes.every((node, index) => isEqual(node.data, previous.nodes[index]?.data)));
        } catch {
            return true;
        }
    }, [preFlow, nodes, flow]);
    const isReturningRef = useRef(false);
    const handleReturn = () => {
        if (!canEdit) {
            if (window.history.length > 1) window.history.back();
            else navigate('/build/apps');
            return;
        }
        onPreFlowChange();
        isReturningRef.current = true;
    };
    useEffect(() => {
        if (!isReturningRef.current) return;
        isReturningRef.current = false;
        if (window.history.length > 1) window.history.back();
        else navigate('/build/apps');
    }, [nodes, navigate]);
    return { returnPage: handleReturn, blocker: useBlocker(canEdit && hasChanged), hasChanged };
}
