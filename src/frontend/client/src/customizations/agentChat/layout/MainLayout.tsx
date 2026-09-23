/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of layouts/MainLayout.tsx. Edit this copy for custom chat.
import i18n from "~/locales/i18n";
import Cookies from "js-cookie";
import { getBysConfigApi } from "~/api/apps";
import { Filled, Outlined } from "bisheng-icons";
import { X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import KeepAlive from "react-activation";
import { matchPath, NavLink, useLocation, useOutlet } from "react-router-dom";
import { useRecoilState } from "recoil";
import { usePrefersMobileLayout, useScrollRevealRef } from "~/hooks";
import { bishengConfState } from "~/customizations/agentChat/store/atoms";
import { useGetBsConfig } from "~/hooks/queries/data-provider";
import { useAuthContext, useLocalize, useWorkbenchMenuNames } from "~/hooks";
import { Button } from "~/components/ui/Button";
import { LoadingIcon } from "~/components/ui/icon/Loading";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/Dialog";
import store from "~/store";
const systemNoticeTodayKey = () => {
    const d = new Date();
    return `system_notice_shown_${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
import { cn } from "~/utils";
import { getPlatformAdminPanelUrl } from "~/utils/platformAdminUrl";
import { canOpenWorkbench, canShowPlatformAdminEntry } from "~/utils/platformAccess";
import { UserPopMenu } from "~/layouts/UserPopMenu";
import WorkbenchAccessGuard from "~/layouts/WorkbenchAccessGuard";
import { CUSTOM_CHAT_VISIBILITY } from "~/customizations/agentChat/customChatVisibility";
import { appsSectionLinkTarget, lastSectionPaths } from "~/customizations/agentChat/layout/appModuleNavPaths";
interface SidebarItemProps {
    icon: React.ReactNode;
    activeIcon?: React.ReactNode;
    to: string;
    active: boolean;
    label: string;
    showLabel?: boolean;
    onNavigate?: () => void;
}
function SidebarItem({ icon, activeIcon, to, active, label, showLabel = false, onNavigate }: SidebarItemProps) {
    const location = useLocation();
    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
        onNavigate?.();
        if (to === location.pathname) {
            event.preventDefault();
        }
    };
    return (<NavLink to={to} onClick={handleClick} className={cn('flex cursor-pointer rounded-lg transition-colors hover:bg-fill-2', showLabel
            ? 'mx-2 h-[44px] items-center justify-start gap-2 px-2 py-2'
            : 'w-14 flex-col items-center justify-center gap-0.5 py-2')}>
      {React.cloneElement((active && activeIcon ? activeIcon : icon) as React.ReactElement, {
            className: cn(showLabel ? 'size-4' : 'size-5', active ? 'text-blue-500' : 'text-text-3'),
        })}
      {showLabel ? (<span className={cn('text-[14px] leading-[20px]', active ? 'text-blue-500' : 'text-text-1')}>
          {label}
        </span>) : (<span className={cn('max-w-full break-words text-center text-caption-sm', active ? 'font-medium text-blue-500' : 'text-text-3')}>
          {label}
        </span>)}
    </NavLink>);
}
function Sidebar({ mobileSidebarOpen, onCloseMobileApps, overlay = false, }: {
    mobileSidebarOpen: boolean;
    onCloseMobileApps?: () => void;
    overlay?: boolean;
}) {
    const { pathname, search } = useLocation();
    const menuUnavailablePlugin = pathname.startsWith('/menu-unavailable')
        ? new URLSearchParams(search).get('plugin') || ''
        : '';
    const { data: bsConfig } = useGetBsConfig();
    const { user, logout } = useAuthContext();
    const localize = useLocalize();
    const menuNames = useWorkbenchMenuNames();
    const [langcode, setLangcode] = useRecoilState(store.lang);
    const isMobile = usePrefersMobileLayout();
    const isChatSection = /^\/(c|linsight)(\/|$)/.test(pathname);
    const isAppSection = pathname.includes('/apps') || pathname.includes('/custom-app/');
    const showExpandedHubSidebar = isMobile && isAppSection && overlay;
    const plugins: string[] | null = Array.isArray((user as any)?.plugins)
        ? ((user as any)?.plugins as string[])
        : null;
    const canOpenWorkbenchEntry = useMemo(() => !Array.isArray(plugins) ||
        canOpenWorkbench({
            role: user?.role,
            plugins,
            is_department_admin: (user as {
                is_department_admin?: boolean;
            } | undefined)
                ?.is_department_admin,
        }), [plugins, user]);
    const menuApprovalMode = Boolean((user as {
        menu_approval_mode_workbench?: boolean;
        menu_approval_mode?: boolean;
    })
        ?.menu_approval_mode_workbench
        ?? (user as {
            menu_approval_mode?: boolean;
        })?.menu_approval_mode);
    const hasPlugin = (id: string) => (plugins ? plugins.includes(id) : true);
    const showWorkbenchItem = (id: string) => hasPlugin(id) || menuApprovalMode;
    const showSubscriptionTab = showWorkbenchItem('subscription');
    const showKnowledgeSpaceTab = showWorkbenchItem('knowledge_space');
    const showHomeTab = showWorkbenchItem('home');
    const showAppsTab = showWorkbenchItem('apps');
    const showAdminEntry = canShowPlatformAdminEntry({
        role: user?.role,
        plugins,
        is_department_admin: user?.is_department_admin,
        has_admin_console: user?.has_admin_console,
    });
    const links = useMemo<Array<{
        section: 'home' | 'apps' | 'channel' | 'knowledge';
        to: string;
        icon: React.ReactNode;
        label: string;
        isActive: boolean;
        closeDrawerOnNavigate?: boolean;
    }>>(() => {
        if (!canOpenWorkbenchEntry)
            return [];
        return [
            {
                section: 'home' as const,
                to: hasPlugin('home') || !menuApprovalMode ? (lastSectionPaths.home || '/c/new') : '/menu-unavailable?plugin=home',
                icon: <Outlined.Home />,
                activeIcon: <Filled.Home />,
                label: menuNames.home,
                isActive: /^\/(c|linsight)(\/|$)/.test(pathname) || menuUnavailablePlugin === 'home',
                closeDrawerOnNavigate: true,
            },
            {
                section: 'knowledge' as const,
                to: hasPlugin('knowledge_space') || !menuApprovalMode
                    ? (isMobile ? '/knowledge' : (lastSectionPaths.knowledge || '/knowledge'))
                    : '/menu-unavailable?plugin=knowledge_space',
                icon: <Outlined.Book />,
                activeIcon: <Filled.Book />,
                label: menuNames.knowledge,
                isActive: pathname.startsWith('/knowledge') || menuUnavailablePlugin === 'knowledge_space',
                closeDrawerOnNavigate: true,
            },
            {
                section: 'channel' as const,
                to: hasPlugin('subscription') || !menuApprovalMode ? (lastSectionPaths.channel || '/channel') : '/menu-unavailable?plugin=subscription',
                icon: <Outlined.Rss />,
                activeIcon: <Filled.Rss />,
                label: menuNames.channel,
                isActive: pathname.startsWith('/channel') || menuUnavailablePlugin === 'subscription',
                closeDrawerOnNavigate: true,
            },
            {
                section: 'apps' as const,
                to: hasPlugin('apps') || !menuApprovalMode ? appsSectionLinkTarget() : '/menu-unavailable?plugin=apps',
                icon: <Outlined.Application />,
                activeIcon: <Filled.Application />,
                label: menuNames.apps,
                isActive: matchPath('/custom-app/:id/:fid/:type', pathname) !== null || pathname.startsWith('/apps') || menuUnavailablePlugin === 'apps',
                closeDrawerOnNavigate: true,
            },
        ].filter((l) => {
            if (l.section === 'home')
                return showHomeTab;
            if (l.section === 'apps')
                return showAppsTab;
            if (l.section === 'channel')
                return showSubscriptionTab;
            if (l.section === 'knowledge')
                return showKnowledgeSpaceTab;
            return true;
        });
    }, [canOpenWorkbenchEntry, pathname, menuUnavailablePlugin, isMobile, showKnowledgeSpaceTab, showSubscriptionTab, showHomeTab, showAppsTab, menuApprovalMode, plugins,
        menuNames.home, menuNames.knowledge, menuNames.channel, menuNames.apps]);
    const changeLang = useCallback((value: string) => {
        let userLang = value;
        if (value === 'auto')
            userLang = navigator.language || navigator.languages[0];
        setLangcode(userLang);
        Cookies.set('lang', userLang, { expires: 365 });
    }, [setLangcode]);
    return (<div className={cn(showExpandedHubSidebar ? (overlay ? 'w-full' : 'w-[38vw]') : 'w-16', 'h-[100dvh] flex flex-col justify-between py-4 px-2 shrink-0 bg-[rgb(227, 227, 227)]', showExpandedHubSidebar ? undefined : 'items-center')}>
      <div className={cn('flex flex-col', showExpandedHubSidebar ? 'gap-4 items-stretch' : 'gap-10 items-center')}>
        <div className={cn('relative shrink-0', showExpandedHubSidebar ? 'flex items-center justify-between p-2' : 'size-11 flex items-center justify-center')}>
          {showExpandedHubSidebar ? (<>
              {bsConfig?.sidebarIcon?.image ? (<img src={__APP_ENV__.BASE_URL + bsConfig.sidebarIcon.image} className="size-8 shrink-0 object-contain" alt={localize('com_nav_home')}/>) : (<div className="size-8 shrink-0 rounded-md bg-fill-2" aria-hidden/>)}
              {onCloseMobileApps ? (<button type="button" onClick={onCloseMobileApps} aria-label={localize('com_nav_close_sidebar')} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-text-2 hover:bg-fill-1">
                  <X className="size-4"/>
                </button>) : null}
            </>) : bsConfig?.sidebarIcon?.image ? (<img src={__APP_ENV__.BASE_URL + bsConfig.sidebarIcon.image} className="size-full object-contain" alt=""/>) : null}
        </div>

        <div className={cn('flex flex-col', showExpandedHubSidebar ? 'gap-1 items-stretch' : 'gap-4 items-center')}>
          {links.map(link => (<SidebarItem key={link.section} to={link.to} icon={link.icon} activeIcon={(link as {
            activeIcon?: React.ReactNode;
        }).activeIcon} label={link.label} active={link.isActive} showLabel={showExpandedHubSidebar} onNavigate={showExpandedHubSidebar && link.closeDrawerOnNavigate
                ? onCloseMobileApps
                : undefined}/>))}
        </div>
      </div>

      <div className="flex flex-col items-center">
        {!isMobile && showAdminEntry && (<>
            <a href={getPlatformAdminPanelUrl()} target="_blank" rel="noreferrer" className="mb-2">
              <div title={localize('com_nav_admin_panel')} className="rounded-lg p-3 transition-colors hover:bg-fill-2">
                <Outlined.DeviceDesktopExchange className="size-5 text-text-3"/>
              </div>
            </a>
            
            <div className="mb-4 w-full h-px bg-fill-3"/>
          </>)}

        
        <UserPopMenu variant={showExpandedHubSidebar ? 'drawer' : 'rail'}/>
      </div>
    </div>);
}
export function MainLayout() {
    const { pathname } = useLocation();
    const outlet = useOutlet();
    const { user, logout, isUserLoading } = useAuthContext();
    const localize = useLocalize();
    const menuNames = useWorkbenchMenuNames();
    const isMobile = usePrefersMobileLayout();
    const outletScrollRevealRef = useScrollRevealRef<HTMLDivElement>();
    const isAppSection = pathname.includes('/apps') || pathname.includes('/custom-app/');
    const isAppsArea = pathname.includes('/apps');
    let pathForMatch = (pathname.split('?')[0] || '').replace(/\/+$/, '') || '/';
    const appBase = typeof __APP_ENV__ !== 'undefined' ? String(__APP_ENV__.BASE_URL || '').replace(/\/$/, '') : '';
    if (appBase && (pathForMatch === appBase || pathForMatch.startsWith(`${appBase}/`))) {
        pathForMatch = pathForMatch.slice(appBase.length) || '/';
    }
    const isAppsExploreRoute = Boolean(matchPath({ path: '/apps/explore', end: true }, pathForMatch));
    const isAppChatRoute = /^\/custom-app(\/|$)/.test(pathname);
    const isChannelRoute = /^\/channel(\/|$)/.test(pathname);
    const isKnowledgeSettingsRoute = Boolean(matchPath({ path: '/knowledge/create', end: true }, pathForMatch) ||
        matchPath({ path: '/knowledge/space/:spaceId/settings', end: true }, pathForMatch));
    const innerScrollShell = /^\/(c|linsight)(\/|$)/.test(pathname) ||
        isChannelRoute ||
        isKnowledgeSettingsRoute ||
        isAppChatRoute ||
        (isAppsArea && !isAppsExploreRoute);
    const isKnowledgeRoute = /^\/knowledge(\/|$)/.test(pathname);
    const isChatHomeRoute = /^\/(c|linsight)(\/|$)/.test(pathname);
    const isMenuUnavailableRoute = pathname.startsWith('/menu-unavailable');
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [systemMenuOpen, setSystemMenuOpen] = useRecoilState(store.mobileSystemMenuOpenState);
    const shouldHideSidebarOnMobileAppsArea = isMobile && (isAppChatRoute || isAppsArea || isChannelRoute || isKnowledgeRoute || isChatHomeRoute || isMenuUnavailableRoute);
    const systemMenuRevealing = systemMenuOpen && isMobile && shouldHideSidebarOnMobileAppsArea;
    useEffect(() => {
        if (systemMenuOpen)
            setSystemMenuOpen(false);
    }, [pathname]);
    useEffect(() => {
        if (!isMobile || !shouldHideSidebarOnMobileAppsArea) {
            if (systemMenuOpen)
                setSystemMenuOpen(false);
        }
    }, [isMobile, shouldHideSidebarOnMobileAppsArea]);
    useEffect(() => {
        if (!isMobile || !isAppSection)
            return;
        try {
            localStorage.setItem('mobileAppSidebarOpen', JSON.stringify(mobileSidebarOpen));
        }
        catch {
        }
    }, [isMobile, isAppSection, mobileSidebarOpen]);
    useEffect(() => {
        if (!isUserLoading && !user) {
            logout();
        }
    }, [isUserLoading, user, logout]);
    const [config, setConfig] = useRecoilState(bishengConfState);
    useEffect(() => {
        getBysConfigApi().then((res: any) => {
            setConfig(res.data);
        });
    }, []);
    const remoteNotice = (config as {
        system_notification?: string;
    } | undefined)?.system_notification ?? '';
    const [noticeDismissed, setNoticeDismissed] = useState(false);
    const hideNotice = noticeDismissed
        || (typeof window !== 'undefined' && !!sessionStorage.getItem(systemNoticeTodayKey()));
    const systemNotice = !hideNotice && remoteNotice ? remoteNotice : '';
    const closeSystemNotice = () => {
        try {
            sessionStorage.setItem(systemNoticeTodayKey(), 'true');
        }
        catch {
        }
        setNoticeDismissed(true);
    };
    if (isUserLoading) {
        return (<div className="flex h-full w-full items-center justify-center bg-white">
        <LoadingIcon className="w-48 text-primary"/>
      </div>);
    }
    if (!user) {
        return null;
    }
    if (/^\/(c|linsight)(\/|$)/.test(pathname))
        lastSectionPaths.home = pathname;
    else if (/^\/(apps|custom-app)(\/|$)/.test(pathname)) {
        lastSectionPaths.apps = pathname.startsWith('/apps/explore') ? '/apps' : pathname;
    }
    else if (/^\/channel(\/|$)/.test(pathname))
        lastSectionPaths.channel = pathname;
    else if (pathname.startsWith('/knowledge'))
        lastSectionPaths.knowledge = pathname;
    const cacheKey = (() => {
        if (pathname.startsWith('/menu-unavailable'))
            return 'menu_unavailable_tab';
        if (/^\/linsight(\/|$)/.test(pathname))
            return 'linsight_tab';
        if (pathname.startsWith('/c/media-playback'))
            return 'media_playback_tab';
        if (/^\/c(\/|$)/.test(pathname))
            return 'chat_tab';
        if (/^\/(apps|custom-app)(\/|$)/.test(pathname))
            return 'custom_apps_tab';
        if (/^\/channel(\/|$)/.test(pathname))
            return 'channel_tab';
        if (pathname.startsWith('/knowledge'))
            return 'knowledge_tab';
        return 'other';
    })();
    return (<div data-custom-agent-chat className={cn('relative flex w-screen bg-fill-1', isMobile ? 'min-h-[100dvh] overflow-x-clip' : 'h-[100dvh] overflow-hidden')}>
      <WorkbenchAccessGuard />
      {CUSTOM_CHAT_VISIBILITY.showSidebar && (<>
      {shouldHideSidebarOnMobileAppsArea ? (systemMenuRevealing ? (<div className="absolute inset-y-0 left-0 z-30">
            <Sidebar mobileSidebarOpen={mobileSidebarOpen} onCloseMobileApps={() => setMobileSidebarOpen(false)}/>
          </div>) : null) : (<Sidebar mobileSidebarOpen={mobileSidebarOpen} onCloseMobileApps={() => setMobileSidebarOpen(false)}/>)}
      {isMobile && isAppsArea && !isAppChatRoute && mobileSidebarOpen ? (<div className="fixed inset-0 z-[55] flex" role="dialog" aria-modal="true" aria-label={menuNames.apps}>
          <div className="flex h-full w-[240px] max-w-[240px] shrink-0 flex-col overflow-hidden bg-white shadow-[4px_0_24px_rgba(0,0,0,0.06)]">
            <Sidebar mobileSidebarOpen={mobileSidebarOpen} onCloseMobileApps={() => setMobileSidebarOpen(false)} overlay/>
          </div>
          
          <button type="button" className="min-w-0 flex-1 bg-[rgba(86,88,105,0.55)]" aria-label={localize('com_nav_close_sidebar')} onClick={() => setMobileSidebarOpen(false)}/>
        </div>) : null}
      </>)}
      <main className={cn('relative min-w-0 flex-1', isMobile ? 'min-h-[100dvh]' : 'h-[100dvh] py-2 pr-2', shouldHideSidebarOnMobileAppsArea && 'transition-transform duration-300 ease-out', systemMenuRevealing && 'translate-x-16')}>
        {systemMenuRevealing ? (<button type="button" aria-label={localize('com_nav_close_sidebar')} onClick={() => setSystemMenuOpen(false)} className="absolute inset-0 z-[60] cursor-default bg-transparent"/>) : null}
        {pathname.startsWith('/menu-unavailable') ? (<div className={cn('flex flex-col bg-white shadow-[0px_0px_20px_0px_#07225808]', !isMobile && 'rounded-xl', systemMenuRevealing && 'rounded-l-3xl', isMobile
                ? 'h-auto min-h-[100dvh] overflow-visible'
                : 'scrollbar-os h-[calc(100dvh-16px)] overflow-y-auto overscroll-y-none', systemMenuRevealing && 'overflow-hidden')}>
            
            {shouldHideSidebarOnMobileAppsArea ? (<div className="sticky top-0 z-[50] w-full shrink-0 bg-white pt-[calc(env(safe-area-inset-top,0px)+8px)]">
                <div className="relative flex h-11 min-h-11 w-full flex-row items-center justify-between px-4">
                  <button type="button" aria-label={localize('com_nav_open_sidebar')} onClick={() => setSystemMenuOpen(true)} className="inline-flex size-5 shrink-0 items-center justify-center text-text-1">
                    <Outlined.SidebarMenu className="size-5"/>
                  </button>
                  <div className="min-w-0 flex-1" aria-hidden/>
                </div>
              </div>) : null}
            {outlet}
          </div>) : (<KeepAlive name={cacheKey} id={cacheKey} saveScroll={true}>
          <div ref={!isMobile && !innerScrollShell ? outletScrollRevealRef : undefined} data-workbench-panel className={cn('relative bg-white shadow-[0px_0px_20px_0px_#07225808]', !isMobile && 'rounded-xl', systemMenuRevealing && 'rounded-l-3xl', isMobile
                ? innerScrollShell
                    ? 'flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden'
                    : 'h-auto min-h-[100dvh] overflow-visible'
                : innerScrollShell
                    ? 'flex h-[calc(100dvh-16px)] min-h-0 flex-col overflow-hidden overscroll-y-none'
                    : 'scrollbar-os h-[calc(100dvh-16px)] overflow-y-auto overscroll-y-none', systemMenuRevealing && 'overflow-hidden')}>
            
            {shouldHideSidebarOnMobileAppsArea &&
                isAppsArea &&
                !isAppChatRoute &&
                !isAppsExploreRoute ? (<div className="sticky top-0 z-[50] w-full shrink-0 bg-white pt-[calc(env(safe-area-inset-top,0px)+8px)]">
                <div className="relative flex h-11 min-h-11 w-full flex-row items-center justify-between px-4">
                  <button type="button" aria-label={localize('com_nav_open_sidebar')} onClick={() => setSystemMenuOpen(true)} className="inline-flex size-5 shrink-0 items-center justify-center text-text-1">
                    <Outlined.SidebarMenu className="size-5"/>
                  </button>
                  
                  <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 truncate text-[16px] font-medium leading-6 text-text-1">
                    {menuNames.apps}
                  </span>
                  <div className="min-w-0 flex-1" aria-hidden/>
                </div>
              </div>) : null}
            {innerScrollShell ? (<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {outlet}
              </div>) : (outlet)}
          </div>
        </KeepAlive>)}
      </main>
      <Dialog open={!!systemNotice} onOpenChange={(open) => {
            if (!open)
                closeSystemNotice();
        }}>
        <DialogContent className="sm:max-w-md w-[calc(100%-40px)] rounded-2xl mx-auto top-[50%] -translate-y-[50%]">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-medium">{i18n.t("com_app.custom_system_notice")}</DialogTitle>
          </DialogHeader>
          <div className="py-6 px-2">
            <div className="text-sm text-gray-700 leading-relaxed text-center whitespace-pre-wrap">
              {systemNotice}
            </div>
          </div>
          <DialogFooter className="sm:justify-center flex-row justify-center pb-2">
            <Button onClick={closeSystemNotice} className="w-[120px] rounded-full">{i18n.t("com_app.custom_acknowledge")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>);
}
