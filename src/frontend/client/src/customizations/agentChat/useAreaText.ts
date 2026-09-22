/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/useAreaText.ts. Edit this copy for custom chat.
import { useEffect, useRef, useState } from "react";
import { useRecoilState, useRecoilValue } from "recoil";
import { FLOW_TYPES } from "~/customizations/agentChat/index";
import { SkillMethod } from "~/customizations/agentChat/appUtils/skillMethod";
import { chatFileState, chatIdState, currentChatState, runningState, submitDataState, tabsState, bishengConfState } from "~/customizations/agentChat/store/atoms";
import { ActionType } from "~/customizations/agentChat/useWebsocket";
import { fileAcceptToInputAccept, normalizeFileAccept } from "~/customizations/agentChat/fileAcceptUtils";
const eventTarget = new EventTarget();
const AREA_TEXT_EVENT = 'AREA_TEXT_EVENT';
export const enum EVENT_TYPE {
    FILE_ACCEPTS = 'file_accepts',
    RETRY = 'retry',
    FORM_SUBMIT = 'form_submit',
    MESSAGE_INPUT = 'message_input',
    INPUT_SUBMIT = 'input_submit',
    STOP = 'stop',
    RE_ENTER = 're_enter'
}
export const FileTypes = {
    ALL: ['.PNG', '.JPEG', '.JPG', '.BMP', '.PDF', '.OFD', '.TXT', '.MD', '.HTML', '.XLS', '.XLSX', '.CSV', '.DOC', '.DOCX', '.PPT', '.PPTX'],
    IMAGE: ['.PNG', '.JPEG', '.JPG', '.BMP'],
    FILE: ['.PDF', '.OFD', '.TXT', '.MD', '.HTML', '.XLS', '.XLSX', '.CSV', '.DOC', '.DOCX', '.PPT', '.PPTX'],
    MEDIA: ['.MP3', '.WAV', '.M4A', '.AAC', '.FLAC', '.OGG', '.MP4', '.MOV', '.AVI', '.MKV', '.WEBM'],
};
export const useAreaText = () => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [_, setSubmitDataState] = useRecoilState(submitDataState);
    const [__, setRunningState] = useRecoilState(runningState);
    const [chatFile, setChatFileState] = useRecoilState(chatFileState);
    const chatState = useRecoilValue(currentChatState);
    const [chatId] = useRecoilState(chatIdState);
    const [tabs] = useRecoilState(tabsState);
    const bishengConfig = useRecoilValue(bishengConfState);
    const [accepts, setAccepts] = useState('');
    const handleInput = () => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        }
    };
    const handleSendClick = (msg = '') => {
        if (!msg && textareaRef.current?.value.trim() === "" && chatFile.length === 0)
            return;
        const message = msg || textareaRef.current?.value || "";
        if (chatState!.flow.flow_type === FLOW_TYPES.WORK_FLOW) {
            setSubmitDataState({
                input: message,
                action: ActionType.INPUT,
                chatId,
                flow: chatState!.flow,
                files: chatFile,
            });
        }
        else {
            const data = SkillMethod.getSendParam({ tabs, flow: chatState!.flow, chatId, message });
            setSubmitDataState({
                input: message,
                action: ActionType.SKILL_INPUT,
                data
            });
        }
        if (textareaRef.current) {
            textareaRef.current.value = "";
            handleInput();
        }
        setRunningState((prev) => ({
            ...prev,
            [chatId]: {
                ...prev[chatId],
                running: true,
                showStop: true,
                showUpload: false,
                inputDisabled: true,
                guideWord: undefined,
            },
        }));
        setChatFileState([]);
    };
    const handleStopClick = () => {
        setSubmitDataState({
            action: ActionType.STOP
        });
        setRunningState((prev) => ({
            ...prev,
            [chatId]: {
                ...prev[chatId],
                running: false,
                showStop: false,
            },
        }));
    };
    const handleFormSubmit = ({ message, nodeId, data, skill }: {
        message: string;
        nodeId: string;
        data: any;
        skill?: boolean;
    }) => {
        if (skill) {
            const _data = SkillMethod.getSendParam({ tabs, flow: chatState!.flow, chatId, message });
            _data.inputs.data = data;
            setSubmitDataState({
                input: message,
                action: ActionType.SKILL_FORM_SUBMIT,
                data: _data
            });
        }
        else {
            setSubmitDataState({
                input: message,
                action: ActionType.FORM_SUBMIT,
                data,
                nodeId,
                chatId,
                flowId: chatState!.flow.id,
            });
        }
        setRunningState((prev) => ({
            ...prev,
            [chatId]: {
                ...prev[chatId],
                running: true,
                showStop: true,
                showUpload: false,
                inputDisabled: true,
                inputForm: false,
            },
        }));
    };
    const handleRestart = () => {
        setSubmitDataState({
            action: ActionType.RESTART,
            chatId,
            flow: chatState!.flow,
        });
        setRunningState((prev) => ({
            ...prev,
            [chatId]: {
                ...prev[chatId],
                running: true,
                showStop: true,
                showUpload: false,
                inputForm: false,
                showReRun: false,
            },
        }));
    };
    useEffect(() => {
        const handleEvent = (event: CustomEvent) => {
            console.log("Handling custom event:", event.detail);
            const action = event.detail.action;
            switch (action) {
                case EVENT_TYPE.FILE_ACCEPTS:
                    const { chatId: _chatId, fileAccept } = event.detail;
                    const kinds = normalizeFileAccept(fileAccept, {
                        mediaEnabled: !!bishengConfig?.enable_media_upload,
                    });
                    const acceptStr = fileAcceptToInputAccept(kinds);
                    chatId === _chatId && setAccepts(acceptStr || '*');
                    break;
                case EVENT_TYPE.FORM_SUBMIT:
                    handleFormSubmit(event.detail);
                    break;
                case EVENT_TYPE.MESSAGE_INPUT:
                    setSubmitDataState({
                        action: ActionType.MESSAGE_INPUT,
                        chatId,
                        flowId: chatState!.flow.id,
                        data: event.detail.data
                    });
                    break;
                case EVENT_TYPE.INPUT_SUBMIT:
                    handleSendClick(event.detail.data);
                    break;
                case EVENT_TYPE.RE_ENTER:
                    if (event.detail.autoSend) {
                        handleSendClick(event.detail.text);
                    }
                    else if (textareaRef.current) {
                        textareaRef.current.value = event.detail.text;
                    }
                    break;
                default:
                    break;
            }
        };
        eventTarget.addEventListener(AREA_TEXT_EVENT, handleEvent as EventListener);
        return () => {
            eventTarget.removeEventListener(AREA_TEXT_EVENT, handleEvent as EventListener);
        };
    }, [chatId]);
    return {
        inputRef: textareaRef,
        handleInput,
        handleSendClick,
        handleStopClick,
        handleRestart,
        setChatFiles: setChatFileState,
        accepts,
        chatState
    };
};
export const emitAreaTextEvent = (data: any) => {
    const event = new CustomEvent(AREA_TEXT_EVENT, {
        detail: data,
    });
    eventTarget.dispatchEvent(event);
};
