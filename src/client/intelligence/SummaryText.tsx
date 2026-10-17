import { Fragment, type ReactNode, useMemo } from 'react';
import { renderMath } from '../editor/math';

/** Read-only math: ordinary summary text remains escaped React text. */
export function SummaryText({text}: {text:string}) {
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
