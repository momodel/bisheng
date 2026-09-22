import request from '~/api/request';

export async function cacheLessonPlan(cacheId: string, markdown: string): Promise<void> {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Lesson service authentication is missing');
  if (!cacheId.trim() || !markdown.trim()) throw new Error('Lesson cache ID or content is empty');
  const response: unknown = await request.post('/pyapi/course/v3/teaching_plan/cache', {
    cache_id: cacheId, markdown_content: markdown,
  }, {
    baseURL: window.location.origin,
    headers: { Authorization: `Bearer ${token}` },
    withCredentials: true,
    timeout: 30_000,
  });
  if (!response || typeof response !== 'object'
    || !('message' in response) || response.message !== 'ok'
    || ('success' in response && response.success === false)
    || ('status_code' in response && response.status_code !== 200)) {
    throw new Error('Lesson cache failed');
  }
}
