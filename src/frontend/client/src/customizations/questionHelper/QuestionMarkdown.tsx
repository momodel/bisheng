import { createElement, useMemo, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import supersub from 'remark-supersub';
import rehypeKatex from 'rehype-katex';
import type { PluggableList, Plugin } from 'unified';
import { a } from '~/components/Chat/Messages/Content/Markdown';
import { rehypeBr } from '~/utils/rehypeBr';
import { prepareQuestionMarkdown } from './prepareQuestionMarkdown';
import styles from './QuestionMessageContent.module.css';

interface QuestionMarkdownProps {
  content: string;
}

interface PlainCodeProps {
  children?: ReactNode;
}

function PlainCode({ children }: PlainCodeProps) {
  return <span>{children}</span>;
}

function PlainCodeBlock({ children }: PlainCodeProps) {
  return <div className={styles.codeText}>{children}</div>;
}

function MarkdownLink({ href = '', children }: ComponentPropsWithoutRef<'a'>) {
  return createElement(a, { href, children });
}

function Paragraph({ children }: ComponentPropsWithoutRef<'p'>) {
  return <p className="mb-2 whitespace-pre-wrap">{children}</p>;
}

const remarkPlugins: PluggableList = [supersub, remarkGfm, [remarkMath, { singleDollarTextMath: true }]];
// rehype-katex ships older unified types; its transformer is compatible at runtime.
const rehypePlugins: PluggableList = [rehypeBr, [rehypeKatex as unknown as Plugin, { output: 'mathml' }]];

export function QuestionMarkdown({ content }: QuestionMarkdownProps) {
  const markdown = useMemo(() => prepareQuestionMarkdown(content), [content]);
  return <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}
    components={{ a: MarkdownLink, p: Paragraph, code: PlainCode, pre: PlainCodeBlock }}>{markdown}</ReactMarkdown>;
}
