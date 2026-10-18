import {Fragment,type ReactNode,useMemo} from 'react';
import {safeHref,type Segment} from '../../shared/domain';
import {markdownBlocks} from '../editor/paste';
import {renderMath} from '../editor/math';

/** The source is never converted to editable blocks or shortened for display. */
export function SourceReaderInline({text}:{text:string}) {
  const parts:ReactNode[]=[];
  const expressions=/(`+)([\s\S]*?)\1|(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]|(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?![$\d])|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g;
  let start=0;
  for(const match of text.matchAll(expressions)) {
    const source=(match[3]??match[4]??match[5]??match[6])?.trim();
    if(!source)continue;
    if(match.index!>start)parts.push(text.slice(start,match.index));
    const display=match[3]!==undefined||match[4]!==undefined;
    parts.push(<span key={match.index} className={display?'summary-math-display':'summary-math-inline'} dangerouslySetInnerHTML={{__html:renderMath(source,display)}}/>);
    start=match.index!+match[0].length;
  }
  if(start<text.length)parts.push(text.slice(start));
  return <>{parts}</>;
}
function Inline({content}:{content:Segment[]}) {
  return <>{content.map((segment,index)=>{
    let node:ReactNode=segment.code?<code>{segment.text}</code>:segment.math?<span className="summary-math-inline" dangerouslySetInnerHTML={{__html:renderMath(segment.text??'')}}/>:<SourceReaderInline text={segment.text??''}/>;
    if(segment.bold)node=<strong>{node}</strong>;
    if(segment.italic)node=<em>{node}</em>;
    if(segment.strike)node=<s>{node}</s>;
    const href=segment.href?safeHref(segment.href):undefined;
    if(href)node=<a href={href} target="_blank" rel="noopener noreferrer">{node}</a>;
    return <Fragment key={index}>{node}</Fragment>;
  })}</>;
}
export function SourceReaderText({text,kind}:{text:string;kind?:string}) {
  const blocks=useMemo(()=>markdownBlocks(text),[text]);
  if(kind==='code')return <pre><code>{text.replace(/^```[^\n]*\n|\n```$/g,'')}</code></pre>;
  if(kind==='table') {
    const rows=text.split('\n').filter(line=>line.trim()&&!/^\s*\|?\s*:?-{3,}:?\s*\|/.test(line));
    if(rows.some(line=>line.includes('|')))return <div className="source-reader-table"><table><tbody>{rows.map((line,i)=><tr key={i}>{line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'').split(/(?<!\\)\|/).map((cell,j)=><td key={j}><SourceReaderInline text={cell.trim().replace(/\\\|/g,'|')}/></td>)}</tr>)}</tbody></table></div>;
    return <pre className="source-reader-table">{text}</pre>;
  }
  // The editable paste parser caps tables. Fall back to complete source text if
  // an unstructured document contains a table beyond those editable limits.
  const tableLines=text.split('\n').filter(line=>line.includes('|'));
  if(tableLines.length>100||tableLines.some(line=>line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'').split(/(?<!\\)\|/).length>20))return <div className="source-reader-text" style={{whiteSpace:'pre-wrap'}}><SourceReaderInline text={text}/></div>;
  return <div className="source-reader-text">{blocks.map((block,index)=>{
    const content=<Inline content={block.content}/>;
    if(block.type==='heading1')return <h3 key={block.id}>{content}</h3>;
    if(block.type==='heading2')return <h4 key={block.id}>{content}</h4>;
    if(block.type==='quote')return <blockquote key={block.id}>{content}</blockquote>;
    if(block.type==='divider')return <hr key={block.id}/>;
    if(block.type==='code')return <pre key={block.id}><code>{block.content.map(segment=>segment.text??'').join('')}</code></pre>;
    if(block.type==='math')return <div key={block.id} className="summary-math-display" dangerouslySetInnerHTML={{__html:renderMath(block.content.map(segment=>segment.text??'').join(''),true)}}/>;
    if(block.type==='table')return <div className="source-reader-table" key={block.id}><table><tbody>{block.rows?.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}><Inline content={cell}/></td>)}</tr>)}</tbody></table></div>;
    if(['bullet','numbered','todo'].includes(block.type)) {
      if(index>0&&blocks[index-1]!.type===block.type)return null;
      const items=[];
      for(let i=index;i<blocks.length&&blocks[i]!.type===block.type;i++) {
        const item=blocks[i]!;
        items.push(<li key={item.id}>{item.type==='todo'&&<input type="checkbox" checked={item.checked} disabled aria-label="Completed task"/>}<Inline content={item.content}/></li>);
      }
      return block.type==='numbered'?<ol key={block.id}>{items}</ol>:<ul key={block.id}>{items}</ul>;
    }
    return <p key={block.id}>{content}</p>;
  })}</div>;
}
