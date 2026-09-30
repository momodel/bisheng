import { preprocessLaTeX } from '~/utils/latex';

const QUOTED_LINE = /^ {0,3}> ?(.*)$/;
const FIELD_LABEL = /^\*\*[^*\r\n]+\*\*\s*[:\uFF1A]\s*/;
const PYTHON_DECLARATION = /^(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(|^class\s+[A-Za-z_]\w*\s*[:(]/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const QUESTION_BOUNDARY = /^ {0,3}(?:#{1,6}\s|(?:\d+[.)]|[-+*])\s|(?:-{3,}|\*{3,}|_{3,})\s*$)/;

function followsQuotedLabel(lines: string[]): boolean {
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    const quoted = QUOTED_LINE.exec(line);
    if (!(quoted?.[1] ?? line).trim()) continue;
    const label = quoted?.[1].match(FIELD_LABEL)?.[0];
    return Boolean(label && quoted?.[1].trim() === label.trim());
  }
  return false;
}

/** Quote empty separators between details paragraphs so their border is continuous. */
function connectQuotedParagraphs(content: string): string {
  const lines = content.split('\n');
  let previousQuoted = false;
  let fence: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const quoted = QUOTED_LINE.exec(lines[index]);
    const match = FENCE.exec(quoted?.[1] ?? lines[index]);
    if (fence) {
      if (match && match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) {
        fence = null;
      }
    } else if (match) {
      fence = { marker: match[1][0], length: match[1].length };
    } else if (!lines[index].trim() && previousQuoted) {
      let nextIndex = index + 1;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex++;
      if (QUOTED_LINE.test(lines[nextIndex] ?? '')) {
        lines.fill('>', index, nextIndex);
        index = nextIndex - 1;
        continue;
      }
    }
    previousQuoted = Boolean(quoted);
  }
  return lines.join('\n');
}

function normalizeProseMath(content: string): string {
  const output: string[] = [];
  let prose = '';
  let fence: { marker: string; length: number } | null = null;
  const flushProse = () => {
    if (prose) output.push(preprocessLaTeX(prose));
    prose = '';
  };
  for (const line of content.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const body = line.replace(/^(?: {0,3}> ?)+/, '').replace(/\r?\n$/, '');
    const match = FENCE.exec(body);
    if (fence || match || /^(?: {4}|\t)/.test(body)) {
      flushProse();
      output.push(line);
      if (!fence && match) {
        fence = { marker: match[1][0], length: match[1].length };
      } else if (fence && match && match[1][0] === fence.marker &&
          match[1].length >= fence.length && !match[2].trim()) {
        fence = null;
      }
    } else {
      prose += line;
    }
  }
  flushProse();
  return output.join('');
}

/** Protect unfenced Python answers from Markdown emphasis without changing stored content. */
export function prepareQuestionMarkdown(content: string): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let fence: { marker: string; length: number } | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const quoted = QUOTED_LINE.exec(line);
    const fenceMatch = FENCE.exec(quoted?.[1] ?? line);
    if (fence) {
      output.push(line);
      if (fenceMatch && fenceMatch[1][0] === fence.marker &&
          fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      if (followsQuotedLabel(output)) {
        const marker = fenceMatch[1][0];
        const length = fenceMatch[1].length;
        output.push('>', `> ${quoted?.[1] ?? line}`);
        while (index + 1 < lines.length) {
          const next = lines[++index];
          const body = QUOTED_LINE.exec(next)?.[1] ?? next;
          output.push(`> ${body}`);
          const closing = FENCE.exec(body);
          if (closing && closing[1][0] === marker && closing[1].length >= length && !closing[2].trim()) {
            output.push('>');
            break;
          }
        }
        continue;
      }
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      output.push(line);
      continue;
    }

    const label = quoted?.[1].match(FIELD_LABEL)?.[0] ?? '';
    const codeStart = quoted?.[1].slice(label.length) ?? line;
    const inQuotedAnswer = Boolean(quoted) || followsQuotedLabel(output);
    if (!inQuotedAnswer || !PYTHON_DECLARATION.test(codeStart)) {
      output.push(line);
      continue;
    }

    const codeLines = [codeStart];
    while (index + 1 < lines.length) {
      const next = QUOTED_LINE.exec(lines[index + 1])?.[1] ?? lines[index + 1];
      if (FIELD_LABEL.test(next) || FENCE.test(next) || QUESTION_BOUNDARY.test(next)) break;
      codeLines.push(next);
      index++;
    }
    const tildeRuns = codeLines.join('\n').match(/~+/g) ?? [];
    const marker = '~'.repeat(Math.max(3, ...tildeRuns.map(run => run.length + 1)));
    if (label) output.push(`> ${label.trimEnd()}`, '>');
    output.push(`> ${marker}`, ...codeLines.map(codeLine => `> ${codeLine}`), `> ${marker}`, '>');
  }
  return normalizeProseMath(connectQuotedParagraphs(output.join('\n')));
}
