import request from '~/api/request';
import { createQuestionBank, downloadQuestions, getQuestionBanks, getQuestionHelperPermission, importQuestions } from './questionHelper';

jest.mock('~/api/request', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), postResponse: jest.fn() },
}));

const mockedRequest = request as jest.Mocked<typeof request>;

describe('question helper API adapter', () => {
  beforeEach(() => { localStorage.setItem('token', 'test-question-user'); });
  afterEach(() => { localStorage.removeItem('token'); });

  it('uses the root proxy and reads the current token on every request', async () => {
    mockedRequest.get.mockResolvedValue({ response: { roles_permission: [{ role_name: 'Teacher' }] } });
    expect(await getQuestionHelperPermission()).toBe(true);
    expect(mockedRequest.get).toHaveBeenLastCalledWith('/pyapi/user/get_own_permission', expect.objectContaining({
      baseURL: window.location.origin, headers: { Authorization: 'Bearer test-question-user' }, withCredentials: true,
    }));
    localStorage.setItem('token', 'test-refreshed-user');
    await getQuestionHelperPermission();
    expect(mockedRequest.get).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      headers: { Authorization: 'Bearer test-refreshed-user' },
    }));
  });

  it('does not expose import permission to other roles', async () => {
    mockedRequest.get.mockResolvedValue({ roles_permission: [{ role_name: 'student' }] });
    expect(await getQuestionHelperPermission()).toBe(false);
  });

  it('rejects a missing business login before making a request', async () => {
    localStorage.removeItem('token');
    await expect(getQuestionHelperPermission()).rejects.toThrow();
    expect(mockedRequest.get).not.toHaveBeenCalled();
  });

  it('advances across fully filtered pages and sends the search term', async () => {
    mockedRequest.get.mockResolvedValue({ objects: Array.from({ length: 10 }, (_, index) => ({
      _id: String(index), name: 'Shared', ignore_school_isolation: true,
    })) });
    expect(await getQuestionBanks(2, 'algebra')).toEqual({ banks: [], nextPage: 3 });
    expect(mockedRequest.get).toHaveBeenLastCalledWith('/pyapi/question/question_banks', expect.objectContaining({
      params: { page_no: 2, page_size: 10, show_all: false, query: 'algebra' },
    }));
  });

  it('normalizes IDs and terminates on a short page', async () => {
    mockedRequest.get.mockResolvedValue({ response: { objects: [{ _id: 'bank-1', name: 'Math', ignore_school_isolation: false }] } });
    expect(await getQuestionBanks(1, '')).toEqual({ banks: [{ id: 'bank-1', name: 'Math' }], nextPage: undefined });
    mockedRequest.post.mockResolvedValue({ response: { id: 'bank-2', name: 'New' } });
    expect(await createQuestionBank('New')).toEqual({ id: 'bank-2', name: 'New' });
  });

  it('imports the exact question body into all selected banks', async () => {
    mockedRequest.post.mockResolvedValue([{ _id: 'question-1' }]);
    await importQuestions('# Question\nAnswer', ['bank-1', 'bank-2']);
    expect(mockedRequest.post).toHaveBeenCalledWith('/pyapi/question/import_markdown', {
      markdown: '# Question\nAnswer', question_bank_ids: ['bank-1', 'bank-2'],
    }, expect.any(Object));
  });

  it('does not report success for a business error or empty import', async () => {
    mockedRequest.post.mockResolvedValue({ success: false, message: 'Invalid questions' });
    await expect(importQuestions('Q', ['bank-1'])).rejects.toThrow();
    mockedRequest.post.mockResolvedValue([]);
    await expect(importQuestions('Q', ['bank-1'])).rejects.toThrow();
  });

  it('downloads a binary Excel response and honors the filename', async () => {
    const blob = new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    mockedRequest.postResponse.mockResolvedValue({ data: blob, headers: {
      'content-type': blob.type, 'content-disposition': 'attachment; filename="questions.xlsx"',
    } });
    expect(await downloadQuestions('Q')).toEqual({ blob, filename: 'questions.xlsx', mimeType: blob.type });
    expect(mockedRequest.postResponse).toHaveBeenCalledWith('/pyapi/question/export_question_from_markdown', { markdown: 'Q' }, expect.objectContaining({ responseType: 'blob' }));
  });

  it.each(['application/json', 'text/html'])('rejects a %s response instead of downloading a corrupt Excel file', async type => {
    mockedRequest.postResponse.mockResolvedValue({ data: new Blob(['error'], { type }), headers: { 'content-type': type } });
    await expect(downloadQuestions('Q')).rejects.toThrow();
  });
});
