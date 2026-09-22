// Frontend fork of pages/appChat/components/InputFiles.tsx. Edit this copy for custom chat.
import { NotificationSeverity } from "~/common";
import type { InputFilesHandle, InputFilesProps, UploadFileState } from "./inputFilesTypes";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { uploadChatFile } from "~/api/apps";
import { checkFileParseStatus } from "~/api/linsight";
import { isFileNameAccepted } from "~/common/chatAccept";
import { MediaAttachmentChip } from "~/components/Chat/attachments/MediaAttachmentChip";
import { FileUploadThumbnail } from "~/components/Chat/attachments/UploadAttachmentThumbnail";
import { AttachmentIcon } from "~/components/svg";
import useLocalize from "~/hooks/useLocalize";
import { useToastContext } from "~/Providers";
import { cn, generateUUID } from "~/utils";
import { getMaxFileSizeBytesForFile, isHiddenPath, isMediaFileName, resolveUploadSizeLimits, type UploadSizeLimits, } from "~/pages/knowledge/knowledgeUtils";
import { MAX_MEDIA_FILES } from "~/customizations/agentChat/fileAcceptUtils";
import { checkFolderBatch, FOLDER_INPUT_PROPS, getFileRelativePath, TASK_MODE_MAX_FOLDER_DEPTH, TASK_MODE_MAX_FOLDER_FILES, } from "~/utils/folderUpload";
import { captureVideoPosterFromFile, getMediaKind, readMediaDurationFromFile, isMediaAttachmentFile, } from "~/utils/mediaAttachmentUtils";
function createUploadPayload(file: File): File | Blob {
    if (getMediaKind(file.name) === 'video') {
        return file.slice(0, file.size, file.type || undefined);
    }
    return file;
}
const unwrapUploadPayload = (response: any) => {
    if (response?.status_code != null && response?.data != null) {
        return response.data;
    }
    if (response?.data?.filepath != null || response?.data?.file_path != null) {
        return response.data;
    }
    return response ?? {};
};
const notifyUploadedFiles = (getUploadedFileIds: () => any[], onChange: (files: any) => void) => {
    const uploaded = getUploadedFileIds();
    onChange(uploaded.length ? uploaded : []);
};
const logUploadStage = (fileName: string, stage: string, startedAt: number, extra?: Record<string, unknown>) => {
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.info(`[client.media_upload] STAGE ${stage} elapsed_ms=${elapsedMs} file=${fileName}`, extra ?? '');
};
const normalizeParseStatusEntry = (entry: unknown) => {
    if (typeof entry === 'string') {
        return { parsing_status: entry };
    }
    if (entry && typeof entry === 'object') {
        return entry as {
            parsing_status?: string;
            cover_filepath?: string;
        };
    }
    return null;
};
const applyParseStatusToFile = (file: any, entry: {
    parsing_status?: string;
    cover_filepath?: string;
}) => {
    const nextStatus = entry.parsing_status;
    if (!nextStatus || nextStatus === 'failed') {
        return null;
    }
    const coverFilepath = entry.cover_filepath;
    const next = {
        ...file,
        parsingStatus: nextStatus,
        isUploading: false,
        ...(coverFilepath ? { cover_filepath: coverFilepath } : {}),
    };
    if (coverFilepath && file.mediaCoverUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(file.mediaCoverUrl);
        next.mediaCoverUrl = undefined;
    }
    return next;
};
const checkFileType = (file, accepts) => {
    if (!accepts || accepts === '*')
        return true;
    if (isFileNameAccepted(file.name, accepts))
        return true;
    return accepts
        .split(',')
        .map(a => a.trim().toLowerCase())
        .some(type => !type.startsWith('.') && file.type.match(new RegExp(type.replace('*', '.*'))));
};
const InputFiles = forwardRef<InputFilesHandle, InputFilesProps>(({ v, showVoice, accepts, disabled = false, size, uploadSizeLimits, onChange, onFilesStateChange, uploadMode, allowFolderUpload = false, hideTrigger = false, hideList = false }, ref) => {
    const t = useLocalize();
    const [files, setFiles] = useState<UploadFileState[]>([]);
    const filesRef = useRef<UploadFileState[]>([]);
    const remainingUploadsRef = useRef(0);
    const removedIdsRef = useRef<Set<string>>(new Set());
    const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
    const { showToast } = useToastContext();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const resolvedLimits: UploadSizeLimits | null = uploadSizeLimits ?? null;
    const defaultFileSizeLimit = (size ?? 50) * 1024 * 1024;
    const defaultParsingStatus = uploadMode === 'linsight' ? 'running' : 'completed';
    const isMediaFileParsing = (file) => {
        if (!file?.parsingStatus || ['completed', 'failed'].includes(file.parsingStatus)) {
            return false;
        }
        return uploadMode === 'linsight';
    };
    const supportsFolderUpload = !!allowFolderUpload;
    const getUploadedFileIds = () => filesRef.current
        .filter((f) => f.id && !f.isUploading && f.filePath)
        .map((f) => ({
        clientId: String(f.id),
        file_id: f.fileId || f.id,
        filepath: f.filePath,
        type: f.type,
        name: f.name,
        filename: f.name,
        file_name: f.name,
        relative_path: f.relativePath && f.relativePath !== f.name ? f.relativePath : undefined,
        size: f.size,
        parsing_status: f.parsingStatus || defaultParsingStatus,
        parsingState: f.parsingStatus && !['completed', 'failed'].includes(f.parsingStatus)
            ? 'parsing'
            : undefined,
        previewUrl: f.previewUrl,
        mediaPreviewUrl: f.mediaPreviewUrl,
        mediaCoverUrl: f.mediaCoverUrl,
        cover_filepath: f.cover_filepath,
        mediaDurationSec: f.mediaDurationSec,
    }));
    const handleFileChange = (selectedFiles: File[]) => {
        const validFiles: { id: string; file: File; relativePath: string }[] = [];
        const invalidFiles: { id: string; file: File }[] = [];
        const invalidTypeFiles: File[] = [];
        const duplicateFiles: File[] = [];
        if (fileInputRef.current)
            fileInputRef.current.value = '';
        if (folderInputRef.current)
            folderInputRef.current.value = '';
        const seenPaths = new Set(filesRef.current.map((f) => f.relativePath || f.name));
        const existingMediaCount = filesRef.current.filter((f) => isMediaFileName(f.name)).length;
        let incomingMediaCount = 0;
        selectedFiles.forEach((file) => {
            const relativePath = getFileRelativePath(file);
            if (!checkFileType(file, accepts)) {
                invalidTypeFiles.push(file);
                return;
            }
            else if (seenPaths.has(relativePath)) {
                duplicateFiles.push(file);
                return;
            }
            const maxBytes = resolvedLimits
                ? getMaxFileSizeBytesForFile(file.name, resolvedLimits)
                : defaultFileSizeLimit;
            if (isMediaFileName(file.name)) {
                incomingMediaCount += 1;
            }
            if (file.size <= maxBytes) {
                seenPaths.add(relativePath);
                validFiles.push({ id: generateUUID(6), file, relativePath });
            }
            else {
                invalidFiles.push({ id: generateUUID(6), file });
            }
        });
        if (existingMediaCount + incomingMediaCount > MAX_MEDIA_FILES) {
            showToast?.({ message: t('com_chat.media_file_too_many'), severity: NotificationSeverity.ERROR });
            return;
        }
        if (invalidTypeFiles.length > 0) {
            showToast?.({ message: t('com_ui_upload_file_type_error'), severity: NotificationSeverity.ERROR });
        }
        if (duplicateFiles.length > 0) {
            showToast?.({ message: t('com_error_files_dupe'), severity: NotificationSeverity.INFO });
        }
        if (invalidFiles.length > 0) {
            invalidFiles.map(file => showToast?.({
                message: isMediaFileName(file.file.name)
                    ? t('com_chat.media_file_too_large')
                    : t('com_inputfiles_exceed_limit', { 0: file.file.name, 1: size }),
                severity: NotificationSeverity.INFO,
            }));
        }
        if (!validFiles.length)
            return;
        onChange(null);
        const filesWithProgress = validFiles.map(({ file, id, relativePath }) => {
            const isMedia = isMediaFileName(file.name);
            const isVideo = getMediaKind(file.name) === 'video';
            return {
                name: file.name,
                relativePath,
                size: file.size,
                type: file.type,
                isUploading: true,
                progress: 0,
                id,
                file,
                previewUrl: file.type?.startsWith('image/') ? URL.createObjectURL(file) : undefined,
                mediaPreviewUrl: isMedia && !isVideo ? URL.createObjectURL(file) : undefined,
                mediaDurationSec: undefined,
            };
        });
        const nextFiles = [...filesRef.current, ...filesWithProgress];
        filesRef.current = nextFiles;
        setFiles(nextFiles);
        onFilesStateChange?.(nextFiles);
        filesWithProgress.forEach(({ file, id }: any) => {
            if (!file || !isMediaFileName(file.name)) {
                return;
            }
            readMediaDurationFromFile(file).then((mediaDurationSec) => {
                if (mediaDurationSec == null) {
                    return;
                }
                const updated = filesRef.current.map((f) => f.id === id ? { ...f, mediaDurationSec } : f);
                filesRef.current = updated;
                setFiles(updated);
                onFilesStateChange?.(updated);
            });
        });
        filesWithProgress.forEach(({ file, id }: {
            file: File;
            id: string;
        }) => {
            if (!file || getMediaKind(file.name) !== 'video') {
                return;
            }
            captureVideoPosterFromFile(file).then((mediaCoverUrl) => {
                if (!mediaCoverUrl) {
                    return;
                }
                const target = filesRef.current.find((f) => f.id === id);
                if (!target || target.cover_filepath) {
                    URL.revokeObjectURL(mediaCoverUrl);
                    return;
                }
                const updated = filesRef.current.map((f) => f.id === id ? { ...f, mediaCoverUrl } : f);
                filesRef.current = updated;
                setFiles(updated);
                onFilesStateChange?.(updated);
            });
        });
        remainingUploadsRef.current += validFiles.length;
        const uploadOne = ({ file, id }: {
            file: File;
            id: string;
        }) => {
            const uploadStartedAt = performance.now();
            const uploadPayload = createUploadPayload(file);
            logUploadStage(file.name, 'queue', uploadStartedAt, { size: file.size, type: file.type });
            let lastLoggedProgress = -1;
            const controller = new AbortController();
            uploadControllersRef.current.set(id, controller);
            return uploadChatFile(v, uploadPayload, (progress) => {
                if (progress >= 100 && lastLoggedProgress < 100) {
                    logUploadStage(file.name, 'xhr_upload_complete', uploadStartedAt, { progress });
                    lastLoggedProgress = 100;
                }
                else if (progress - lastLoggedProgress >= 25) {
                    logUploadStage(file.name, 'xhr_progress', uploadStartedAt, { progress });
                    lastLoggedProgress = progress;
                }
                if (removedIdsRef.current.has(id)) {
                    return;
                }
                const updatedFiles = filesRef.current.map(f => (f.id === id ? { ...f, progress } : f));
                filesRef.current = updatedFiles;
                setFiles(updatedFiles);
                onFilesStateChange?.(updatedFiles);
            }, uploadMode, file.name, controller.signal).then(response => {
                if (removedIdsRef.current.has(id)) {
                    logUploadStage(file.name, 'discarded_after_remove', uploadStartedAt);
                    return;
                }
                logUploadStage(file.name, 'api_response', uploadStartedAt, {
                    status_code: response?.status_code,
                });
                if (response?.status_code != null && response.status_code !== 200) {
                    throw new Error(response.status_message || 'upload failed');
                }
                const responseData = unwrapUploadPayload(response);
                const filePath = responseData.filepath ?? responseData.file_path;
                if (!filePath) {
                    throw new Error('upload response missing filepath');
                }
                logUploadStage(file.name, 'parsed_filepath', uploadStartedAt, {
                    filepath: filePath,
                    cover_filepath: responseData.cover_filepath,
                });
                const fileId = responseData.file_id;
                const coverFilepath = responseData.cover_filepath;
                const parsingStatus = responseData.parsing_status ?? defaultParsingStatus;
                filesRef.current = filesRef.current.map(f => {
                    if (f.id === id) {
                        const next = {
                            ...f,
                            isUploading: false,
                            filePath,
                            fileId,
                            parsingStatus,
                            progress: 100,
                            ...(coverFilepath ? { cover_filepath: coverFilepath } : {}),
                        };
                        if (coverFilepath && f.mediaCoverUrl?.startsWith('blob:')) {
                            URL.revokeObjectURL(f.mediaCoverUrl);
                            next.mediaCoverUrl = undefined;
                        }
                        return next;
                    }
                    return f;
                });
                setFiles(filesRef.current);
                onFilesStateChange?.(filesRef.current);
                remainingUploadsRef.current -= 1;
                notifyUploadedFiles(getUploadedFileIds, onChange);
                logUploadStage(file.name, 'state_committed', uploadStartedAt);
            }).catch((e) => {
                if (removedIdsRef.current.has(id)) {
                    logUploadStage(file.name, 'aborted_by_remove', uploadStartedAt);
                    return;
                }
                logUploadStage(file.name, 'failed', uploadStartedAt, { error: String(e) });
                console.log('e :>> ', e);
                showToast?.({ message: t('com_inputfiles_upload_failed', { 0: file.name }), severity: NotificationSeverity.ERROR });
                handleFileRemove(id);
                remainingUploadsRef.current -= 1;
                notifyUploadedFiles(getUploadedFileIds, onChange);
            }).finally(() => {
                uploadControllersRef.current.delete(id);
                removedIdsRef.current.delete(id);
            });
        };
        const hasVideo = validFiles.some(({ file }) => getMediaKind(file.name) === 'video');
        const uploadTask = hasVideo
            ? validFiles.reduce((chain, item) => chain.then(() => uploadOne(item)), Promise.resolve())
            : Promise.all(validFiles.map((item) => uploadOne(item)));
        uploadTask.then(() => {
            notifyUploadedFiles(getUploadedFileIds, onChange);
        });
    };
    const handleFolderChange = (selectedFiles: File[]) => {
        if (folderInputRef.current)
            folderInputRef.current.value = '';
        if (!selectedFiles.length)
            return;
        const visible = selectedFiles.filter((file) => !isHiddenPath(getFileRelativePath(file)));
        const supported = visible.filter((file) => checkFileType(file, accepts));
        const skipped = visible.length - supported.length;
        if (!supported.length) {
            showToast?.({ message: t('com_ui_upload_file_type_error'), severity: NotificationSeverity.ERROR });
            return;
        }
        if (skipped > 0) {
            showToast?.({ message: t('com_folder_upload_skipped_unsupported', { 0: skipped }), severity: NotificationSeverity.INFO });
        }
        const { rejection } = checkFolderBatch(supported);
        if (rejection) {
            const message = rejection === 'count'
                ? t('com_folder_upload_too_many', { 0: TASK_MODE_MAX_FOLDER_FILES })
                : rejection === 'size'
                    ? t('com_folder_upload_too_large')
                    : t('com_folder_upload_too_deep', { 0: TASK_MODE_MAX_FOLDER_DEPTH });
            showToast?.({ message, severity: NotificationSeverity.ERROR });
            return;
        }
        handleFileChange(supported);
    };
    useImperativeHandle(ref, () => ({
        upload: (fileList) => {
            if (disabled)
                return;
            const files = Array.from(fileList) as File[];
            if (supportsFolderUpload && files.some((f) => getFileRelativePath(f) !== f.name)) {
                handleFolderChange(files);
                return;
            }
            handleFileChange(files);
        },
        removeByClientId: (clientId) => {
            handleFileRemove(clientId);
        },
        updateParsingStatus: (statusMap) => {
            const updatedFiles = filesRef.current.reduce<UploadFileState[]>((result, file) => {
                const fileId = file.fileId || file.file_id || '';
                const entry = normalizeParseStatusEntry(statusMap?.get?.(fileId));
                if (!entry) {
                    result.push(file);
                    return result;
                }
                if (entry.parsing_status === 'failed') {
                    return result;
                }
                const nextFile = applyParseStatusToFile(file, entry);
                if (nextFile) {
                    result.push(nextFile);
                }
                return result;
            }, []);
            filesRef.current = updatedFiles;
            setFiles(updatedFiles);
            onFilesStateChange?.(updatedFiles);
        },
        openPicker: () => {
            if (disabled)
                return;
            fileInputRef.current?.click();
        },
        openFolderPicker: () => {
            if (disabled || !supportsFolderUpload)
                return;
            folderInputRef.current?.click();
        },
        supportsFolderUpload,
        clear: () => {
            filesRef.current.forEach(f => {
                if (f.previewUrl)
                    URL.revokeObjectURL(f.previewUrl);
                if (f.mediaPreviewUrl)
                    URL.revokeObjectURL(f.mediaPreviewUrl);
                if (f.mediaCoverUrl?.startsWith('blob:'))
                    URL.revokeObjectURL(f.mediaCoverUrl);
            });
            setFiles([]);
            filesRef.current = [];
            onFilesStateChange?.([]);
            onChange([]);
        }
    }));
    useEffect(() => () => {
        filesRef.current.forEach(f => {
            if (f.previewUrl)
                URL.revokeObjectURL(f.previewUrl);
            if (f.mediaPreviewUrl)
                URL.revokeObjectURL(f.mediaPreviewUrl);
            if (f.mediaCoverUrl?.startsWith('blob:'))
                URL.revokeObjectURL(f.mediaCoverUrl);
        });
    }, []);
    const mergeParseStatusUpdates = useCallback((updates: Map<string, {
        parsing_status?: string;
        cover_filepath?: string;
    }>) => {
        if (!updates.size)
            return;
        let changed = false;
        const nextFiles = filesRef.current.reduce<UploadFileState[]>((result, file) => {
            const fileId = file.fileId || file.file_id || '';
            const entry = updates.get(fileId);
            if (!entry) {
                result.push(file);
                return result;
            }
            if (entry.parsing_status === 'failed') {
                changed = true;
                return result;
            }
            const nextFile = applyParseStatusToFile(file, entry);
            if (!nextFile) {
                return result;
            }
            changed = changed
                || nextFile.parsingStatus !== file.parsingStatus
                || nextFile.cover_filepath !== file.cover_filepath;
            result.push(nextFile);
            return result;
        }, []);
        if (!changed)
            return;
        filesRef.current = nextFiles;
        setFiles(nextFiles);
        onFilesStateChange?.(nextFiles);
        notifyUploadedFiles(getUploadedFileIds, onChange);
    }, [onChange, onFilesStateChange]);
    useEffect(() => {
        if (uploadMode !== 'linsight')
            return;
        const pending = filesRef.current.filter((file) => {
            const fileId = file.fileId || file.file_id || '';
            return fileId && isMediaFileParsing(file);
        });
        if (!pending.length)
            return;
        const intervalId = window.setInterval(async () => {
            try {
                const res = await checkFileParseStatus(pending.map((file) => String(file.fileId || file.file_id)));
                const statusList = Array.isArray(res.data) ? res.data.filter(Boolean) : [];
                const updates = new Map<string, {
                    parsing_status?: string;
                    cover_filepath?: string;
                }>();
                statusList.forEach((item: any) => {
                    if (item?.file_id) {
                        updates.set(String(item.file_id), item);
                    }
                });
                mergeParseStatusUpdates(updates);
            }
            catch (error) {
                console.error('Media file parsing status check failed:', error);
            }
        }, 2000);
        return () => window.clearInterval(intervalId);
    }, [files, mergeParseStatusUpdates, uploadMode]);
    const handleFileRemove = (clientId) => {
        const removed = filesRef.current.find(file => String(file.id) === String(clientId));
        if (removed?.isUploading) {
            removedIdsRef.current.add(String(clientId));
            uploadControllersRef.current.get(String(clientId))?.abort();
        }
        if (removed?.previewUrl)
            URL.revokeObjectURL(removed.previewUrl);
        if (removed?.mediaPreviewUrl)
            URL.revokeObjectURL(removed.mediaPreviewUrl);
        if (removed?.mediaCoverUrl?.startsWith('blob:'))
            URL.revokeObjectURL(removed.mediaCoverUrl);
        const res = filesRef.current.filter(file => String(file.id) !== String(clientId));
        filesRef.current = res;
        setFiles(res);
        onFilesStateChange?.(res);
        remainingUploadsRef.current = Math.max(remainingUploadsRef.current - 1, 0);
        if (remainingUploadsRef.current === 0) {
            const uploadedFileIds = getUploadedFileIds();
            onChange(uploadedFileIds);
        }
    };
    const renderInlineFileChip = (file, index) => {
        const isMedia = isMediaAttachmentFile({ name: file.name });
        const isParsing = isMediaFileParsing(file);
        if (isMedia) {
            return (<MediaAttachmentChip key={file.id || index} file={{
                    name: file.name,
                    filepath: file.filePath,
                    cover_filepath: file.cover_filepath,
                    isUploading: file.isUploading || isParsing,
                    mediaPreviewUrl: file.mediaPreviewUrl,
                    mediaCoverUrl: file.mediaCoverUrl,
                    mediaDurationSec: file.mediaDurationSec,
                    parsingState: isParsing ? 'parsing' : undefined,
                }} onRemove={() => handleFileRemove(file.id)} variant="bar"/>);
        }
        return (<FileUploadThumbnail key={file.id || index} fileName={file.name} previewUrl={/\.(png|jpe?g|bmp|gif|webp)$/i.test(file.name) ? file.previewUrl : undefined} variant="bar" isUploading={file.isUploading || isParsing} onRemove={() => handleFileRemove(file.id)}/>);
    };
    return (<div className="">
            
            {!hideList && !!files.length && (<div className="flex max-w-full gap-2 overflow-x-auto overflow-y-hidden p-2 pb-3">
                    {files.map(renderInlineFileChip)}
                </div>)}

            
            {!hideTrigger && (<div className={cn('absolute z-10 bottom-3 cursor-pointer p-1 hover:bg-gray-200 rounded-full', showVoice ? 'right-[92px]' : 'right-14', disabled ? 'pointer-events-none opacity-40' : '')} onClick={() => !disabled && fileInputRef.current?.click()}>
                    <AttachmentIcon />
                </div>)}

            
            <input type="file" ref={fileInputRef} multiple accept={accepts} onChange={(e) => handleFileChange(Array.from(e.target.files ?? []))} className="hidden"/>

            
            {supportsFolderUpload && (<input type="file" ref={folderInputRef} multiple {...FOLDER_INPUT_PROPS} onChange={(e) => handleFolderChange(Array.from(e.target.files ?? []))} className="hidden"/>)}
        </div>);
});
export { InputFiles };
