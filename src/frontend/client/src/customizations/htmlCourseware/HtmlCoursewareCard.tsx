import { useMemo, useRef, useState } from 'react';
import { useHref } from 'react-router-dom';
import { Outlined } from 'bisheng-icons';
import { Button } from '@bisheng/ui';
import { uploadHtmlCourseware, type UploadedCourseware } from '~/api/htmlCourseware';
import { triggerBrowserDownload } from '~/api/messageExport';
import { NotificationSeverity } from '~/common';
import { buildSandboxedSrcDoc } from '~/utils/sandboxedHtml';
import { useLocalize } from '~/hooks';
import { useToastContext } from '~/Providers';
import { coursewareFilename, coursewarePreviewLink, isHtmlComplete } from './coursewareUtils';
import { saveCoursewareSource } from './coursewareSource';
import { showCoursewareLoading } from './showCoursewareLoading';

interface HtmlCoursewareCardProps {
  html: string;
  ready: boolean;
  readOnly: boolean;
  generating?: boolean;
}

export function HtmlCoursewareCard({ html, ready, readOnly, generating = false }: HtmlCoursewareCardProps) {
  const t = useLocalize();
  const { showToast } = useToastContext();
  const previewPath = useHref('/custom-app/html-preview');
  const [uploading, setUploading] = useState(false);
  const uploadLock = useRef(false);
  const uploaded = useRef<{ html: string; file: UploadedCourseware } | null>(null);
  const complete = ready && isHtmlComplete(html);
  const previewHtml = useMemo(() => complete ? buildSandboxedSrcDoc(html) : undefined, [complete, html]);

  const handleDownload = () => {
    if (!complete || readOnly) return;
    try {
      triggerBrowserDownload({
        blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
        filename: coursewareFilename(html), mimeType: 'text/html',
      });
    } catch {
      showToast({ message: t('htmlCourseware.downloadFailed'), severity: NotificationSeverity.ERROR });
    }
  };

  const handleOpen = async () => {
    if (!complete || readOnly || uploadLock.current) return;
    // Reserve the tab during the click so an asynchronous upload does not trigger popup blocking.
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      showToast({ message: t('htmlCourseware.popupBlocked'), severity: NotificationSeverity.ERROR });
      return;
    }
    tab.opener = null;
    showCoursewareLoading(tab, t('htmlCourseware.uploading'));
    uploadLock.current = true;
    setUploading(true);
    try {
      const file = uploaded.current?.html === html ? uploaded.current.file : await uploadHtmlCourseware(html);
      uploaded.current = { html, file };
      if (!tab.closed) {
        saveCoursewareSource(tab, file.url, html);
        tab.location.replace(coursewarePreviewLink(previewPath, file));
      }
    } catch {
      if (!tab.closed) tab.close();
      showToast({ message: t('htmlCourseware.uploadFailed'), severity: NotificationSeverity.ERROR });
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  };

  return <section className="my-3 w-full min-w-0 overflow-hidden rounded-xl border border-border-base bg-background">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-base bg-fill-1 px-4 py-3">
      <span className="text-body-sm font-semibold text-text-1">{t('htmlCourseware.title')}</span>
      {!readOnly && <div className="flex flex-wrap gap-2">
        <Button color="default" variant="outlined" size="medium" disabled={!complete} onClick={handleDownload}>
          {t('htmlCourseware.download')}
        </Button>
        <Button size="medium" disabled={!complete || uploading} loading={uploading} onClick={handleOpen}>
          {t(uploading ? 'htmlCourseware.uploading' : 'htmlCourseware.openPage')}
        </Button>
      </div>}
    </div>
    {complete
      ? <iframe srcDoc={previewHtml} title={t('htmlCourseware.previewTitle')} sandbox="allow-scripts allow-popups"
          referrerPolicy="no-referrer" className="block h-[600px] w-full border-0 bg-white" />
      : <div className="flex items-center gap-2 px-4 py-8" role="status">
          {generating && <Outlined.Loading size={16} className="shrink-0 animate-spin text-text-3" aria-hidden />}
          <p className="text-body-sm text-text-3">{t('htmlCourseware.waitForCompletion')}</p>
        </div>}
  </section>;
}
