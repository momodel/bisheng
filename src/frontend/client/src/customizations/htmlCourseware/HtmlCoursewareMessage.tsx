import { useMemo, type ComponentProps } from 'react';
import Markdown from '~/components/Chat/Messages/Content/Markdown';
import { parseFencedBlocks } from '../parseFencedBlocks';
import { HtmlCoursewareCard } from './HtmlCoursewareCard';

interface HtmlCoursewareMessageProps extends ComponentProps<typeof Markdown> {
  complete: boolean;
  readOnly: boolean;
}

export function HtmlCoursewareMessage({ content, complete, readOnly, ...markdownProps }: HtmlCoursewareMessageProps) {
  const blocks = useMemo(() => parseFencedBlocks(content, 'html'), [content]);
  return <>{blocks.map(block => block.kind === 'custom'
    ? <HtmlCoursewareCard key={block.offset} html={block.content} ready={complete && block.complete} readOnly={readOnly} />
    : <Markdown key={block.offset} {...markdownProps} content={block.content} />)}</>;
}
