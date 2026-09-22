import { parseFencedBlocks } from '../parseFencedBlocks';
import { coursewareFilename, coursewarePreviewLink, isHtmlComplete } from './coursewareUtils';

describe('courseware messages', () => {
  it('preserves surrounding text and separates multiple HTML documents', () => {
    const blocks = parseFencedBlocks('Before\n```html\n<html>one</html>\n```\nBetween\n~~~html\n<body>two</body>\n~~~\nAfter', 'html');
    expect(blocks.map(block => [block.kind, block.content, block.complete])).toEqual([
      ['markdown', 'Before\n', true], ['custom', '<html>one</html>', true],
      ['markdown', 'Between\n', true], ['custom', '<body>two</body>', true], ['markdown', 'After', true],
    ]);
  });

  it('does not make an unfinished stream ready even after the HTML end tag', () => {
    const [block] = parseFencedBlocks('```html\n<html>one</html>', 'html');
    expect(block.kind).toBe('custom');
    expect(block.complete).toBe(false);
    expect(isHtmlComplete(block.content)).toBe(true);
    expect(isHtmlComplete('<html><body>unfinished')).toBe(false);
  });

  it('leaves HTML samples inside ordinary fences and other languages unchanged', () => {
    const text = '````text\n```html\n<html>example</html>\n```\n````\n```html-extra\ntext\n```';
    expect(parseFencedBlocks(text, 'html')).toEqual([{ kind: 'markdown', content: text, complete: true, offset: 0 }]);
  });

  it('handles CRLF, longer fences and trailing whitespace', () => {
    const [block] = parseFencedBlocks('  ````html\r\n<HTML>\r\n```\r\n</HTML>\r\n  ````\r\n', 'html');
    expect(block.complete).toBe(true);
    expect(isHtmlComplete(block.content)).toBe(true);
    expect(isHtmlComplete('<body>content</body>  \n')).toBe(true);
  });

  it('creates a usable filename without path separators or control characters', () => {
    expect(coursewareFilename('<title>A/B: lesson\n</title>')).toBe('AB lesson.html');
    expect(coursewareFilename('<body>No title</body>')).toBe('courseware.html');
    expect(coursewareFilename('<title>lesson.HTML</title>')).toBe('lesson.HTML');
  });

  it('preserves the deployment prefix and signed URLs in preview links', () => {
    const file = { name: 'lesson & examples.html', url: 'https://cdn.example/lesson.html?token=a%2Bb&expires=1' };
    const link = coursewarePreviewLink('/mo-agent/workspace/custom-app/html-preview', file);
    const url = new URL(link, 'https://app.example');
    expect(url.pathname).toBe('/mo-agent/workspace/custom-app/html-preview');
    expect(url.searchParams.get('url')).toBe(file.url);
    expect(url.searchParams.get('name')).toBe(file.name);

  });
});
