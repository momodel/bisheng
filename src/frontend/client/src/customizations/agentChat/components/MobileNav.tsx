/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of components/Nav/MobileNav.tsx. Edit this copy for custom chat.
import React, { useState } from "react";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Menu, X } from "lucide-react";
import { Outlined } from "bisheng-icons";
import { useNavigate } from "react-router-dom";
import { QueryKeys, Constants } from "~/types/chat";
import type { TMessage } from "~/types/chat";
import type { Dispatch, SetStateAction } from "react";
import ShareChat from "~/components/Share/ShareChat";
import { useLocalize, useNewConvo } from "~/hooks";
import { cn } from "~/utils";
import store from "~/store";
import { MobileChatHistoryDropdown } from "~/components/Nav/MobileChatHistoryDropdown";
const shareChatTypes = {
    1: 'skill',
    5: 'assistant',
    10: 'workflow',
    15: 'workbench_chat',
} as const;
type MobileNavProps = {
    variant?: 'chat' | 'app';
    navVisible: boolean;
    setNavVisible: Dispatch<SetStateAction<boolean>>;
    persistNavVisibleInLocalStorage?: boolean;
    navigateToNewChatPath?: string | false;
    onNewChat?: () => void;
    preferBackButton?: boolean;
    onBack?: () => void;
    appSurfaceBackAction?: () => void;
    appHistoryDropdownOpen?: boolean;
    onToggleAppHistoryDropdown?: () => void;
};
export function MobileNav({ variant = 'chat', navVisible, setNavVisible, persistNavVisibleInLocalStorage = true, navigateToNewChatPath = '/c/new', onNewChat, preferBackButton = false, onBack, appSurfaceBackAction, appHistoryDropdownOpen = false, onToggleAppHistoryDropdown, }: MobileNavProps) {
    const mobileHeadIconBtnClassName = 'inline-flex size-5 shrink-0 items-center justify-center text-text-1';
    const localize = useLocalize();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { newConversation } = useNewConvo();
    const conversation = useRecoilValue(store.conversationByIndex(0));
    const { title = 'New Chat' } = conversation || {};
    const chatMobileHeader = useRecoilValue(store.chatMobileHeaderState);
    const setSystemMenuOpen = useSetRecoilState(store.mobileSystemMenuOpenState);
    const [historyDropdownOpen, setHistoryDropdownOpen] = useState(false);
    const showWorkbenchMergedBar = variant === 'chat' && chatMobileHeader !== null;
    const toggleSidebar = () => {
        setNavVisible((prev) => {
            const next = !prev;
            if (persistNavVisibleInLocalStorage) {
                localStorage.setItem('customChatNavVisible', JSON.stringify(next));
            }
            return next;
        });
    };
    const handleNewChat = () => {
        setHistoryDropdownOpen(false);
        if (appHistoryDropdownOpen)
            onToggleAppHistoryDropdown?.();
        if (onNewChat) {
            onNewChat();
            return;
        }
        queryClient.setQueryData<TMessage[]>([QueryKeys.messages, conversation?.conversationId ?? Constants.NEW_CONVO], []);
        newConversation();
        if (navigateToNewChatPath !== false) {
            navigate(navigateToNewChatPath);
        }
    };
    const shareType = showWorkbenchMergedBar && chatMobileHeader
        ? shareChatTypes[chatMobileHeader.flowType as keyof typeof shareChatTypes]
        : undefined;
    const mergedHistoryActive = (historyDropdownOpen && !appSurfaceBackAction) ||
        (appHistoryDropdownOpen && Boolean(appSurfaceBackAction));
    const appSurfaceShowBackWithMenu = Boolean(appSurfaceBackAction &&
        !preferBackButton &&
        !(showWorkbenchMergedBar && chatMobileHeader));
    const appBackBtnClassName = 'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-base bg-white text-text-1 shadow-sm transition-colors hover:bg-fill-1';
    return (<div className={cn('bg-token-main-surface-primary sticky top-0 z-10 w-full bg-white pt-[calc(env(safe-area-inset-top,0px)+8px)] dark:bg-gray-800 dark:text-white')}>
      <div className={cn('relative flex h-11 min-h-11 w-full flex-row items-center justify-between px-4')}>
        {appSurfaceShowBackWithMenu ? (<div className="flex shrink-0 items-center gap-0.5">
            <button type="button" data-testid="mobile-header-left-action" aria-label={navVisible ? localize('com_nav_close_sidebar') : localize('com_nav_open_sidebar')} aria-expanded={navVisible} className={appBackBtnClassName} onClick={toggleSidebar}>
              {navVisible ? (<X className="size-4" strokeWidth={2}/>) : (<Menu className="size-4" strokeWidth={2}/>)}
            </button>
            <button type="button" data-testid="mobile-header-app-back" aria-label={localize('com_ui_go_back')} className={appBackBtnClassName} onClick={appSurfaceBackAction}>
              <ChevronLeft className="size-4" strokeWidth={2}/>
            </button>
          </div>) : (<button type="button" data-testid="mobile-header-left-action" aria-label={preferBackButton ? localize('com_ui_go_back') : localize('com_nav_open_sidebar')} className={cn(mobileHeadIconBtnClassName, (historyDropdownOpen || appHistoryDropdownOpen) && 'pointer-events-none text-text-4')} onClick={preferBackButton ? (onBack ?? toggleSidebar) : () => { setHistoryDropdownOpen(false); setSystemMenuOpen(true); }}>
            {preferBackButton ? (<ChevronLeft className="size-4" strokeWidth={2}/>) : (<Outlined.SidebarMenu className="size-5"/>)}
          </button>)}
        {showWorkbenchMergedBar && chatMobileHeader ? (<>
            
            <div className="absolute left-1/2 top-0 flex h-full max-w-[calc(100%-128px)] -translate-x-1/2 items-center justify-center px-1">
              {appSurfaceBackAction ? (onToggleAppHistoryDropdown ? (<button type="button" id="custom-chat-title" onClick={onToggleAppHistoryDropdown} aria-expanded={appHistoryDropdownOpen} title={chatMobileHeader.title} className="flex min-w-0 max-w-full items-center justify-center gap-1 outline-none">
                    <span className="truncate text-[16px] font-medium leading-6 text-text-1">
                      {chatMobileHeader.title}
                    </span>
                    <Outlined.Down className={cn('size-4 shrink-0 text-text-3 transition-transform', appHistoryDropdownOpen && 'rotate-180')}/>
                  </button>) : (<span id="custom-chat-title" className="truncate text-center text-[16px] font-medium leading-6 text-text-1" title={chatMobileHeader.title}>
                    {chatMobileHeader.title}
                  </span>)) : (<button type="button" id="custom-chat-title" onClick={() => setHistoryDropdownOpen((o) => !o)} aria-expanded={historyDropdownOpen} title={chatMobileHeader.title} className="flex min-w-0 max-w-full items-center justify-center gap-1 outline-none">
                  <span className="truncate text-[16px] font-medium leading-6 text-text-1">
                    {chatMobileHeader.title}
                  </span>
                  <Outlined.Down className={cn('size-4 shrink-0 text-text-3 transition-transform', historyDropdownOpen && 'rotate-180')}/>
                </button>)}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              
              {!chatMobileHeader.readOnly && !chatMobileHeader.hideShare && shareType && (<ShareChat type={shareType} flowId={chatMobileHeader.flowId || undefined} chatId={chatMobileHeader.conversationId} iconClassName="size-5 shrink-0" buttonClassName={cn(mobileHeadIconBtnClassName, 'p-0 hover:bg-transparent', mergedHistoryActive && 'pointer-events-none text-text-4')}/>)}
              <button type="button" data-testid="mobile-header-new-chat-button" aria-label={localize('com_ui_new_chat')} className={mobileHeadIconBtnClassName} onClick={handleNewChat}>
                <Outlined.Plus className="size-5"/>
              </button>
            </div>
          </>) : (<>
            {variant === 'app' ? (<>
                <div className="min-w-0 flex-1" aria-hidden/>
                <span className="sr-only">{localize('com_ui_new_chat')}</span>
              </>) : (<div className="flex min-w-0 flex-1 justify-center px-1">
                <button type="button" onClick={() => setHistoryDropdownOpen((o) => !o)} aria-expanded={historyDropdownOpen} className="flex min-w-0 max-w-full items-center justify-center gap-1 outline-none">
                  <span className="truncate text-[16px] font-medium leading-6 text-text-1">
                    {localize('com_ui_chat_list')}
                  </span>
                  <Outlined.Down className={cn('size-4 shrink-0 text-text-3 transition-transform', historyDropdownOpen && 'rotate-180')}/>
                </button>
              </div>)}
            
            <div className="size-5 shrink-0" aria-hidden/>
          </>)}
      </div>
      <MobileChatHistoryDropdown open={historyDropdownOpen} onClose={() => setHistoryDropdownOpen(false)} onNewChat={handleNewChat}/>
    </div>);
}
