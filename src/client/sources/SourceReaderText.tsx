import {t as uiText} from '../i18n';
import {Fragment,type ReactNode} from 'react';
import {safeHref} from '../../shared/domain';
import type {SourceHighlight} from '../../shared/source-reading';
import {renderMath} from '../editor/math';

type ReaderProps={text:string;startOffset?:number;highlights?:SourceHighlight[];footnotePrefix?:string};
const expressions=/(`+)([\s\S]*?)\1|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_|(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]|(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?![$\d])|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)|(?<!\\)\[\^([^\]\n]+)\](?!:)/g;

function activeHighlight(highlights:SourceHighlight[],start:number,end:number) {
  // Latest-created wins when highlights overlap, independent of query ordering.
  return highlights.filter(item=>item.startOffset<end&&item.endOffset>start).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0];
}
function TextLeaf({text,start,highlights}:{text:string;start:number;highlights:SourceHighlight[]}) {
  const boundaries=[...new Set([start,start+text.length,...highlights.flatMap(item=>[item.startOffset,item.endOffset]).filter(point=>point>start&&point<start+text.length)])].sort((a,b)=>a-b);
  return <>{boundaries.slice(0,-1).map((from,index)=>{
    const to=boundaries[index+1]!,highlight=activeHighlight(highlights,from,to),value=text.slice(from-start,to-start);
    return highlight?<mark key={from} role="button" tabIndex={0} aria-label={uiText("Edit highlight")} title={uiText("Change highlight color or add a reading note")} className="source-highlight" data-color={highlight.color} data-highlight-id={highlight.id} data-source-start={from} data-source-end={to}>{value}</mark>:<span key={from} data-source-start={from} data-source-end={to}>{value}</span>;
  })}</>;
}
function MathLeaf({source,display,start,end,highlights}:{source:string;display:boolean;start:number;end:number;highlights:SourceHighlight[]}) {
  const highlight=activeHighlight(highlights,start,end);
  return <span role={highlight?'button':undefined} tabIndex={highlight?0:undefined} aria-label={highlight?uiText("Edit highlight"):undefined} title={highlight?uiText("Change highlight color or add a reading note"):undefined} className={`${display?'summary-math-display':'summary-math-inline'}${highlight?' source-highlight':''}`} data-color={highlight?.color} data-highlight-id={highlight?.id} data-source-start={start} data-source-end={end} data-source-atomic="true" dangerouslySetInnerHTML={{__html:renderMath(source,display)}}/>;
}
/** Raw offsets belong to the immutable imported text, including Markdown delimiters. */
export function SourceReaderInline({text,startOffset=0,highlights=[],footnotePrefix='source-footnote'}:ReaderProps) {
  const parts:ReactNode[]=[];
  const plain=(value:string,offset:number)=>{
    // An escaped table pipe displays one character but retains its exact raw position.
    let cursor=0;
    for(const match of value.matchAll(/\\\|/g)) {
      if(match.index!>cursor)parts.push(<TextLeaf key={`p${offset+cursor}`} text={value.slice(cursor,match.index)} start={offset+cursor} highlights={highlights}/>);
      parts.push(<TextLeaf key={`p${offset+match.index!+1}`} text="|" start={offset+match.index!+1} highlights={highlights}/>);
      cursor=match.index!+2;
    }
    if(cursor<value.length)parts.push(<TextLeaf key={`p${offset+cursor}`} text={value.slice(cursor)} start={offset+cursor} highlights={highlights}/>);
  };
  let cursor=0;
  for(const match of text.matchAll(expressions)) {
    const index=match.index!,offset=startOffset+index;
    if(index>cursor)plain(text.slice(cursor,index),startOffset+cursor);
    let node:ReactNode;
    if(match[1])node=<code><TextLeaf text={match[2]??''} start={offset+match[1].length} highlights={highlights}/></code>;
    else if(match[3]!==undefined) {
      const href=safeHref(match[4]!),label=<SourceReaderInline text={match[3]} startOffset={offset+1} highlights={highlights} footnotePrefix={footnotePrefix}/>;
      node=href?<a href={href} target="_blank" rel="noopener noreferrer">{label}</a>:label;
    } else if(match[5]!==undefined||match[6]!==undefined||match[7]!==undefined||match[8]!==undefined||match[9]!==undefined) {
      const value=match[5]??match[6]??match[7]??match[8]??match[9]??'',bold=match[5]!==undefined||match[6]!==undefined,strike=match[7]!==undefined;
      const child=<SourceReaderInline text={value} startOffset={offset+(bold||strike?2:1)} highlights={highlights} footnotePrefix={footnotePrefix}/>;
      node=bold?<strong>{child}</strong>:strike?<s>{child}</s>:<em>{child}</em>;
    } else if(match[14]!==undefined) {
      const label=match[14],target=`${footnotePrefix}-note-${encodeURIComponent(label)}`;
      node=<sup className="source-reader-footnote-reference"><a href={`#${target}`} data-footnote-reference={target} data-source-start={offset} data-source-end={offset+match[0].length} data-source-atomic="true" aria-label={uiText("Footnote {value0}",{value0: label})} onClick={event=>{event.preventDefault();const note=document.getElementById(target);if(note){window.dispatchEvent(new Event('noema:before-reading-jump'));note.scrollIntoView({block:'center'});note.focus({preventScroll:true});}}}>{label.replace(/^p\d+-/, '')}</a></sup>;
    } else {
      const source=(match[10]??match[11]??match[12]??match[13]??'').trim();
      node=<MathLeaf source={source} display={match[10]!==undefined||match[11]!==undefined} start={offset} end={offset+match[0].length} highlights={highlights}/>;
    }
    parts.push(<Fragment key={`m${offset}`}>{node}</Fragment>);
    cursor=index+match[0].length;
  }
  if(cursor<text.length)plain(text.slice(cursor),startOffset+cursor);
  return <>{parts}</>;
}

