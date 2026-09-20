/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/ChatInput.tsx. Edit this copy for custom chat.
import { useEffect, useMemo, useState, useRef } from "react";
import { useRecoilState, useRecoilValue } from "recoil";
import { Button, SendIcon, Textarea } from "~/components";
import SpeechToTextComponent from "~/components/Voice/SpeechToText";
import { useRecordingAudioLoading } from "~/components/Voice/textToSpeechStore";
import { useGetWorkbenchModelsQuery } from "~/hooks/queries/data-provider";
import { useLocalize } from "~/hooks";
import type { InputFilesHandle } from "./components/inputFilesTypes";
import { InputFiles } from "~/customizations/agentChat/components/InputFiles";
import { bishengConfState, currentRunningState } from "~/customizations/agentChat/store/atoms";
import { useAreaText } from "~/customizations/agentChat/useAreaText";
import DragDropOverlay from "~/components/Chat/Input/Files/DragDropOverlay";
import { useFileDropAndPaste } from "~/customizations/agentChat/useFileDropAndPaste";
export function ChatInput({ readOnly, v }) {
    const [bishengConfig] = useRecoilState(bishengConfState);
    const { inputDisabled, error: inputMsg, showUpload, showStop, showReRun } = useRecoilValue(currentRunningState) ?? { inputDisabled: true, error: { code: "", data: null }, showUpload: false, showStop: false, showReRun: false };
    const { accepts, inputRef, setChatFiles, handleInput, handleRestart, handleSendClick, handleStopClick } = useAreaText();
    const [fileUploading, setFileUploading] = useState(false);
    const [audioOpening] = useRecordingAudioLoading();
    const localize = useLocalize();
    const { data: modelData } = useGetWorkbenchModelsQuery();
    const showVoice = modelData?.asr_model?.id;
    const inputFilesRef = useRef<InputFilesHandle>(null);
    const { isDragging, handlePaste } = useFileDropAndPaste({
        enabled: showUpload && !readOnly && !inputDisabled,
        onFilesReceived: (files) => {
            inputFilesRef.current?.upload(files);
        }
    });
    const placholder = useMemo(() => {
        return inputDisabled ?
            (inputMsg.code ? localize(`api_errors.${inputMsg.code}`, { ...(inputMsg.data || {}), defaultValue: localize('api_errors.fallback') }) : ' ')
            : localize('com_ui_please_enter_question');
    }, [inputDisabled, inputMsg, localize]);
    useEffect(() => {
        inputDisabled && setTimeout(() => {
            inputRef.current?.focus();
        }, 60);
    }, [inputDisabled]);
    return (<div className="z-10 w-full shrink-0 bg-[#fff] dark:bg-[#1B1B1B]">
            <div className="mx-auto w-full max-w-[800px] px-4 pt-1">
                
                {isDragging && <DragDropOverlay />}

                <div className="relative px-4 rounded-3xl bg-surface-tertiary">
                
                {showUpload && <InputFiles ref={inputFilesRef} v={v} showVoice={showVoice} accepts={accepts} disabled={readOnly || audioOpening || inputDisabled} size={bishengConfig?.uploaded_files_maximum_size || 50} onChange={(files => {
                if (files === null) {
                    setFileUploading(true);
                    return;
                }
                setFileUploading(false);
                setChatFiles(files.map(file => ({ ...file, path: file.filepath ?? "" })));
            })}/>}

                
                <div className="flex gap-2 absolute right-3 bottom-3 z-10">
                    {showVoice && <SpeechToTextComponent disabled={inputDisabled || readOnly || showStop} onChange={(e) => { if (inputRef.current) inputRef.current.value += e; }}/>}
                    {showStop ?
            <div className="btn-brand-primary w-8 h-8 bg-primary rounded-full cursor-pointer flex justify-center items-center" onClick={handleStopClick}>
                            <div className="size-3 bg-white rounded-[2px]"></div>
                        </div> :
            <button id="custom-chat-send-btn" className="btn-brand-primary size-8 flex items-center justify-center rounded-full bg-primary text-white transition-all duration-200 disabled:cursor-not-allowed disabled:bg-fill-3 disabled:text-text-3 disabled:opacity-100 [&>svg]:text-white disabled:[&>svg]:text-text-2" disabled={inputDisabled || fileUploading || readOnly || audioOpening} onClick={() => { !inputDisabled && !fileUploading && handleSendClick(); }}>
                            <SendIcon size={18}/>
                        </button>}
                </div>

                
                <div className="absolute w-full flex justify-center left-0 -top-14">
                    
                    {showReRun && !inputMsg.code && !showStop && <Button className="rounded-full bg-primary/10 bg-blue-50 text-primary" variant="ghost" disabled={readOnly} onClick={handleRestart}>
                        <img className='size-5' src={__APP_ENV__.BASE_URL + '/assets/chat.png'} alt=""/>{localize('com_ui_restart')}
                    </Button>}
                </div>

                
                <Textarea id="custom-chat-send-input" ref={inputRef} rows={2} style={{ height: 56 }} disabled={readOnly || inputDisabled} onInput={handleInput} onPaste={handlePaste} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                !inputDisabled && handleSendClick();
            }
        }} placeholder={placholder} className={"resize-none bg-transparent border-none p-4 pr-10 text-md min-h-24 max-h-80 scrollbar-hide"}></Textarea>
                </div>
                <p className="text-center text-sm pt-2 pb-4 text-gray-400">{bishengConfig?.dialog_tips}</p>
            </div>
        </div>);
}
;
