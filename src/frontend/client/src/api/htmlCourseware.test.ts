import request from '~/api/request';
import { downloadHtmlCourseware, parseCoursewareUrl, uploadHtmlCourseware } from './htmlCourseware';

jest.mock('~/api/request', () => ({ __esModule: true, default: { post: jest.fn(), get: jest.fn() } }));
const mockedRequest = request as jest.Mocked<typeof request>;
const file = { name: 'lesson.html', url: 'https://cdn.example/lesson.html' };

describe('courseware upload', () => {
  beforeEach(() => { localStorage.setItem('token', 'test-courseware-user'); });
  afterEach(() => { localStorage.removeItem('token'); });

  it('uploads exact HTML through the root proxy with the current business token', async () => {
    mockedRequest.post.mockResolvedValue({ response: file });
    const html = '<html><body><script>let a = 1;</script></body></html>';
    expect(await uploadHtmlCourseware(html)).toEqual(file);
    expect(mockedRequest.post).toHaveBeenLastCalledWith('/pyapi/cloud_disk/upload_html', { html_content: html }, {
      baseURL: window.location.origin, headers: { Authorization: 'Bearer test-courseware-user' }, withCredentials: true,
    });
    localStorage.setItem('token', 'refreshed-token');
    mockedRequest.post.mockResolvedValue(file);
    await uploadHtmlCourseware(html);
    expect(mockedRequest.post).toHaveBeenLastCalledWith(expect.any(String), expect.any(Object), expect.objectContaining({
      headers: { Authorization: 'Bearer refreshed-token' },
    }));
  });

  it('rejects a missing login or empty body without sending a request', async () => {
    await expect(uploadHtmlCourseware(' ')).rejects.toThrow();
    localStorage.removeItem('token');
    await expect(uploadHtmlCourseware('<html></html>')).rejects.toThrow();
    expect(mockedRequest.post).not.toHaveBeenCalled();
  });

  it.each([null, { success: false }, { status_code: 500, response: file }, { response: {} },
    { response: { ...file, url: 'javascript:alert(1)' } }, { response: { ...file, name: '' } },
  ])('rejects invalid or failed responses: %j', async response => {
    mockedRequest.post.mockResolvedValue(response);
    await expect(uploadHtmlCourseware('<html></html>')).rejects.toThrow();
  });

  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test.html', '/local-path',
    'https://user:password@example.com/file.html', '', null,
  ])('rejects unsupported preview URLs: %s', url => {
    expect(parseCoursewareUrl(url)).toBeNull();
  });

  it('accepts HTTP(S) cloud links including signed queries', () => {
    expect(parseCoursewareUrl('https://cdn.example/lesson.html?token=a%2Bb')).toBe('https://cdn.example/lesson.html?token=a%2Bb');
    expect(parseCoursewareUrl('http://cdn.example/lesson.html')).toBe('http://cdn.example/lesson.html');
  });
});

describe('courseware downloads', () => {
  it('downloads the original source without needing cloud CORS or an attachment header', async () => {
    const source = '<html><body>original lesson</body></html>';
    const result = await downloadHtmlCourseware(file.url, 'lesson', source);
    expect(await result.blob.text()).toBe(source);
    expect(result.filename).toBe('lesson.html');
    expect(mockedRequest.get).not.toHaveBeenCalled();
  });

  it('fetches uncached files as binary without sending main-site credentials or changing signed URLs', async () => {
    const blob = new Blob(['<html>lesson</html>'], { type: 'text/html' });
    mockedRequest.get.mockResolvedValue(blob);
    const url = `${file.url}?token=a%20b%2b~`;
    expect((await downloadHtmlCourseware(url, 'a/b.html')).blob).toBe(blob);
    expect(mockedRequest.get).toHaveBeenCalledWith(url, expect.objectContaining({
      responseType: 'blob', withCredentials: false, withXSRFToken: false, headers: { Authorization: false },
    }));
  });

  it.each([new Blob([], { type: 'text/html' }), new Blob(['{"error":"denied"}'], { type: 'application/json' })])
    ('rejects empty and error responses', async blob => {
      mockedRequest.get.mockResolvedValue(blob);
      await expect(downloadHtmlCourseware(file.url, file.name)).rejects.toThrow();
    });

  it('surfaces a failed cloud read instead of opening the URL in another tab', async () => {
    mockedRequest.get.mockRejectedValue(new Error('CORS unavailable'));
    await expect(downloadHtmlCourseware(file.url, file.name)).rejects.toThrow('CORS unavailable');
  });
});
