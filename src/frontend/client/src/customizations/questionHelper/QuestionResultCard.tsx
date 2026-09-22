import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@bisheng/ui';
import { downloadQuestions, getQuestionHelperPermission } from '~/api/questionHelper';
import { triggerBrowserDownload } from '~/api/messageExport';
import { NotificationSeverity } from '~/common';
import { useAuthContext, useLocalize } from '~/hooks';
import { useToastContext } from '~/Providers';
import { QuestionBankDialog } from './QuestionBankDialog';

interface QuestionResultCardProps {
  content: string;
  ready: boolean;
  readOnly: boolean;
  children: ReactNode;
}

export function QuestionResultCard({ content, ready, readOnly, children }: QuestionResultCardProps) {
  const t = useLocalize();
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const [downloading, setDownloading] = useState(false);
  const downloadLock = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importedContent, setImportedContent] = useState<string | null>(null);
  const enabled = ready && !!content.trim() && !readOnly;
  const imported = importedContent === content;
  const permission = useQuery({
    queryKey: ['question-helper', user?.id, 'permission'],
    queryFn: getQuestionHelperPermission,
    enabled,
    staleTime: 60_000,
    retry: false,
  });

  const handleDownload = async () => {
    if (!enabled || downloadLock.current) return;
    downloadLock.current = true;
    setDownloading(true);
    try {
      triggerBrowserDownload(await downloadQuestions(content));
    } catch {
      showToast({ message: t('questionHelper.downloadFailed'), severity: NotificationSeverity.ERROR });
    } finally {
      downloadLock.current = false;
      setDownloading(false);
    }
  };

  return <section className="my-3 overflow-hidden rounded-xl border border-border-base bg-background">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-base bg-fill-1 px-4 py-3">
      <span className="text-body-sm font-semibold text-text-1">{t('questionHelper.title')}</span>
      {!readOnly && <div className="flex flex-wrap gap-2">
        <Button color="default" variant="outlined" size="medium" disabled={!enabled || downloading}
          loading={downloading} onClick={handleDownload}>{t('questionHelper.download')}</Button>
        {permission.data && <Button size="medium" disabled={!enabled || imported} onClick={() => setDialogOpen(true)}>
          {t(imported ? 'questionHelper.imported' : 'questionHelper.addToBank')}
        </Button>}
      </div>}
    </div>
    <div className="px-4 py-3">{children}</div>
    {!ready && <p className="px-4 pb-3 text-caption text-text-3" role="status">{t('questionHelper.waitForCompletion')}</p>}
    {enabled && permission.isError && <div className="flex flex-wrap items-center gap-2 px-4 pb-3" role="alert">
      <span className="text-caption text-text-3">{t('questionHelper.permissionFailed')}</span>
      <Button color="default" variant="text" size="small" loading={permission.isFetching}
        onClick={() => void permission.refetch()}>{t('questionHelper.retry')}</Button>
    </div>}
    {dialogOpen && enabled && permission.data && !imported && <QuestionBankDialog content={content}
      onClose={() => setDialogOpen(false)} onImported={value => { setImportedContent(value); setDialogOpen(false); }} />}
  </section>;
}
