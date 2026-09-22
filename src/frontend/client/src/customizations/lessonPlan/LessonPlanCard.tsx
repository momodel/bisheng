import { useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@bisheng/ui';
import { cacheLessonPlan } from '~/api/lessonPlan';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { useToastContext } from '~/Providers';
import { lessonPlanTarget } from './lessonPlanUtils';

interface LessonPlanCardProps {
  content: string;
  ready: boolean;
  readOnly: boolean;
  children: ReactNode;
}

export function LessonPlanCard({ content, ready, readOnly, children }: LessonPlanCardProps) {
  const t = useLocalize();
  const { search } = useLocation();
  const { showToast } = useToastContext();
  const [uploading, setUploading] = useState(false);
  const uploadLock = useRef(false);
  const target = lessonPlanTarget(search);
  const enabled = ready && !!content.trim() && !readOnly && !!target;

  const handleOpen = async () => {
    if (!enabled || !target || uploadLock.current) return;
    // Reserve the tab before caching to keep the browser's user activation.
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      showToast({ message: t('lessonPlan.popupBlocked'), severity: NotificationSeverity.ERROR });
      return;
    }
    uploadLock.current = true;
    setUploading(true);
    try {
      tab.opener = null;
      tab.document.title = t('lessonPlan.uploading');
      tab.document.body.textContent = t('lessonPlan.uploading');
      await cacheLessonPlan(target.cacheId, content);
      if (!tab.closed) tab.location.replace(target.editorUrl);
    } catch {
      if (!tab.closed) tab.close();
      showToast({ message: t('lessonPlan.openFailed'), severity: NotificationSeverity.ERROR });
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  };

  return <section className="my-3 min-w-0 overflow-hidden rounded-xl border border-border-base bg-background">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-base bg-fill-1 px-4 py-3">
      <span className="text-body-sm font-semibold text-text-1">{t('lessonPlan.title')}</span>
      {!readOnly && target && <Button size="medium" disabled={!enabled || uploading} loading={uploading} onClick={handleOpen}>
        {t(uploading ? 'lessonPlan.uploading' : 'lessonPlan.openPage')}
      </Button>}
    </div>
    <div className="overflow-x-auto px-4 py-3 text-body-sm text-text-1">{children}</div>
    {!ready && <p className="px-4 pb-3 text-caption text-text-3" role="status">{t('lessonPlan.waitForCompletion')}</p>}
  </section>;
}
