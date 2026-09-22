import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@bisheng/ui';
import { downloadHtmlCourseware, parseCoursewareUrl } from '~/api/htmlCourseware';
import { triggerBrowserDownload } from '~/api/messageExport';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { useToastContext } from '~/Providers';
import { readCoursewareSource } from './coursewareSource';

export function HtmlCoursewarePreview() {
  const t = useLocalize();
  const { showToast } = useToastContext();
  const [params] = useSearchParams();
  const url = parseCoursewareUrl(params.get('url'));
  const name = params.get('name') || t('htmlCourseware.title');
  const [downloading, setDownloading] = useState(false);
  const downloadLock = useRef(false);

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast({ message: t('htmlCourseware.copied'), severity: NotificationSeverity.SUCCESS });
    } catch {
      showToast({ message: t('htmlCourseware.copyFailed'), severity: NotificationSeverity.ERROR });
    }
  };

  const handleDownload = async () => {
    if (!url || downloadLock.current) return;
    downloadLock.current = true;
    setDownloading(true);
    try {
      const file = await downloadHtmlCourseware(url, name, readCoursewareSource(window, url));
      triggerBrowserDownload(file);
    } catch {
      showToast({ message: t('htmlCourseware.previewDownloadFailed'), severity: NotificationSeverity.ERROR });
    } finally {
      downloadLock.current = false;
      setDownloading(false);
    }
  };

  if (!url) return <div className="flex h-screen items-center justify-center bg-background px-4 text-body text-text-3" role="alert">
    {t('htmlCourseware.invalidUrl')}
  </div>;

  return <main className="flex h-screen min-h-0 flex-col bg-background">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-base px-4 py-3">
      <h1 className="min-w-0 flex-1 truncate text-body font-semibold text-text-1" title={name}>{name}</h1>
      <div className="flex flex-wrap gap-2">
        <Button color="default" variant="outlined" size="medium" onClick={handleCopy}>{t('htmlCourseware.copyLink')}</Button>
        <Button size="medium" loading={downloading} disabled={downloading} onClick={handleDownload}>{t('htmlCourseware.download')}</Button>
      </div>
    </header>
    <iframe src={url} title={t('htmlCourseware.previewTitle')} sandbox="allow-scripts allow-popups"
      referrerPolicy="no-referrer" className="block min-h-0 w-full flex-1 border-0 bg-white" />
  </main>;
}
