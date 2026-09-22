import { parseQuestionBlocks } from './parseQuestionBlocks';

describe('question result fences', () => {
  it('preserves plain Markdown', () => {
    expect(parseQuestionBlocks('# Heading\nText')).toEqual([
      { kind: 'markdown', content: '# Heading\nText', complete: true, offset: 0 },
    ]);
  });

  it('preserves surrounding text and separates multiple results', () => {
    const blocks = parseQuestionBlocks('Intro\n```markdown-exam\nQ1\n```\nMiddle\n~~~markdown-exam\nQ2\n~~~\nEnd');
    expect(blocks.map(({ kind, content, complete }) => ({ kind, content, complete }))).toEqual([
      { kind: 'markdown', content: 'Intro\n', complete: true },
      { kind: 'exam', content: 'Q1', complete: true },
      { kind: 'markdown', content: 'Middle\n', complete: true },
      { kind: 'exam', content: 'Q2', complete: true },
      { kind: 'markdown', content: 'End', complete: true },
    ]);
  });

  it('marks streamed content without a closing fence incomplete', () => {
    expect(parseQuestionBlocks('```markdown-exam\nUnfinished')[0]).toMatchObject({
      kind: 'exam', content: 'Unfinished', complete: false,
    });
  });

  it('ignores examples inside ordinary code fences', () => {
    const content = '````text\n```markdown-exam\nExample\n```\n````';
    expect(parseQuestionBlocks(content)).toEqual([{ kind: 'markdown', content, complete: true, offset: 0 }]);
  });

  it('supports CRLF, indented fences and code inside a longer exam fence', () => {
    const blocks = parseQuestionBlocks('  ````markdown-exam\r\nQ\r\n```python\r\nprint(1)\r\n```\r\n  ````\r\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'exam', content: 'Q\r\n```python\r\nprint(1)\r\n```', complete: true });
  });

  it('does not close an exam with another fence type or trailing text', () => {
    expect(parseQuestionBlocks('```markdown-exam\nQ\n~~~\n``` trailing')[0].complete).toBe(false);
  });

  it('does not match similar language names', () => {
    expect(parseQuestionBlocks('```markdown-exam-extra\nQ\n```')[0].kind).toBe('markdown');
  });
});
