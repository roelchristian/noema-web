import {t as uiText} from '../i18n';
import { Fragment, type ReactNode, useMemo } from 'react';
import {limitSummaryWords} from '../../shared/summary-text';
import {blockListNumber, safeHref, type Segment} from '../../shared/domain';
import {markdownBlocks} from '../editor/paste';
import { renderMath } from '../editor/math';

/** Read-only math: ordinary summary text remains escaped React text. */
function MathText({text}: {text:string}) {
  const content = useMemo(() => {
    // Code spans/fences take precedence so literal examples remain literal.
    const expressions = /(`+)([\s\S]*?)\1|(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]|(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?![$\d])|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g;
    const parts: ReactNode[] = []; let start = 0;
    for (const match of text.matchAll(expressions)) {
      const source = (match[3] ?? match[4] ?? match[5] ?? match[6])?.trim();
      if (!source) continue;
      if (match.index! > start) parts.push(text.slice(start,match.index));
      const display = match[3] !== undefined || match[4] !== undefined;
      parts.push(<span key={match.index} className={display?'summary-math-display':'summary-math-inline'} dangerouslySetInnerHTML={{__html:renderMath(source,display)}}/>);
      start = match.index! + match[0].length;
    }
    if (start < text.length) parts.push(text.slice(start));
    return parts;
  }, [text]);
  return <Fragment>{content}</Fragment>;
}

function Inline({content}: {content: Segment[]}) {
  return <>{content.map((segment,index) => {
    let node: ReactNode = segment.code ? <code>{segment.text}</code> : segment.math
      ? <span className="summary-math-inline" dangerouslySetInnerHTML={{__html:renderMath(segment.text ?? '')}}/>
      : <MathText text={segment.text ?? ''}/>;
    if (segment.bold) node = <strong>{node}</strong>;
    if (segment.italic) node = <em>{node}</em>;
    if (segment.strike) node = <s>{node}</s>;
    if (segment.href && safeHref(segment.href)) node = <a href={safeHref(segment.href)} target="_blank" rel="noopener noreferrer">{node}</a>;
    return <Fragment key={index}>{node}</Fragment>;
  })}</>;
}

/** Render supported Markdown as React elements; raw HTML remains escaped text. */
export function SummaryText({text}: {text:string}) {
  return <MarkdownText text={limitSummaryWords(text)}/>;
}

/** Full user-authored Markdown, using the same escaped rendering as summaries. */
export function MarkdownText({text}: {text:string}) {
  const blocks = useMemo(() => markdownBlocks(text), [text]);
  return <>{blocks.map((block,index) => {
    const content = <Inline content={block.content}/>;
    if (block.type === 'heading1') return <h3 key={block.id}>{content}</h3>;
    if (block.type === 'heading2') return <h4 key={block.id}>{content}</h4>;
    if (block.type === 'quote') return <blockquote key={block.id}>{content}</blockquote>;
    if (block.type === 'divider') return <hr key={block.id}/>;
    if (block.type === 'code') return <pre key={block.id}><code>{block.content.map(segment => segment.text ?? '').join('')}</code></pre>;
    if (block.type === 'math') return <div key={block.id} className="summary-math-display" dangerouslySetInnerHTML={{__html:renderMath(block.content.map(segment => segment.text ?? '').join(''),true)}}/>;
    if (block.type === 'table') return <div className="summary-table" key={block.id}><table><tbody>{block.rows?.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}><Inline content={cell}/></td>)}</tr>)}</tbody></table></div>;
    if (['bullet','numbered','todo'].includes(block.type)) {
      if (index > 0 && blocks[index-1]!.type === block.type) return null;
      const items = [];
      for (let i=index;i<blocks.length && blocks[i]!.type===block.type;i++) {
        const item=blocks[i]!;
        items.push(<li key={item.id}>{item.type==='todo' && <input type="checkbox" checked={item.checked} disabled aria-label={uiText("Completed task")}/>}<Inline content={item.content}/></li>);
      }
      return block.type==='numbered' ? <ol key={block.id} start={blockListNumber(blocks,block.id)}>{items}</ol> : <ul key={block.id}>{items}</ul>;
    }
    return <p key={block.id}>{content}</p>;
  })}</>;
}
