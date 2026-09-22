// Frontend fork of components/Chat/HeaderTitle.tsx. Edit this copy for custom chat.
import { Outlined } from "bisheng-icons";
import { useLocation } from "react-router-dom";
import { useLocalize, useMediaQuery, usePrefersMobileLayout } from "~/hooks";
import { cn } from "~/utils";
import ShareChat from "~/components/Share/ShareChat";
const types = {
    1: 'skill',
    5: 'assistant',
    10: 'workflow',
    15: 'workbench_chat'
} as const;
export function HeaderTitle({ conversation, readOnly, hideShare = false, onOpenWorkspace, hasWorkspaceFiles = false, workspaceOpen = false }: {
    conversation?: any;
    readOnly?: boolean;
    hideShare?: boolean;
    onOpenWorkspace?: () => void;
    hasWorkspaceFiles?: boolean;
    workspaceOpen?: boolean;
}) {
    const localize = useLocalize();
    const { pathname } = useLocation();
    const isNarrowViewport = usePrefersMobileLayout();
    const isAppChatRoute = pathname.includes('/custom-app/');
    const isAppChatCompact = useMediaQuery('(max-width: 1023px)');
    const normalizedTitle = conversation?.title != null && String(conversation.title).trim() !== ''
        ? String(conversation.title).trim()
        : localize('com_ui_new_chat');
    if (isNarrowViewport || (isAppChatRoute && isAppChatCompact)) {
        return null;
    }
    return (<div className={cn('sticky top-0 z-10 flex h-[56px] w-full items-center justify-between bg-white pl-4 pr-4 text-text-1')}>
      
      <div className="flex-1"></div>

      
      <div className="flex-[2] flex justify-center text-[14px] font-medium leading-[22px]">
        <div id="custom-chat-title" className="truncate max-w-full text-center">
          {normalizedTitle}
        </div>
      </div>

      
      <div className="flex-1 flex justify-end items-center gap-1">
        {!readOnly && !hideShare && (<ShareChat type={types[conversation?.flowType as keyof typeof types] ?? 'workbench_chat'} flowId={conversation?.flowId} chatId={conversation?.conversationId || ''}/>)}
        
        {hasWorkspaceFiles && onOpenWorkspace && (<button type="button" onClick={onOpenWorkspace} title={localize('com_linsight_workspace')} aria-label="workspace" className={cn('flex h-7 shrink-0 items-center justify-center overflow-hidden rounded-lg text-gray-600 transition-[width,opacity] duration-200 hover:bg-gray-100', workspaceOpen ? 'pointer-events-none w-0 opacity-0' : 'w-7 opacity-100 delay-150')}>
            <Outlined.RightSidebar size={16} className="shrink-0"/>
          </button>)}
      </div>
    </div>);
}
