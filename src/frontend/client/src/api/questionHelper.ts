import request from '~/api/request';
import { parseContentDispositionFilename, type ExportedFile } from '~/api/messageExport';

export type QuestionBank = { id: string; name: string };
type RawQuestionBank = { _id?: string; id?: string; name: string; ignore_school_isolation?: boolean };
type Envelope<T> = T | { response: T; success?: boolean; status_code?: number };

function requestOptions() {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Question service authentication is missing');
  // Override Vite's workspace base so /pyapi always resolves at the origin root.
  return { baseURL: window.location.origin, headers: { Authorization: `Bearer ${token}` }, withCredentials: true };
}

function unwrap<T>(value: Envelope<T>): T {
  if (value && typeof value === 'object') {
    if (('success' in value && value.success === false)
      || ('status_code' in value && value.status_code !== undefined && value.status_code !== 200)) {
      throw new Error('Question service rejected the request');
    }
    if ('response' in value) return value.response;
  }
  return value as T;
}

function normalizeBank(bank: RawQuestionBank): QuestionBank {
  const id = bank._id || bank.id;
  if (!id || typeof bank.name !== 'string') throw new Error('Invalid question bank response');
  return { id, name: bank.name };
}

export async function getQuestionHelperPermission(): Promise<boolean> {
  const data = unwrap(await request.get<Envelope<{ roles_permission?: { role_name?: string }[] }>>(
    '/pyapi/user/get_own_permission', requestOptions(),
  ));
  return (data.roles_permission ?? []).some(role => ['teacher', 'admin'].includes((role.role_name ?? '').toLowerCase()));
}

export async function getQuestionBanks(page: number, query: string) {
  const pageSize = 10;
  const data = unwrap(await request.get<Envelope<{ objects: RawQuestionBank[] }>>(
    '/pyapi/question/question_banks',
    { ...requestOptions(), params: { page_no: page, page_size: pageSize, show_all: false, query } },
  ));
  if (!Array.isArray(data.objects)) throw new Error('Invalid question bank list');
  return {
    banks: data.objects.filter(bank => bank.ignore_school_isolation === false).map(normalizeBank),
    // Advance using the unfiltered page, including pages with no eligible banks.
    nextPage: data.objects.length === pageSize ? page + 1 : undefined,
  };
}

export async function createQuestionBank(name: string): Promise<QuestionBank> {
  const data: Envelope<RawQuestionBank> = await request.post(
    '/pyapi/question/create/question_bank', { name }, requestOptions(),
  );
  return normalizeBank(unwrap(data));
}

export async function importQuestions(markdown: string, questionBankIds: string[]): Promise<void> {
  const data: Envelope<unknown[]> = await request.post(
    '/pyapi/question/import_markdown', { markdown, question_bank_ids: questionBankIds }, requestOptions(),
  );
  const questions = unwrap(data);
  if (!Array.isArray(questions) || !questions.length) throw new Error('No questions were imported');
}

export async function downloadQuestions(markdown: string): Promise<ExportedFile> {
  const response = await request.postResponse<{ data: Blob; headers: Record<string, string> }>(
    '/pyapi/question/export_question_from_markdown', { markdown },
    { ...requestOptions(), responseType: 'blob' },
  );
  const blob = response.data;
  const contentType = (response.headers['content-type'] || blob.type || '').toLowerCase();
  if (!(blob instanceof Blob) || !blob.size
    || !['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', 'application/vnd.ms-excel']
      .some(type => contentType.includes(type))) {
    throw new Error('Invalid question export response');
  }
  const filename = parseContentDispositionFilename(response.headers['content-disposition'] || '');
  return { blob, mimeType: contentType, filename: filename?.toLowerCase().endsWith('.xlsx') ? filename : `questions_${Date.now()}.xlsx` };
}
