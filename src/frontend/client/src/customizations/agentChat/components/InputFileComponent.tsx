/* eslint-disable no-restricted-imports -- Existing Recoil implementation retained for the user-requested frontend copy. */
// Frontend fork of pages/appChat/components/InputFileComponent.tsx. Edit this copy for custom chat.
import { FileSearch2, Loader2 } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { bishengConfState } from "~/customizations/agentChat/store/atoms";
import { useRecoilState } from "recoil";
import { useToastContext } from "~/Providers";
import { Button } from "~/components";
import { uploadFile, uploadFileWithProgress } from "~/api/apps";
import useLocalize from "~/hooks/useLocalize";
interface InputFileComponentProps {
    value: string;
    onChange: (name: string | string[]) => void;
    disabled?: boolean;
    suffixes?: string | string[];
    fileTypes?: unknown;
    placeholder?: string;
    onFileChange?: (paths: string | string[]) => void;
    editNode?: boolean;
    isSSO?: boolean;
    multiple?: boolean;
    flow?: { id: string };
}
export function InputFileComponent({ value, onChange, disabled, suffixes: rawSuffixes = [], fileTypes, placeholder = 'The current file is empty', onFileChange, editNode = false, isSSO = false, multiple = false, flow }: InputFileComponentProps) {
    const suffixes = typeof rawSuffixes === "string" ? rawSuffixes.split(",") : rawSuffixes;
    const t = useLocalize();
    const [myValue, setMyValue] = useState(value);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        if (disabled) {
            setMyValue("");
            onChange("");
            onFileChange?.("");
        }
    }, [disabled, onChange]);
    function checkFileType(fileName: string): boolean {
        for (let index = 0; index < suffixes.length; index++) {
            if (fileName.endsWith(suffixes[index])) {
                return true;
            }
        }
        return false;
    }
    useEffect(() => {
        setMyValue(value);
    }, [value]);
    const [bishengConfig] = useRecoilState(bishengConfState);
    const { showToast } = useToastContext();
    const checkFileSize = (file) => {
        const maxSize = (bishengConfig?.uploaded_files_maximum_size || 50) * 1024 * 1024;
        if (file.size > maxSize) {
            return t('com_inputfile_exceed_limit', { 0: file.name, 1: (bishengConfig?.uploaded_files_maximum_size || 50) });
        }
        return '';
    };
    const handleButtonClick = () => {
        if (multiple)
            return batchUpload();
        const input = document.createElement("input");
        input.type = "file";
        input.accept = suffixes.join(",");
        input.style.display = "none";
        input.multiple = false;
        input.onchange = (e: Event) => {
            setLoading(true);
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) { setLoading(false); return; }
            const errorMsg = checkFileSize(file);
            if (errorMsg) {
                showToast({ message: errorMsg, status: 'error' });
                return setLoading(false);
            }
            isSSO ? uploadFileWithProgress(file, () => {}, "knowledge", undefined).then(res => {
                setLoading(false);
                if (typeof res === 'string')
                    return showToast({ message: res, status: 'error' });
                const { file_path } = res;
                setMyValue(file.name);
                onChange(file.name);
                onFileChange?.(file_path);
            }) : uploadFile(file, flow!.id)
                .then((data) => {
                console.log("File uploaded successfully");
                const { file_path } = data.data;
                setMyValue(file.name);
                onChange(file.name);
                onFileChange?.(file_path);
                setLoading(false);
            })
                .catch(() => {
                console.error("Error occurred while uploading file");
                setLoading(false);
            });
        };
        input.click();
    };
    const batchUpload = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = suffixes.join(",");
        input.style.display = "none";
        input.multiple = true;
        input.onchange = (e: Event) => {
            setLoading(true);
            const _files = (e.target as HTMLInputElement).files;
            if (_files && _files.length > 0) {
                const filePaths = [];
                const errorMsgs: string[] = [];
                const files: File[] = [];
                for (let i = 0; i < _files.length; i++) {
                    const errorMsg = checkFileSize(_files[i]);
                    errorMsg ? errorMsgs.push(errorMsg) : files.push(_files[i]);
                }
                if (errorMsgs.length) {
                    showToast({ message: errorMsgs.join('\n'), status: 'error' });
                    if (errorMsgs.length === _files.length) {
                        return setLoading(false);
                    }
                }
                const fileNames = Array.from(files).map(file => file.name);
                const uploadPromises = Array.from(files).map(file => {
                    return isSSO
                        ? uploadFileWithProgress(file, () => {}, "knowledge", undefined)
                            .then(res => {
                            if (typeof res === 'string') {
                                showToast({ message: res, status: 'error' });
                                setLoading(false);
                                throw new Error(res);
                            }
                            return res.file_path;
                        })
                        : uploadFile(file, flow!.id).then((data) => {
                            console.log("File uploaded successfully");
                            return data.data.file_path;
                        });
                });
                Promise.all(uploadPromises)
                    .then((filePaths) => {
                    setMyValue(fileNames.join(","));
                    onChange(fileNames);
                    onFileChange?.(filePaths);
                    setLoading(false);
                })
                    .catch((error) => {
                    console.error("Error occurred while uploading files", error);
                    setLoading(false);
                });
            }
            else {
                showToast({ message: t('com_inputfile_no_file_selected'), status: 'error' });
                setLoading(false);
            }
        };
        input.click();
    };
    return (<div className={disabled ? "input-component-div" : "w-full"}>
            <div className="input-file-component flex items-center gap-2 border bg-search-input rounded-md px-2 justify-between">
                <span onClick={handleButtonClick} className={editNode
            ? "input-edit-node input-dialog text-muted-foreground"
            : disabled
                ? "input-disable input-dialog input-primary"
                : "w-full input-dialog input-primary text-muted-foreground cursor-pointer"}>
                    {myValue !== "" ? myValue : placeholder}
                </span>
                <Button size="icon" variant="ghost" onClick={handleButtonClick}>
                    {!editNode && !loading && (<FileSearch2 strokeWidth={1.5} size={18} className={(disabled ? " text-ring " : " hover:text-accent-foreground")}/>)}
                    {!editNode && loading && (<Loader2 className="text-primary animate-spin duration-300 pointer-events-none"/>)}
                </Button>
            </div>
        </div>);
}
