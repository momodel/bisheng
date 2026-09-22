export function isHtmlComplete(html: string): boolean {
  return /<\/(?:html|body)>\s*$/i.test(html.trim());
}

export function coursewareFilename(html: string): string {
  const title = /<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
  const name = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 80) || 'courseware';
  return /\.html$/i.test(name) ? name : `${name}.html`;
}

export function coursewarePreviewLink(path: string, file: { url: string; name: string }): string {
  return `${path}?${new URLSearchParams({ url: file.url, name: file.name })}`;
}
