// Frontend fork of pages/appChat/components/AppChatFileList.tsx. Edit this copy for custom chat.
import { AppChatFileChip, isAppChatImageFile } from "~/customizations/agentChat/components/AppChatFileChip";
import type { AppChatFileLike } from "~/customizations/agentChat/appChatFileUtils";
interface AppChatFileListProps {
    files: AppChatFileLike[];
    className?: string;
}
export function AppChatFileList({ files, className }: AppChatFileListProps) {
    if (!files?.length)
        return null;
    const images = files.filter(isAppChatImageFile);
    const others = files.filter((file) => !isAppChatImageFile(file));
    return (<div className={className}>
            {images.length > 0 && (<div className="flex flex-wrap gap-2">
                    {images.map((file, index) => (<AppChatFileChip key={`img-${index}`} file={file} variant="message"/>))}
                </div>)}
            {others.length > 0 && (<div className="mt-2 flex max-w-sm flex-wrap gap-2 first:mt-0">
                    {others.map((file, index) => (<AppChatFileChip key={`file-${index}`} file={file} variant="message"/>))}
                </div>)}
        </div>);
}
