// Frontend fork of pages/appChat/hooks/useAppSwitcher.ts. Edit this copy for custom chat.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { AppItem } from "~/@types/app";
import { getAllAccessibleAppsApi } from "~/api/apps";
import { generateUUID } from "~/utils";
export function useAppSwitcher() {
    const navigate = useNavigate();
    const location = useLocation();
    const { fid: currentFlowId } = useParams();
    const [allApps, setAllApps] = useState<AppItem[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const fetchApps = useCallback(async () => {
        setLoading(true);
        try {
            const res: any = await getAllAccessibleAppsApi({ limit: 200 });
            setAllApps(res.list || []);
        }
        catch {
            console.error('Failed to fetch accessible apps');
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        if (allApps.length === 0) {
            fetchApps();
        }
    }, [allApps.length, fetchApps]);
    const filteredApps = useMemo(() => {
        if (!searchQuery)
            return allApps;
        const q = searchQuery.toLowerCase();
        return allApps.filter((a) => a.name.toLowerCase().includes(q));
    }, [allApps, searchQuery]);
    const disabled = allApps.length <= 1;
    const switchApp = useCallback((app: AppItem) => {
        setOpen(false);
        setSearchQuery('');
        const navOpts = { state: location.state };
        if (app.last_chat_id) {
            navigate(`/custom-app/${app.last_chat_id}/${app.id}/${app.flow_type}`, navOpts);
        }
        else {
            const chatId = generateUUID(32);
            navigate(`/custom-app/${chatId}/${app.id}/${app.flow_type}`, navOpts);
        }
    }, [location.state, navigate]);
    return {
        allApps: filteredApps,
        searchQuery,
        setSearchQuery,
        loading,
        open,
        setOpen,
        disabled,
        currentFlowId,
        switchApp,
    };
}
