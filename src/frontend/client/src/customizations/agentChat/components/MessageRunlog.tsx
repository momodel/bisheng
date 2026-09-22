/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/components/MessageRunlog.tsx. Edit this copy for custom chat.
import { CheckIcon, ChevronDown, CircleAlert, Loader2 } from "lucide-react";
import { useRecoilState } from "recoil";
import { useMemo, useState } from "react";
import { chatsState } from "~/customizations/agentChat/store/atoms";
import { cn } from "~/utils";
import useLocalize from "~/hooks/useLocalize";
export function MessageRunlog({ data }) {
    const [open, setOpen] = useState(false);
    const t = useLocalize();
    const [_chatsState] = useRecoilState(chatsState);
    const assistantState = useMemo(() => {
        return _chatsState[data.chat_id].flow;
    }, [_chatsState, data]);
    const [title, lost] = useMemo(() => {
        if (data.interrupted)
            return [t('com_runlog_interrupted'), true];
        let lost = false;
        let title = '';
        const status = data.end ? t('com_runlog_used') : t('com_runlog_using');
        const assistant: any = assistantState as any;
        if (data.category === 'flow') {
            const flow = assistant?.flow_list?.find((flow: any) => flow.id === data.message.tool_key);
            if (flow) {
                lost = flow.status === 1;
                title = lost ? `${flow.name} ${t('com_runlog_offline')}` : `${status} ${flow.name}`;
            }
            else {
                title = t('com_runlog_flow_deleted');
            }
        }
        else if (data.category === 'tool') {
            const tool = assistant?.tool_list?.find((tool: any) => tool.tool_key === data.message.tool_key);
            title = tool ? `${status} ${tool.name}` : t('com_runlog_tool_deleted');
        }
        else if (data.category === 'knowledge') {
            const knowledge = assistant?.knowledge_list?.find((knowledge: any) => knowledge.id === parseInt(data.message.tool_key));
            title = knowledge ? `${data.end ? t('com_runlog_searched') : t('com_runlog_searching')} ${knowledge.name}` : t('com_runlog_knowledge_deleted');
        }
        else {
            title = data.end ? t('com_runlog_done') : t('com_runlog_thinking');
        }
        return [title, lost];
    }, [assistantState, data]);
    const listsLen = ((assistantState as any)?.tool_list?.length ?? 0)
        + ((assistantState as any)?.knowledge_list?.length ?? 0)
        + ((assistantState as any)?.flow_list?.length ?? 0);
    if (listsLen === 0)
        return null;
    return <div className="py-1">
        <div className="rounded-sm border max-w-[90%]">
            <div className="flex justify-between items-center px-4 py-2 cursor-pointer" onClick={() => setOpen(!open)}>
                <div className="flex items-center font-bold gap-2 text-sm">
                    {data.end ? (lost ? <div className="w-5 h-5 bg-red-500 rounded-full p-1">
                            <CircleAlert size={14} className='text-white'/>
                        </div> : <div className="w-5 h-5 bg-[#05B353] rounded-full p-1">
                            <CheckIcon size={14} className='text-white'/>
                        </div>) :
            <Loader2 className="text-primary duration-300 animate-spin"/>}
                    <span>{title}</span>
                </div>
                <ChevronDown className={open ? 'rotate-180' : undefined}/>
            </div>
            <div className={cn('bg-[#F5F6F8] dark:bg-[#313336] px-4 py-2 overflow-hidden text-sm ', open ? 'h-auto' : 'h-0 p-0')}>
                {data.thought.split('\n').map((line, index) => (<p className="text-md mb-1 text-muted-foreground" key={index}>{line}</p>))}
            </div>
        </div>
    </div>;
}
;
