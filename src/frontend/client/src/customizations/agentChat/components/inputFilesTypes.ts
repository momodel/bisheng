import type { UploadSizeLimits } from '~/pages/knowledge/knowledgeUtils';

export type UploadFileState = {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  isUploading: boolean;
  progress: number;
  relativePath?: string;
  fileId?: string;
  file_id?: string;
  filePath?: string;
  parsingStatus?: string;
  previewUrl?: string;
  mediaPreviewUrl?: string;
  mediaCoverUrl?: string;
  cover_filepath?: string;
  mediaDurationSec?: number;
};

export type UploadedChatFile = {
  file_id: string;
  filepath?: string;
  name: string;
  type: string;
};

export interface InputFilesHandle {
  upload: (files: File[] | FileList) => void;
  removeByClientId: (id: string) => void;
  updateParsingStatus: (statuses: Map<string, unknown>) => void;
  openPicker: () => void;
  openFolderPicker: () => void;
  supportsFolderUpload: boolean;
  clear: () => void;
}

export interface InputFilesProps {
  v: string;
  showVoice?: boolean;
  accepts?: string;
  disabled?: boolean;
  size?: number;
  uploadSizeLimits?: UploadSizeLimits;
  onChange: (files: UploadedChatFile[] | null) => void;
  onFilesStateChange?: (files: UploadFileState[]) => void;
  uploadMode?: 'workstation' | 'linsight';
  allowFolderUpload?: boolean;
  hideTrigger?: boolean;
  hideList?: boolean;
}
