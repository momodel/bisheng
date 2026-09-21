import { useMemo, type ComponentProps } from 'react';
import Markdown from '~/components/Chat/Messages/Content/Markdown';
import { parseQuestionBlocks } from './parseQuestionBlocks';
import { QuestionResultCard } from './QuestionResultCard';
import styles from './QuestionMessageContent.module.css';

interface QuestionMessageContentProps extends ComponentProps<typeof Markdown> {
  complete: boolean;
  readOnly: boolean;
}

export function QuestionMessageContent({ content, complete, readOnly, ...markdownProps }: QuestionMessageContentProps) {
  const blocks = useMemo(() => parseQuestionBlocks(content), [content]);
  return <>{blocks.map(block => block.kind === 'exam'
    ? <QuestionResultCard key={block.offset} content={block.content} ready={complete && block.complete} readOnly={readOnly}>
        <div className={`${styles.examBody} text-body-sm text-text-1`}>
          <Markdown {...markdownProps} content={block.content} />
        </div>
      </QuestionResultCard>
    : <Markdown key={block.offset} {...markdownProps} content={block.content} />)}</>;
}
