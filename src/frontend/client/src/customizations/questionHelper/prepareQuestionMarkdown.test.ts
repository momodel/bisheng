import { prepareQuestionMarkdown } from './prepareQuestionMarkdown';

describe('question answer display normalization', () => {
  it('preserves ordinary prose and existing fences', () => {
    const content = '# Programming\n1. Explain the result.\n```python\nif __name__ == "__main__":\n    print(1)\n```';
    expect(prepareQuestionMarkdown(content)).toBe(content);
  });

  it('protects an unfenced quoted function as one text segment without added empty lines', () => {
    const content = '> **Answer**: def int_to_twos_complement(num, bit_width):\n' +
      '>     max_positive = (1 << (bit_width - 1)) - 1\n' +
      '>     min_negative = -(1 << (bit_width - 1))\n' +
      '>     if num >= 0:\n>         return bin(num)[2:].zfill(bit_width)\n' +
      '>     else:\n>         return bin((1 << bit_width) + num)[2:]\n' +
      '> if __name__ == "__main__":\n>     print("$5")\n> **Difficulty**: Advanced';
    const normalized = prepareQuestionMarkdown(content);
    expect(normalized).toContain('> **Answer**:\n>\n> ~~~\n> def int_to_twos_complement');
    expect(normalized).toContain('>     max_positive = (1 << (bit_width - 1)) - 1\n>     min_negative');
    expect(normalized).toContain('> if __name__ == "__main__":');
    expect(normalized).toContain('> ~~~\n>\n> **Difficulty**: Advanced');
    expect(content).not.toContain('~~~');
  });

  it('does not reinterpret a Python declaration inside an existing code fence', () => {
    const content = '````text\n> **Answer**: def f():\n>     print(1)\n````\n' +
      '> ```python\n> def f():\n>     print(1)\n> ```';
    expect(prepareQuestionMarkdown(content)).toBe(content);
  });

  it('handles classes, async functions, CRLF and full-width label colons', () => {
    const content = '> **Answer**\uFF1Aasync def f():\r\n>     return 1\r\n> **Analysis**: Details';
    expect(prepareQuestionMarkdown(content)).toContain('> async def f():\n>     return 1');
    expect(prepareQuestionMarkdown('> class Example:\n>     pass')).toContain('> ~~~\n> class Example:\n>     pass');
  });

  it('uses a fence longer than tildes inside the answer', () => {
    const content = '> def f():\n>     return "~~~"';
    expect(prepareQuestionMarkdown(content)).toContain('> ~~~~\n> def f():');
  });

  it('normalizes prose math without rewriting fenced or indented code', () => {
    const code = '~~~python\nprice = "$5"\npattern = "\\\\(x\\\\)"\n~~~\n\n    price = "$5"';
    const normalized = prepareQuestionMarkdown(`Formula: \\(x^2\\)\n${code}`);
    expect(normalized).toContain('Formula: $x^2$');
    expect(normalized).toContain(code);
    expect(prepareQuestionMarkdown('> def f():\n>     return "$5"')).toContain('>     return "$5"');
  });

  it('protects mixed quoted code without consuming the next field or question', () => {
    const content = '> **Answer**:\n> def f():\n\n    return __name__\n\n' +
      '> **Difficulty**: Basic\n\n> **Analysis**: Explanation.\n\n## Next question\n2. Continue.';
    const normalized = prepareQuestionMarkdown(content);
    expect(normalized).toContain('> def f():\n> \n>     return __name__');
    expect(normalized).toContain('> **Difficulty**: Basic\n>\n> **Analysis**: Explanation.');
    expect(normalized).toContain('\n\n## Next question\n2. Continue.');
    expect(content).toContain('\n\n    return __name__');
  });
});
