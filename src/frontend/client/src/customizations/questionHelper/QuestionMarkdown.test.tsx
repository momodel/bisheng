import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QuestionMarkdown } from './QuestionMarkdown';
import { QuestionMessageContent } from './QuestionMessageContent';

jest.mock('~/components/Chat/Messages/Content/Markdown', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div data-testid="ordinary-markdown">{content}</div>,
  a: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
jest.mock('./QuestionResultCard', () => ({
  QuestionResultCard: ({ content, ready, children }: { content: string; ready: boolean; children: ReactNode }) =>
    <section data-testid="question-card" data-content={content} data-ready={String(ready)}>{children}</section>,
}));

describe('question Markdown plain code display', () => {
  it('shows one fenced Python answer as plain text with its original whitespace', () => {
    const answer = 'def convert(num):\n    if num >= 0:\n        return bin(num)[2:]\n    else:\n        return "negative"\n\nif __name__ == "__main__":\n    print(convert(1))';
    const view = render(<QuestionMarkdown content={`## Programming\n1. Convert a number.\n\n\`\`\`python\n${answer}\n\`\`\``} />);

    expect(screen.getByRole('heading', { name: 'Programming' })).toBeInTheDocument();
    expect(view.container.querySelector('.codeText')?.textContent).toBe(`${answer}\n`);
    expect(view.container.querySelectorAll('.codeText')).toHaveLength(1);
    expect(view.container.querySelector('pre, code, button, .hljs, [class*="language-"]')).toBeNull();
    expect(screen.queryByText('python')).not.toBeInTheDocument();
  });

  it('keeps the reported unfenced quoted Python answer together without language guessing', () => {
    const content = '> **Answer**: def int_to_twos_complement(num, bit_width):\n' +
      '>     max_positive = (1 << (bit_width - 1)) - 1\n' +
      '>     min_negative = -(1 << (bit_width - 1))\n' +
      '>     if num >= 0:\n>         return bin(num)[2:].zfill(bit_width)\n' +
      '>     else:\n>         return bin((1 << bit_width) + num)[2:]\n' +
      '> if __name__ == "__main__":\n>     print("$5")\n> **Difficulty**: Advanced';
    const view = render(<QuestionMarkdown content={content} />);

    expect(view.container.querySelectorAll('.codeText')).toHaveLength(1);
    const code = view.container.querySelector('.codeText')?.textContent;
    expect(code).toContain('    max_positive = (1 << (bit_width - 1)) - 1\n    min_negative');
    expect(code).toContain('    if num >= 0:\n        return bin(num)[2:].zfill(bit_width)');
    expect(code).toContain('if __name__ == "__main__":\n    print("$5")');
    expect(view.container.querySelector('strong')).toHaveTextContent('Answer');
    expect(screen.getByText('Difficulty')).toBeInTheDocument();
    expect(view.container.querySelector('pre, code, button, .hljs, [class*="language-"]')).toBeNull();
    expect(screen.queryByText(/^(less|scss|yaml)$/)).not.toBeInTheDocument();
  });

  it('keeps Markdown tables, lists, links and math without styling inline code', () => {
    const content = '# Questions\n1. Use `bit_width`.\n\n| Name | Value |\n| --- | --- |\n| X | 1 |\n\n[Reference](https://example.com)\n\nFormula: \\(x^2\\)';
    const view = render(<QuestionMarkdown content={content} />);
    expect(screen.getByRole('heading', { name: 'Questions' })).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reference' })).toHaveAttribute('href', 'https://example.com');
    expect(screen.getByText('bit_width')).toBeInTheDocument();
    expect(view.container.querySelector('math')).not.toBeNull();
    expect(view.container.querySelector('code, button')).toBeNull();
  });

  it('keeps mixed quoted and unquoted answer lines inside one continuous details region', () => {
    const content = '> **Answer**:\n> def calc_accuracy(y_true, y_pred):\n\n' +
      '    correct = 0\n    for t, p in zip(y_true, y_pred):\n' +
      '>         if t == p:\n            correct += 1\n\n' +
      '    return correct / len(y_true)\n\nif __name__ == "__main__":\n    print("$5")\n\n' +
      '> **Difficulty**: Basic\n\n> **Tags**: Classification\n> **Analysis**: Compare the labels.';
    const view = render(<QuestionMarkdown content={content} />);
    const quote = view.container.querySelector('blockquote');
    const code = view.container.querySelector('.codeText');

    expect(view.container.querySelectorAll('blockquote')).toHaveLength(1);
    expect(view.container.querySelectorAll('.codeText')).toHaveLength(1);
    expect(code?.closest('blockquote')).toBe(quote);
    expect(code?.textContent).toContain('    correct = 0\n    for t, p in zip(y_true, y_pred):\n        if t == p:\n            correct += 1');
    expect(code?.textContent).toContain('if __name__ == "__main__":\n    print("$5")');
    expect(screen.getByText('Difficulty').closest('blockquote')).toBe(quote);
    expect(screen.getByText('Analysis').closest('blockquote')).toBe(quote);
    expect(view.container.querySelector('pre, code, button, .hljs')).toBeNull();
  });

  it.each(['def f():\n    return __name__', '```python\ndef f():\n    return __name__\n```'])(
    'includes an unquoted code answer following a quoted label: %s', (answer) => {
      const view = render(<QuestionMarkdown content={`> **Answer**:\n\n${answer}\n\n> **Difficulty**: Basic`} />);
      const quote = view.container.querySelector('blockquote');
      expect(view.container.querySelectorAll('blockquote')).toHaveLength(1);
      expect(view.container.querySelector('.codeText')?.closest('blockquote')).toBe(quote);
      expect(view.container.querySelector('.codeText')?.textContent).toContain('    return __name__');
      expect(screen.getByText('Difficulty').closest('blockquote')).toBe(quote);
    },
  );

  it('does not absorb the next question into a mixed-format answer', () => {
    const content = '> **Answer**: def first():\n    return 1\n\n' +
      '2. Explain this expression.\n\n> **Answer**: Another answer.\n> **Difficulty**: Advanced';
    const view = render(<QuestionMarkdown content={content} />);
    expect(view.container.querySelectorAll('blockquote')).toHaveLength(2);
    expect(screen.getByText('Explain this expression.').closest('blockquote')).toBeNull();
    expect(view.container.querySelector('.codeText')?.textContent).not.toContain('Explain this expression.');
  });

  it('shows unfinished fenced code safely during streaming', () => {
    const view = render(<QuestionMarkdown content={'```python\nif num >= 0:\n    return bin(num)[2:]'} />);
    expect(view.container.querySelector('.codeText')?.textContent).toContain('if num >= 0:\n    return bin(num)[2:]');
    expect(view.container.querySelector('pre, button')).toBeNull();
  });

  it('does not execute raw HTML or permit unsafe links', () => {
    const view = render(<QuestionMarkdown content={'<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))'} />);
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.container.querySelector('[href^="javascript:"]')).toBeNull();
  });

  it('keeps the raw exam content for export/import and surrounding prose on the shared renderer', () => {
    const answer = '## Programming\n```python\nif __name__ == "__main__":\n    print(1)\n```';
    const view = render(<QuestionMessageContent content={`Intro\n\`\`\`\`markdown-exam\n${answer}\n\`\`\`\`\nOutro`}
      complete readOnly={false} isLatestMessage={false} webContent={undefined} />);
    expect(screen.getByTestId('question-card')).toHaveAttribute('data-content', answer);
    expect(screen.getByTestId('question-card')).toHaveAttribute('data-ready', 'true');
    expect(screen.getAllByTestId('ordinary-markdown').map(node => node.textContent)).toEqual(['Intro\n', 'Outro']);
    expect(view.container.querySelector('pre, code, button')).toBeNull();
  });

  it('does not mark an unfinished exam ready after display-only code protection', () => {
    render(<QuestionMessageContent content={'```markdown-exam\n> **Answer**: def f():\n>     return 1'}
      complete={false} readOnly={false} isLatestMessage={false} webContent={undefined} />);
    expect(screen.getByTestId('question-card')).toHaveAttribute('data-ready', 'false');
    expect(screen.getByTestId('question-card')).toHaveAttribute('data-content', '> **Answer**: def f():\n>     return 1');
  });
});
