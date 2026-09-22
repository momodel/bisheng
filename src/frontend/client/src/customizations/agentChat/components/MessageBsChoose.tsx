// Frontend fork of pages/appChat/components/MessageBsChoose.tsx. Edit this copy for custom chat.
import { CheckIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ChatMessageType } from "~/@types/chat";
import { Button, Textarea } from "~/components";
import Markdown from "~/components/Chat/Messages/Content/Markdown";
import { TextToSpeechButton } from "~/components/Voice/TextToSpeechButton";
import useLocalize from "~/hooks/useLocalize";
import { emitAreaTextEvent, EVENT_TYPE } from "~/customizations/agentChat/useAreaText";
import { AppChatFileList } from "~/customizations/agentChat/components/AppChatFileList";
type ChoiceMessage = Omit<ChatMessageType, "message"> & { message: { hisValue?: string; node_id: string; key: string; msg: string; input_msg?: string; options: Array<{ id: string; label: string }> } };

export function MessageBsChoose({ type = 'choose', disabled, logo, data, flow }: {
    type?: string;
    disabled?: boolean;
    flow: { name: string };
    logo: React.ReactNode;
    data: ChoiceMessage;
}) {
    const t = useLocalize();
    const [selected, setSelected] = useState(data.message.hisValue || '');
    const handleSelect = (obj) => {
        if (selected)
            return;
        emitAreaTextEvent({
            action: EVENT_TYPE.MESSAGE_INPUT, data: {
                nodeId: data.message.node_id,
                message: JSON.stringify({
                    ...data.message,
                    hisValue: obj.id
                }),
                msgId: data.id,
                data: {
                    [data.message.key]: obj.id
                }
            }
        });
        setSelected(obj.id);
    };
    const textRef = useRef<HTMLTextAreaElement>(null);
    const inputSended = useMemo(() => !!data.message.hisValue || false, [data.message.hisValue]);
    const handleSend = () => {
        const val = (textRef.current?.value ?? "");
        if (!val.trim())
            return;
        emitAreaTextEvent({
            action: EVENT_TYPE.MESSAGE_INPUT, data: {
                nodeId: data.message.node_id,
                message: JSON.stringify({
                    ...data.message,
                    hisValue: val
                }),
                msgId: data.id,
                data: {
                    [data.message.key]: val
                }
            }
        });
    };
    const files = useMemo(() => {
        return typeof data.files === 'string' ? [] : (data.files ?? []);
    }, [data.files]);
    return <MessageWarper flow={flow} logo={logo}>
        <div className="group">
            <div className="text-base text-[#0D1638] dark:text-[#CFD5E8]">
                
                <div><Markdown content={data.message.msg} isLatestMessage={false} webContent={undefined}/></div>
                
                <AppChatFileList files={files} className="mt-2"/>
                
                <div className="mt-2">
                    {type === 'input' ?
            <div>
                            <Textarea className="w-full" ref={textRef} disabled={inputSended || disabled} defaultValue={data.message.input_msg || data.message.hisValue}/>
                            <div className="flex justify-end mt-2">
                                <Button className="h-8" disabled={inputSended || disabled} onClick={handleSend}>{inputSended ? t('com_bschoose_confirmed') : t('com_bschoose_confirm')}</Button>
                            </div>
                        </div>
            : <div>
                            {data.message.options.map(opt => <div key={opt.id} className="min-w-56 border dark:bg-background rounded-xl p-3 mt-2 hover:bg-gray-50 cursor-pointer flex justify-between items-center break-all" onClick={() => handleSelect(opt)}>
                                {opt.label}
                                {selected === opt.id && <div className="size-5 bg-primary rounded-md p-1">
                                    <CheckIcon size={14} className='text-white'/>
                                </div>}
                            </div>)}
                        </div>}
                    <div className="flex justify-end py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {data.message.msg && <TextToSpeechButton messageId={String(data.id)} text={data.message.msg}/>}
                    </div>
                </div>
            </div>
        </div>
    </MessageWarper>;
}
;
export const MessageWarper = ({ flow, logo, children }) => {
    return <div className="max-w-[600px] min-w-[384px] w-full px-4">
        <div className="flex items-center gap-3 font-medium pt-3">
            <div className="flex-shrink-0">
                {logo}
            </div>
            <span className="text-base">{flow.name}</span>
        </div>

        

        <div className="p-3 ml-6">
            {children}
        </div>
    </div>;
};