type Line={text:string;start:number;end:number};
function sourceLines(text:string,start:number):Line[] {
  const result:Line[]=[];
  for(const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if(!match[0])continue;
    const value=match[0].replace(/[\r\n]+$/,'');
    result.push({text:value,start:start+match.index!,end:start+match.index!+value.length});
  }
  return result;
}
const separator=(text:string)=>/^\s*\|?\s*:?-{3,}:?\s*\|/.test(text);
const divider=(text:string)=>/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(text);
function tableCells(line:Line,highlights:SourceHighlight[],footnotePrefix:string) {
  let left=line.text.search(/\S/),right=line.text.trimEnd().length;
  if(left<0)return [];
  if(line.text[left]==='|')left++;
  if(line.text[right-1]==='|'&&line.text[right-2]!=='\\')right--;
  const raw=line.text.slice(left,right),cells:ReactNode[]=[];
  let cursor=0;
  for(const match of [...raw.matchAll(/(?<!\\)\|/g),{index:raw.length}]) {
    const end=match.index!,cell=raw.slice(cursor,end),leading=cell.length-cell.trimStart().length;
    cells.push(<td key={cursor}><SourceReaderInline text={cell.trim()} startOffset={line.start+left+cursor+leading} highlights={highlights} footnotePrefix={footnotePrefix}/></td>);
    cursor=end+1;
  }
  return cells;
}
/** Read-only rendering keeps source positions through Markdown, lists, tables, and math. */
export function SourceReaderText({text,kind,startOffset=0,highlights=[],footnotePrefix='source-footnote'}:ReaderProps&{kind?:string}) {
  const lines=sourceLines(text,startOffset),blocks:ReactNode[]=[];
  const inline=(value:string,start:number)=><SourceReaderInline text={value} startOffset={start} highlights={highlights} footnotePrefix={footnotePrefix}/>;
  const code=(value:string,start:number)=><pre><code><TextLeaf text={value} start={start} highlights={highlights}/></code></pre>;
  if(kind==='code') {
    const opening=text.match(/^\s*(?:```|~~~)[^\r\n]*(?:\r\n|\r|\n)/),closing=text.match(/(?:\r\n|\r|\n)[ \t]*(?:```|~~~)\s*$/);
    const from=opening?.[0].length??0,to=closing?.index??text.length;
    return code(text.slice(from,to),startOffset+from);
  }
  for(let i=0;i<lines.length;i++) {
    const line=lines[i]!,trimmed=line.text.trim();
    if(!trimmed)continue;
    const key=line.start;
    const footnote=line.text.match(/^\s*\[\^([^\]]+)\]:[ \t]*/);
    if(footnote) {
      const label=footnote[1]!,target=`${footnotePrefix}-note-${encodeURIComponent(label)}`;
      let end=i;
      while(end+1<lines.length&&(/^(?: {4}|\t)/.test(lines[end+1]!.text)||!lines[end+1]!.text.trim()&&/^(?: {4}|\t)/.test(lines[end+2]?.text??'')))end++;
      const from=line.start+footnote[0].length,to=lines[end]!.end;
      blocks.push(<aside key={key} id={target} tabIndex={-1} className="source-reader-footnote" aria-label={uiText("Footnote {value0}",{value0: label})}><span className="source-reader-footnote-label">{label.replace(/^p\d+-/, '')}</span><SourceReaderText text={text.slice(from-startOffset,to-startOffset)} startOffset={from} highlights={highlights} footnotePrefix={footnotePrefix}/><button type="button" className="source-reader-footnote-back" aria-label={uiText("Back to footnote {value0} reference",{value0: label})} onClick={()=>{const reference=Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-footnote-reference]')).find(element=>element.dataset.footnoteReference===target);reference?.scrollIntoView({block:'center'});reference?.focus({preventScroll:true});}}>↩</button></aside>);
      i=end;continue;
    }
    if(trimmed.startsWith('$$')||trimmed.startsWith('\\[')) {
      const delimiter=trimmed.startsWith('$$')?'$$':'\\]',opening=trimmed.startsWith('$$')?'$$':'\\[';
      let end=i;
      if(!(trimmed.length>opening.length&&trimmed.endsWith(delimiter))) {
        end=i+1;
        while(end<lines.length&&!lines[end]!.text.trim().endsWith(delimiter))end++;
      }
      if(end<lines.length) {
        const from=line.start+line.text.indexOf(opening),last=lines[end]!,to=last.start+last.text.lastIndexOf(delimiter)+delimiter.length;
        const raw=text.slice(from-startOffset,to-startOffset),source=raw.slice(opening.length,-delimiter.length).trim();
        blocks.push(<MathLeaf key={key} source={source} display start={from} end={to} highlights={highlights}/>);i=end;continue;
      }
    }
    if(/^\s*(```|~~~)/.test(line.text)) {
      const fence=trimmed.slice(0,3);let end=i+1;
      while(end<lines.length&&!lines[end]!.text.trim().startsWith(fence))end++;
      const from=lines[i+1]?.start??line.end,to=end>i+1?lines[end-1]!.end:from;
      blocks.push(<Fragment key={key}>{code(text.slice(from-startOffset,to-startOffset),from)}</Fragment>);i=end;continue;
    }
    if(line.text.includes('|')&&(kind==='table'||separator(lines[i+1]?.text??''))) {
      const rows:Line[]=[line];
      if(separator(lines[i+1]?.text??''))i++;
      while(i+1<lines.length&&lines[i+1]!.text.includes('|')&&lines[i+1]!.text.trim())rows.push(lines[++i]!);
      blocks.push(<div className="source-reader-table" key={key}><table><tbody>{rows.map(row=><tr key={row.start}>{tableCells(row,highlights,footnotePrefix)}</tr>)}</tbody></table></div>);continue;
    }
    if(divider(line.text)){blocks.push(<hr key={key}/>);continue;}
    const heading=line.text.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/),quote=line.text.match(/^\s*>\s?(.*)$/),item=line.text.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/);
    if(heading) {
      const content=inline(heading[2]!,line.start+line.text.indexOf(heading[2]!,heading[1]!.length));
      blocks.push(heading[1]!.length===1?<h3 key={key}>{content}</h3>:<h4 key={key}>{content}</h4>);continue;
    }
    if(quote){blocks.push(<blockquote key={key}>{inline(quote[1]!,line.end-quote[1]!.length)}</blockquote>);continue;}
    if(item) {
      const ordered=!!item[2],items:ReactNode[]=[];let current=item;
      while(true) {
        const currentLine=lines[i]!,value=current[4]??'';
        items.push(<li key={currentLine.start}>{current[3]!==undefined&&<input type="checkbox" checked={current[3].toLowerCase()==='x'} disabled aria-label={uiText("Completed task")}/>}{inline(value,currentLine.end-value.length)}</li>);
        const next=lines[i+1]?.text.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/);
        if(!next||!!next[2]!==ordered)break;
        current=next;i++;
      }
      blocks.push(ordered?<ol key={key}>{items}</ol>:<ul key={key}>{items}</ul>);continue;
    }
    let end=i;
    while(end+1<lines.length&&lines[end+1]!.text.trim()&&!/^\s*(?:\$\$|\\\[|#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~)/.test(lines[end+1]!.text)&&!divider(lines[end+1]!.text)&&!/^\s*\[\^[^\]]+\]:/.test(lines[end+1]!.text)&&!(lines[end+1]!.text.includes('|')&&separator(lines[end+2]?.text??'')))end++;
    blocks.push(<p key={key}>{inline(text.slice(line.start-startOffset,lines[end]!.end-startOffset),line.start)}</p>);i=end;
  }
  return <div className="source-reader-text">{blocks}</div>;
}
