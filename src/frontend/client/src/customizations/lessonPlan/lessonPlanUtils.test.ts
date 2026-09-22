import { CUSTOM_APP_IDS } from '../config';
import { parseFencedBlocks } from '../parseFencedBlocks';
import { lessonPlanSearch, lessonPlanTarget } from './lessonPlanUtils';

describe('lesson editor targets', () => {
  it('prioritizes the unit and preserves editor parameters', () => {
    const target = lessonPlanTarget('?unitId=unit-1&cache_id=cache-1&courseId=course-1');
    expect(target?.cacheId).toBe('unit-1');
    const url = new URL(target!.editorUrl, 'https://example.com');
    expect(url.pathname).toBe('/adminManage/AiLessonEditor');
    expect(url.searchParams.get('courseId')).toBe('course-1');
    expect(url.searchParams.get('unitId')).toBe('unit-1');
  });

  it('uses an existing cache ID when no unit is given', () => {
    expect(lessonPlanTarget('?cache_id=a%2Bb')?.cacheId).toBe('a+b');
    expect(lessonPlanTarget('?cache_id=a%2Bb')?.editorUrl).toContain('cache_id=a%2Bb');
  });

  it('requires an explicit unit or cache ID', () => {
    expect(lessonPlanTarget('')).toBeNull();
    expect(lessonPlanTarget('?courseId=course-1')).toBeNull();
    expect(lessonPlanTarget('?unitId=%20&cache_id=')).toBeNull();
    expect(lessonPlanTarget('?unitId=%20&cache_id=old')?.editorUrl).not.toContain('unitId');
  });

  it('carries only lesson context during lesson navigation', () => {
    const query = '?courseId=c&unitId=u&cache_id=k&returnTo=%2Fapps&token=unused';
    expect(lessonPlanSearch(CUSTOM_APP_IDS.lessonPlan, query)).toBe('?courseId=c&unitId=u&cache_id=k');
    expect(lessonPlanSearch(CUSTOM_APP_IDS.questionHelper, query)).toBe('');
    expect(lessonPlanSearch(undefined, query)).toBe('');
    expect(lessonPlanSearch(CUSTOM_APP_IDS.lessonPlan, '')).toBe('');
  });
});

describe('lesson Markdown fences', () => {
  it('renders separate lesson blocks and preserves surrounding Markdown', () => {
    const blocks = parseFencedBlocks('Before\n```markdown-lesson\n# Lesson\n```\nAfter\n~~~markdown-lesson\nSecond\n~~~', 'markdown-lesson');
    expect(blocks.map(block => block.kind)).toEqual(['markdown', 'custom', 'markdown', 'custom']);
    expect(blocks[1]).toMatchObject({ content: '# Lesson', complete: true });
    expect(blocks[3]).toMatchObject({ content: 'Second', complete: true });
  });

  it('keeps an unclosed lesson disabled and ignores examples nested in other fences', () => {
    expect(parseFencedBlocks('```markdown-lesson\n# Partial', 'markdown-lesson')[0].complete).toBe(false);
    const example = '````text\n```markdown-lesson\n# Example\n```\n````';
    expect(parseFencedBlocks(example, 'markdown-lesson')).toEqual([
      { kind: 'markdown', content: example, complete: true, offset: 0 },
    ]);
  });
});
