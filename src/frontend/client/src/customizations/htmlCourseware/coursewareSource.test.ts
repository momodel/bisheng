import { readCoursewareSource, saveCoursewareSource } from './coursewareSource';

describe('courseware preview source', () => {
  const url = 'https://cdn.example/lesson.html?token=abc';
  const html = '<html><body>Original source</body></html>';

  it('preserves source in the destination tab, including after the component reloads', () => {
    const data = new Map<string, string>();
    const sessionStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
    };
    saveCoursewareSource({ sessionStorage }, url, html);
    expect(readCoursewareSource({ sessionStorage }, url)).toBe(html);
    expect(readCoursewareSource({ sessionStorage }, 'https://cdn.example/other.html')).toBeUndefined();
  });

  it('keeps preview opening usable when storage is unavailable', () => {
    const target = { get sessionStorage(): Storage { throw new Error('Storage denied'); } };
    expect(() => saveCoursewareSource(target, url, html)).not.toThrow();
    expect(readCoursewareSource(target, url)).toBeUndefined();
  });

  it('ignores malformed or missing saved content', () => {
    for (const value of ['bad JSON', 'null', '{}', JSON.stringify({ url, html: '' })]) {
      expect(readCoursewareSource({ sessionStorage: { getItem: () => value, setItem: () => undefined } }, url)).toBeUndefined();
    }
  });
});
