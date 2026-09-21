import request from '~/api/request';
import type { ExportedFile } from '~/api/messageExport';

export type UploadedCourseware = { name: string; url: string };

export function parseCoursewareUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export async function uploadHtmlCourseware(html: string): Promise<UploadedCourseware> {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Courseware service authentication is missing');
  if (!html.trim()) throw new Error('Courseware content is empty');
  const response: unknown = await request.post('/pyapi/cloud_disk/upload_html', { html_content: html }, {
    baseURL: window.location.origin,
    headers: { Authorization: `Bearer ${token}` },
    withCredentials: true,
  });
  if (!isRecord(response) || response.success === false
    || (response.status_code !== undefined && response.status_code !== 200)) {
    throw new Error('Courseware upload failed');
  }
  const data = 'response' in response ? response.response : response;
  if (!isRecord(data)) throw new Error('Invalid courseware response');
  const url = parseCoursewareUrl(data.url);
  if (!url || typeof data.name !== 'string' || !data.name.trim()) {
    throw new Error('Invalid courseware file');
  }
  return { name: data.name, url };
}

export async function downloadHtmlCourseware(url: string, name: string, source?: string): Promise<ExportedFile> {
  const resourceUrl = parseCoursewareUrl(url);
  if (!resourceUrl) throw new Error('Invalid courseware URL');
  const blob = source?.trim()
    ? new Blob([source], { type: 'text/html;charset=utf-8' })
    : await request.get<Blob>(resourceUrl, {
        responseType: 'blob', timeout: 30_000, withCredentials: false, withXSRFToken: false,
        // Cloud resources must never receive the application's authentication headers.
        headers: { Authorization: false },
      });
  if (!(blob instanceof Blob) || !blob.size
    || !/^(text\/(html|plain)|application\/(xhtml\+xml|octet-stream))(;|$)/i.test(blob.type)) {
    throw new Error('Invalid courseware download');
  }
  const safeName = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 120) || 'courseware';
  return {
    blob, filename: /\.html?$/i.test(safeName) ? safeName : `${safeName}.html`, mimeType: 'text/html',
  };
}
