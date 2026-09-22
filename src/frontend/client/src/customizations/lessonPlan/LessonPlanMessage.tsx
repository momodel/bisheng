import { useMemo, type ComponentProps } from 'react';
import Markdown from '~/components/Chat/Messages/Content/Markdown';
import { parseFencedBlocks } from '../parseFencedBlocks';
import { LessonPlanCard } from './LessonPlanCard';

interface LessonPlanMessageProps extends ComponentProps<typeof Markdown> {
  complete: boolean;
  readOnly: boolean;
}

export function LessonPlanMessage({ content, complete, readOnly, ...markdownProps }: LessonPlanMessageProps) {
  const blocks = useMemo(() => parseFencedBlocks(content, 'markdown-lesson'), [content]);
  return <>{blocks.map(block => block.kind === 'custom'
    ? <LessonPlanCard key={block.offset} content={block.content} ready={complete && block.complete} readOnly={readOnly}>
        <Markdown {...markdownProps} content={block.content} />
      </LessonPlanCard>
    : <Markdown key={block.offset} {...markdownProps} content={block.content} />)}</>;
}
