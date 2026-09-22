import request from '~/api/request';
import { cacheLessonPlan } from './lessonPlan';

jest.mock('~/api/request', () => ({ __esModule: true, default: { post: jest.fn() } }));
const mockedRequest = request as jest.Mocked<typeof request>;

describe('lesson cache', () => {
  beforeEach(() => localStorage.setItem('token', 'test-lesson-user'));
  afterEach(() => localStorage.removeItem('token'));

  it('sends exact Markdown and current business token to the root proxy', async () => {
    mockedRequest.post.mockResolvedValue({ message: 'ok' });
    const markdown = '# Lesson\n\n| Topic | Time |\n| --- | --- |\n| Intro | 5 |';
    await cacheLessonPlan('unit-1', markdown);
    expect(mockedRequest.post).toHaveBeenLastCalledWith('/pyapi/course/v3/teaching_plan/cache', {
      cache_id: 'unit-1', markdown_content: markdown,
    }, {
      baseURL: window.location.origin, headers: { Authorization: 'Bearer test-lesson-user' },
      withCredentials: true, timeout: 30_000,
    });
    localStorage.setItem('token', 'test-refreshed');
    await cacheLessonPlan('unit-1', markdown);
    expect(mockedRequest.post).toHaveBeenLastCalledWith(expect.any(String), expect.any(Object),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-refreshed' } }));
  });

  it('rejects missing IDs, empty content and missing login before sending', async () => {
    await expect(cacheLessonPlan('', '# Lesson')).rejects.toThrow();
    await expect(cacheLessonPlan('id', ' ')).rejects.toThrow();
    localStorage.removeItem('token');
    await expect(cacheLessonPlan('id', '# Lesson')).rejects.toThrow();
    expect(mockedRequest.post).not.toHaveBeenCalled();
  });

  it.each([null, {}, { message: 'failed' }, { message: 'ok', success: false },
    { message: 'ok', status_code: 500 }, '<html>login</html>'])('rejects unsuccessful responses: %j', async response => {
    mockedRequest.post.mockResolvedValue(response);
    await expect(cacheLessonPlan('id', '# Lesson')).rejects.toThrow();
  });

  it('propagates network errors for a retry', async () => {
    mockedRequest.post.mockRejectedValue(new Error('offline'));
    await expect(cacheLessonPlan('id', '# Lesson')).rejects.toThrow('offline');
  });
});
