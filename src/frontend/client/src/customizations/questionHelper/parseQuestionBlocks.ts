type MessageBlock = { kind: 'markdown' | 'exam'; content: string; complete: boolean; offset: number };

/** Recognize top-level fences without interpreting markers inside ordinary code blocks. */
export function parseQuestionBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let offset = 0;
  let textStart = 0;
  let fence: { marker: string; length: number; start: number; bodyStart: number; exam: boolean } | null = null;

  for (const line of lines) {
    const trimmedLine = line.replace(/\r?\n$/, '');
    if (!fence) {
      const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(trimmedLine);
      if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
        fence = {
          marker: opening[1][0], length: opening[1].length, start: offset,
          bodyStart: offset + line.length, exam: opening[2].trim() === 'markdown-exam',
        };
        if (fence.exam && offset > textStart) {
          blocks.push({ kind: 'markdown', content: content.slice(textStart, offset), complete: true, offset: textStart });
        }
      }
    } else {
      const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(trimmedLine);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
        if (fence.exam) {
          blocks.push({ kind: 'exam', content: content.slice(fence.bodyStart, offset).replace(/\r?\n$/, ''), complete: true, offset: fence.start });
          textStart = offset + line.length;
        }
        fence = null;
      }
    }
    offset += line.length;
  }

  if (fence?.exam) {
    blocks.push({ kind: 'exam', content: content.slice(fence.bodyStart), complete: false, offset: fence.start });
  } else if (textStart < content.length) {
    blocks.push({ kind: 'markdown', content: content.slice(textStart), complete: true, offset: textStart });
  }
  return blocks;
}
