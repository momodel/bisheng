const SOURCE_KEY = 'custom-html-courseware:source';
type PreviewWindow = { sessionStorage: Pick<Storage, 'getItem' | 'setItem'> };

/** Preserve source in the destination tab so downloads do not depend on storage CORS. */
export function saveCoursewareSource(target: PreviewWindow, url: string, html: string): void {
  try {
    target.sessionStorage.setItem(SOURCE_KEY, JSON.stringify({ url, html }));
  } catch {
    // Storage can be unavailable or full; the preview still has its cloud URL.
  }
}

export function readCoursewareSource(target: PreviewWindow, url: string): string | undefined {
  try {
    const source: unknown = JSON.parse(target.sessionStorage.getItem(SOURCE_KEY) ?? 'null');
    if (source && typeof source === 'object' && 'url' in source && source.url === url
      && 'html' in source && typeof source.html === 'string' && source.html.trim()) {
      return source.html;
    }
  } catch {
    // A manually opened preview may have no cached source.
  }
  return undefined;
}
