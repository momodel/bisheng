// Frontend fork of pages/appChat/components/AppChatFileChip.tsx. Edit this copy for custom chat.
import { useState } from "react";
import { MediaAttachmentChip } from "~/components/Chat/attachments/MediaAttachmentChip";
import { OGDialog, OGDialogContent } from "~/components/ui";
import { getFileTypebyFileName } from "~/components/ui/icon/File/FileIcon";
import { resolveKnowledgePreviewUrl } from "~/pages/knowledge/FilePreview/previewUrlUtils";
import { isMediaAttachmentFile } from "~/utils/mediaAttachmentUtils";
import { cn } from "~/utils";
import { type AppChatFileLike, normalizeAppChatFile } from "~/customizations/agentChat/appChatFileUtils";
import { ChatFile } from "~/customizations/agentChat/components/ChatFile";
const IMAGE_FILE_TYPES = new Set(['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp']);
export function isAppChatImageFile(file: AppChatFileLike): boolean {
    const { name, path } = normalizeAppChatFile(file);
    if (isMediaAttachmentFile({ name }))
        return false;
    return IMAGE_FILE_TYPES.has(getFileTypebyFileName(name)) && !!path;
}
interface AppChatFileChipProps {
    file: AppChatFileLike;
    variant?: 'bar' | 'message';
    className?: string;
}
export function AppChatFileChip({ file, variant = 'message', className }: AppChatFileChipProps) {
    const { name, path } = normalizeAppChatFile(file);
    const [previewOpen, setPreviewOpen] = useState(false);
    if (isMediaAttachmentFile({ name })) {
        return (<MediaAttachmentChip file={{
                name,
                filename: name,
                filepath: path,
                file_path: path,
                cover_filepath: file.cover_filepath,
                mediaDurationSec: file.mediaDurationSec,
                parsingState: file.parsingState,
            }} variant={variant} className={className}/>);
    }
    const fileType = getFileTypebyFileName(name);
    const previewUrl = path ? resolveKnowledgePreviewUrl(path) : undefined;
    const isImage = IMAGE_FILE_TYPES.has(fileType) && !!previewUrl;
    if (isImage) {
        return (<>
                <button type="button" onClick={() => setPreviewOpen(true)} title={name} className={cn('size-[100px] shrink-0 overflow-hidden rounded-lg bg-[#F8F8F8] cursor-pointer', className)}>
                    <img src={previewUrl} alt={name} className="size-full object-cover"/>
                </button>
                <OGDialog open={previewOpen} onOpenChange={setPreviewOpen}>
                    <OGDialogContent showCloseButton={false} className="w-auto max-w-[92vw] overflow-hidden bg-transparent p-0 shadow-none" disableScroll={false}>
                        <img src={previewUrl} alt={name} className="max-h-[85vh] max-w-full rounded-md object-contain"/>
                    </OGDialogContent>
                </OGDialog>
            </>);
    }
    return <ChatFile fileName={name} filePath={path}/>;
}
