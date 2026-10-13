import { getFlowApi } from "@/controllers/API/flow";
import { captureAndAlertRequestErrorHoc } from "@/controllers/request";
import { flowVersionCompatible } from "@/util/flowCompatible";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import Panne from "./Panne";
import useFlowStore from "./flowStore";

export function FlowPage() {
    const { id = '' } = useParams();
    const { flow, setFlow, clearRunCache, clearNotifications } = useFlowStore();
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        let disposed = false;
        setChecking(true);
        captureAndAlertRequestErrorHoc(getFlowApi(id)).then(result => {
            if (disposed || !result) return;
            const { data, ...metadata } = result;
            clearRunCache();
            setFlow({
                ...metadata,
                nodes: data?.nodes ?? [],
                edges: data?.edges ?? [],
                viewport: data?.viewport ?? { x: 0, y: 0, zoom: 1 },
            });
            setChecking(false);
        });
        return () => {
            disposed = true;
            setFlow(null);
            clearRunCache();
            clearNotifications();
        };
    }, [id, setFlow, clearRunCache, clearNotifications]);

    const normalized = useMemo(() => flow?.id === id ? flowVersionCompatible(flow) : null, [flow, id]);
    if (checking || !normalized) return null;
    return <div className="flow-page-positioning">
        <Panne flow={normalized} preFlow={JSON.stringify(normalized)} />
    </div>;
}
