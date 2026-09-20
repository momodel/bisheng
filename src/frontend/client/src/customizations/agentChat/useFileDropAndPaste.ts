// Frontend fork of pages/appChat/useFileDropAndPaste.ts. Edit this copy for custom chat.
import { useState, useRef, useEffect, useCallback } from "react";
import { generateUUID } from "~/utils";
import { extractDroppedDirectories, readFolderFilesRecursive } from "~/utils/folderUpload";
const GENERIC_IMAGE_NAME = /^(image|screenshot|clipboard)?\.(png|jpe?g|gif|webp|bmp)$/i;
const uniquifyPastedFile = (file: File): File => {
    if (!file.type?.startsWith('image/'))
        return file;
    if (file.name && !GENERIC_IMAGE_NAME.test(file.name))
        return file;
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const uniqueName = `image-${generateUUID(8)}.${ext}`;
    try {
        return new File([file], uniqueName, { type: file.type, lastModified: file.lastModified });
    }
    catch {
        return file;
    }
};
export const useFileDropAndPaste = ({ enabled, onFilesReceived, allowFolders = false }) => {
    const [isDragging, setIsDragging] = useState(false);
    const dragCounter = useRef(0);
    useEffect(() => {
        if (!enabled)
            return;
        const handleDragEnter = (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter.current += 1;
            if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
                setIsDragging(true);
            }
        };
        const handleDragLeave = (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter.current -= 1;
            if (dragCounter.current === 0) {
                setIsDragging(false);
            }
        };
        const handleDragOver = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        const handleDrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
            dragCounter.current = 0;
            const dirEntries = allowFolders ? extractDroppedDirectories(e.dataTransfer) : [];
            if (dirEntries.length > 0) {
                void Promise.all(dirEntries.map((dir) => readFolderFilesRecursive(dir, ''))).then((groups) => {
                    const files = groups.flat();
                    if (files.length > 0)
                        onFilesReceived(files);
                });
                return;
            }
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                onFilesReceived(e.dataTransfer.files);
                e.dataTransfer.clearData();
            }
        };
        window.addEventListener('dragenter', handleDragEnter);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('drop', handleDrop);
        return () => {
            window.removeEventListener('dragenter', handleDragEnter);
            window.removeEventListener('dragleave', handleDragLeave);
            window.removeEventListener('dragover', handleDragOver);
            window.removeEventListener('drop', handleDrop);
        };
    }, [enabled, onFilesReceived, allowFolders]);
    const handlePaste = useCallback((e) => {
        if (!enabled)
            return;
        const items = e.clipboardData?.items;
        const files: File[] = [];
        if (items) {
            for (let i = 0; i < items.length; i++) {
                if (items[i].kind === 'file') {
                    const file = items[i].getAsFile();
                    if (file)
                        files.push(uniquifyPastedFile(file));
                }
            }
        }
        if (files.length > 0) {
            e.preventDefault();
            onFilesReceived(files);
        }
    }, [enabled, onFilesReceived]);
    return {
        isDragging,
        handlePaste
    };
};
