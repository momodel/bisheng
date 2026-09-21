import { parseFencedBlocks } from '../parseFencedBlocks';

type MessageBlock = { kind: 'markdown' | 'exam'; content: string; complete: boolean; offset: number };

export function parseQuestionBlocks(content: string): MessageBlock[] {
  return parseFencedBlocks(content, 'markdown-exam').map(block => ({
    ...block, kind: block.kind === 'custom' ? 'exam' : 'markdown',
  }));
}
