/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/components/MessageUser.tsx. Edit this copy for custom chat.
import i18n from "~/locales/i18n";
import { RefreshCw, Search, SquarePen } from "lucide-react";
import { useMemo } from "react";
import { useRecoilState } from "recoil";
import { useParams } from "react-router-dom";
import { useAuthContext, useLocalize } from "~/hooks";
import { formatStrTime } from "~/utils";
import { bishengConfState } from "~/customizations/agentChat/store/atoms";
import { emitAreaTextEvent, EVENT_TYPE } from "~/customizations/agentChat/useAreaText";
import { Avatar, AvatarImage, AvatarName } from "~/components/ui/Avatar";
import { MessageCheckbox } from "~/components/Chat/MessageSelection";
import { MessageImage } from "~/components/Chat/Messages/Content/MessageImage";
import { isImageFileName } from "~/components/ui/icon/File/FileIcon";
import { useMessageSelection } from "~/hooks/useMessageSelection";
export function MessageUser({ useName, data, showButton, disabledSearch = false, readOnly }) {
    const { user } = useAuthContext();
    const [config] = useRecoilState(bishengConfState);
    const localize = useLocalize();
    const files = useMemo(() => (Array.isArray(data.files) ? data.files : []), [data.files]);
    const msg = useMemo(() => {
        const res = typeof data.message === 'string' ? data.message : data.message[data.chatKey];
        const hackStr = typeof res === 'string' ? res : JSON.stringify(data.message);
        const text = hackStr.replace(/\\n/g, '\n');
        const names = files.map((f) => f.file_name || f.name).filter(Boolean);
        if (!names.length)
            return text;
        const lines = text.split('\n');
        while (lines.length && names.includes(lines[0]))
            lines.shift();
        return lines.join('\n');
    }, [data.message, files]);
    const images = useMemo(() => files.filter((f) => isImageFileName(f.file_name || f.name)), [files]);
    const handleResend = (send) => {
        emitAreaTextEvent({
            action: EVENT_TYPE.RE_ENTER,
            autoSend: send,
            text: msg
        });
    };
    const handleSearch = () => {
        window.open(config?.dialog_quick_search + encodeURIComponent(msg));
    };
    const { conversationId: chatIdFromUrl } = useParams();
    const chatId = chatIdFromUrl || "";
    const messageId = String(data.id ?? "");
    const { isActiveForChat } = useMessageSelection();
    const showCheckbox = !!chatId && isActiveForChat(chatId);
    return <div className="flex w-full py-2 items-start gap-2">
        {showCheckbox && messageId && (<MessageCheckbox chatId={chatId} messageId={messageId} className="mt-2 ml-2 shrink-0"/>)}
        <div className="w-fit group min-h-8 max-w-[90%]">
            <div className="flex justify-start items-center gap-2 ml-4">
                
                
            </div>
            <div className="rounded-2xl px-4">
                <div className="flex gap-3">
                    <div className="shrink-0 flex justify-center">
                        <Avatar className="w-6 h-6 text-xs">
                            {user?.avatar ? <AvatarImage src={user?.avatar} alt="User"/> : <AvatarName name={user?.username}/>}
                        </Avatar>
                    </div>
                    
                    <div className="">
                        <p className="select-none font-semibold text-base mb-1">{useName}</p>
                        <div className="text-[#0D1638] dark:text-[#CFD5E8] text-base break-all whitespace-break-spaces">{msg}</div>
                        
                        {images.length > 0 && (<div className="mt-2 flex flex-wrap gap-2">
                                {images.map((file, i) => (<MessageImage key={file.file_id ?? i} conversationId={data.chat_id || chatId} fileId={file.file_id} altText={file.file_name || file.name} initialUrl={file.file_url || file.filepath}/>))}
                            </div>)}
                    </div>
                </div>
            </div>
            
            {!readOnly && <div className="flex justify-end mt-2 opacity-0 group-hover:opacity-100 transition-opacity gap-2">
                <span className="text-slate-400 text-sm pt-0.5">{formatStrTime(data.create_time, i18n.t("com_app.custom_message_date"))}</span>
                <div className="flex gap-0.5 text-gray-400 cursor-pointer self-end">
                    {showButton && <SquarePen className="size-6 p-1 hover:text-gray-500" onClick={() => handleResend(false)}/>}
                    {showButton && <RefreshCw className="size-6 p-1 hover:text-gray-500" onClick={() => handleResend(true)}/>}
                    {!disabledSearch && config?.dialog_quick_search && <Search className="size-6 p-1 hover:text-gray-500" onClick={handleSearch}/>}
                </div>
            </div>}
        </div>
    </div>;
}
;
