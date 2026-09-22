import { CUSTOM_APP_IDS, LESSON_PLAN_EDITOR_PATH } from '../config';

export function lessonPlanTarget(search: string) {
  const params = new URLSearchParams(search);
  const cacheId = params.get('unitId')?.trim() || params.get('cache_id')?.trim();
  if (!cacheId) return null;
  if (!params.get('unitId')?.trim()) {
    params.delete('unitId');
    params.set('cache_id', cacheId);
  } else {
    params.set('unitId', cacheId);
  }
  return { cacheId, editorUrl: `${LESSON_PLAN_EDITOR_PATH}?${params.toString()}` };
}

/** Carry the teaching context only when navigating within the lesson application. */
export function lessonPlanSearch(appId: string | undefined, search: string): string {
  if (appId !== CUSTOM_APP_IDS.lessonPlan) return '';
  const source = new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const key of ['courseId', 'unitId', 'cache_id']) {
    const value = source.get(key);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
