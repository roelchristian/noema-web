import {bibliographicCitationKey} from '../../shared/bibliographic-citations';
import {t as uiText} from '../i18n';
import {citationKey,citationLocation,sortCitationRuns} from '../../shared/citations';
import type {CitationPresentation} from '../sources/CitationPresentation';
import { renderToStaticMarkup } from 'react-dom/server';
import { isExternalWebHref, safeHref, type Entity, type Segment, type TextStyle } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Mention } from '../components/Mention';
import { pageLinkNodes } from './page-links';
import { renderMath } from './math';
import type { EntityReviewItem } from '../../shared/entity-match-cache';
import { segmentsEqual } from '../../shared/segments-equal';
import { replaceEditableHTML } from './preserve-caret';
import { canIdentifyEntities } from './auto-entity-matching';
import {noteDateRanges, noteDateLabel} from '../../shared/note-dates';
export interface ReviewLocation {blockId: string; row?: number; col?: number; matches?: EntityReviewItem[]}
export function entityReviewRanges(_content: Segment[], _entities: Entity[], location: ReviewLocation) {
  return (location.matches ?? []).filter(match => match.blockId === location.blockId && match.row === location.row && match.col === location.col).map(({start,end,id}) => ({start,end,id}));
}
const reviewTimers = new WeakMap<HTMLElement, {source: string; key: string; timer?: ReturnType<typeof setTimeout>}>();
export function syncEditableSegments(element: HTMLElement, content: Segment[], entities: Entity[], location: ReviewLocation, citations?:CitationPresentation) {
  const changed = !segmentsEqual(readSegments(element), content);
  const key = JSON.stringify(entityReviewRanges(content, entities, location));
  const source = segmentHTML(content, entities,undefined,false,citations);
  const previous = reviewTimers.get(element);
  const last=content.at(-1);
  const missingTrailingCaret=!!(last&&(last.entityId||last.math||last.sourceReference||last.bibliographicReference)&&element.lastChild instanceof HTMLElement&&element.lastChild.contentEditable==='false');
  if (!changed && !missingTrailingCaret && previous?.source === source && previous.key === key) return;
  if(!changed&&previous?.source!==source){
    const byId=new Map(entities.map(entity=>[entity.id,entity]));
    for(const mention of element.querySelectorAll<HTMLElement>('.mention[data-entity]')){
      const icon=mention.querySelector<SVGElement>(':scope > .icon'),entity=byId.get(mention.dataset.entity!);
      const markup=renderToStaticMarkup(<Icon name={entity?.type??'knowledge'} entity={entity}/>);
      if(icon&&icon.outerHTML!==markup)icon.outerHTML=markup;
    }
  }
  clearTimeout(previous?.timer);
  const selection = document.getSelection();
  const selecting = element.closest('[data-text-selected]') || selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(element);
  const composing = element.closest('.page[data-entity-composing]');
  // Citation labels are presentation, while saved atoms retain their authored text.
  // Update only noneditable atom labels: rebuilding the editable host would move
  // a caret when author-date labels gain disambiguation or switch to numbers.
  if(!changed&&!composing&&previous?.source!==source){
    const expected=document.createElement('div');expected.innerHTML=source;
    const selector='[data-source-reference],[data-bibliographic-reference]';
    const rendered=expected.querySelectorAll<HTMLElement>(selector);
    element.querySelectorAll<HTMLElement>(selector).forEach((atom,index)=>{
      const next=rendered[index];if(!next)return;
      if(atom.textContent!==next.textContent)atom.textContent=next.textContent;
      for(const attribute of ['class','title','aria-label','aria-controls','role','data-citation-number','data-reference-target']){
        const value=next.getAttribute(attribute);
        if(value===null)atom.removeAttribute(attribute);else if(atom.getAttribute(attribute)!==value)atom.setAttribute(attribute,value);
      }
    });
  }
  const dateDisplayChanged=previous?.source!==source&&element.querySelector('[data-note-date]')&&!selecting&&!composing;
  if (changed || missingTrailingCaret || dateDisplayChanged || (!selecting && !composing && element.querySelector('[data-entity-review]'))) {
    // Strip inherited highlight wrappers immediately when typing resumes.
    replaceEditableHTML(element, source);
    element.querySelectorAll<HTMLElement>('[data-entity-space="true"]').forEach(authoredBoundarySpace);
  }
  const pending = {source, key, timer: undefined as ReturnType<typeof setTimeout> | undefined};
  reviewTimers.set(element, pending);
  if (key === '[]' && !noteDateRanges(content).length && !element.querySelector('[data-note-date]')) return;
  const decorate = () => {
    if (!element.isConnected || reviewTimers.get(element) !== pending) return;
    if (!canIdentifyEntities()) { pending.timer = setTimeout(decorate, 300); return; }
    if (!segmentsEqual(readSegments(element), content)) return;
    replaceEditableHTML(element, segmentHTML(content, entities, location,false,citations));
    element.querySelectorAll<HTMLElement>('[data-entity-space="true"]').forEach(authoredBoundarySpace);
  };
  pending.timer = setTimeout(decorate, key === '[]' ? 1200 : 0);
}
/** Only escaped text and explicitly supported formatting reach the editable surface. */
export function segmentHTML(content: Segment[], entities: Entity[], review?: ReviewLocation, readOnly = false, citations?:CitationPresentation, decorateLinks = true) {
  const ranges = review ? entityReviewRanges(content, entities, review) : [];
  let offset = 0;
  const numberOf=(ref:NonNullable<Segment['sourceReference']>)=>citations?.style==='references'?citations.entries.get(citationKey(ref))?.number??ref.sourceNumber??1:ref.sourceNumber??1;
  const ordered=readOnly?sortCitationRuns(content,(left,right)=>numberOf(left)-numberOf(right)):content;
  const dates=decorateLinks?noteDateRanges(ordered):[];
  // Imported nonbreaking spaces beside noneditable entities can lead a wrapped
  // line in WebKit. Render a breakable space and retain its original value for edits.
  const entitySpaces=new Set<number>();
  let textOffset=0;
  ordered.forEach((segment,index)=>{
    const text=segment.text??'';
    if (!segment.code && !segment.math && !segment.sourceReference && !segment.bibliographicReference && !segment.entityId) {
      if (ordered[index-1]?.entityId && text.startsWith('\u00a0')) entitySpaces.add(textOffset);
      if (ordered[index+1]?.entityId && text.endsWith('\u00a0')) entitySpaces.add(textOffset+text.length-1);
    }
    textOffset+=text.length;
  });
  const proseNodes=(value:string,start:number,skipLinks:boolean):React.ReactNode[]=>{
    if(!entitySpaces.size || !value.includes('\u00a0')) return skipLinks?[value]:pageLinkNodes(value);
    const nodes:React.ReactNode[]=[];
    let cursor=0;
    for(let index=0;index<value.length;index++) {
      if(!entitySpaces.has(start+index))continue;
      const before=value.slice(cursor,index);
      nodes.push(...(skipLinks?[before]:pageLinkNodes(before)));
      nodes.push(<span key={'entity-space-'+(start+index)} data-entity-space="true" className="entity-boundary-space"> </span>);
      cursor=index+1;
    }
    const rest=value.slice(cursor);
    nodes.push(...(skipLinks?[rest]:pageLinkNodes(rest)));
    return nodes;
  };
  const textNodes=(value:string,start:number,skipLinks=false)=>{
    const nodes:React.ReactNode[]=[];
    let cursor=0;
    for(const range of dates.filter(range=>range.start<start+value.length&&range.end>start)) {
      const from=Math.max(0,range.start-start),to=Math.min(value.length,range.end-start);
      if(from>cursor)nodes.push(...proseNodes(value.slice(cursor,from),start+cursor,skipLinks));
      nodes.push(<span key={start+from} className={'mention date'+(range.start===start+from?' is-start':'')+(range.end===start+to?' is-end':'')} data-note-date={range.date.id} data-note-date-start={range.start} role="button" tabIndex={0} title={noteDateLabel(range.date)} aria-label={`${uiText('Date')}: ${noteDateLabel(range.date)}`}>{range.start===start+from&&<Icon name="event"/>}{value.slice(from,to)}</span>);
      cursor=to;
    }
    nodes.push(...proseNodes(value.slice(cursor),start+cursor,skipLinks));
    return nodes;
  };
  const last=ordered.at(-1);
  // WebKit needs an editable text position after a trailing noneditable atom.
  // Otherwise an entity-only line can paint its caret at the block's far edge.
  const trailingCaret=!readOnly&&last&&(last.entityId||last.math||last.sourceReference||last.bibliographicReference);
  return renderToStaticMarkup(<>{ordered.map((s, index) => {
    const start = offset; offset += s.text?.length ?? 0;
    if(s.bibliographicReference){
      const ref=s.bibliographicReference,source=entities.find(entity=>entity.id===ref.sourceId);
      const label=citations?.scholarly?.labels.get(bibliographicCitationKey(ref))??`[${source?.name??'Source'}${ref.locator?`, ${ref.locator}`:''}]`;
      return <span key={index} id={`note-bibliographic-citation-${ref.id}`} className="source-reference-tag" contentEditable={false} role="link" tabIndex={0} data-entity={ref.sourceId} data-bibliographic-reference={JSON.stringify(ref)} data-bibliographic-segment={JSON.stringify(s)} title="Bibliographic citation">{label}</span>;
    }
    if (s.sourceReference) {
      const ref=s.sourceReference, source=entities.find(entity=>entity.id===ref.sourceId);
      const entry=citations?.entries.get(citationKey(ref)), footnote=citations?.style==='references'&&entry;
      const label=footnote?`[${entry.number}]`:`[${ref.sourceNumber??1}, ${citationLocation(ref)}]`;
      return <span key={index} id={`note-citation-${ref.id}`} className={'source-reference-tag'+(footnote?' is-footnote':'')} data-citation-number={footnote?entry.number:undefined} data-reference-target={footnote?`note-reference-${entry.number}`:undefined} contentEditable={false} role={footnote?'link':'button'} tabIndex={0} data-entity={ref.sourceId} data-source-reference={JSON.stringify(ref)} data-source-text={s.text ?? ''} data-source-segment={JSON.stringify(s)} aria-controls={footnote?`note-reference-${entry.number}`:"source-viewer"} aria-label={`${footnote?`Go to reference ${entry.number}`:`Open reference ${ref.sourceNumber??1}`}: ${source?.name??'Source'}, ${citationLocation(ref)}`}>{label}</span>;
    }
    if (s.entityId) return <Mention key={index} id={s.entityId} label={s.mentionText} occurrenceOnly={s.skipAutoTag} entities={entities} onOpen={() => {}}/>;
    if (s.math) return <span key={index} className="inline-math" data-math={s.text} contentEditable={false} role={readOnly ? undefined : "button"} tabIndex={readOnly ? undefined : 0} title={readOnly ? undefined : uiText("Edit equation")} aria-label={`${readOnly ? "Equation" : "Edit equation"}: ${s.text}`} dangerouslySetInnerHTML={{__html: renderMath(s.text ?? '')}}/>;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const range of ranges.filter(range => range.start < offset && range.end > start)) {
      const from = Math.max(0, range.start - start), to = Math.min(s.text?.length ?? 0, range.end - start);
      if (from > cursor) parts.push(...textNodes(s.text?.slice(cursor,from)??'',start+cursor,!!(s.code||s.href)));
      parts.push(<span key={range.id} className={'entity-review-highlight' + (range.start === start + from ? ' is-start' : '')} data-entity-review={range.id} title={uiText("Ambiguous entity · click to review")}>{s.text?.slice(from, to)}</span>);
      cursor = to;
    }
    parts.push(...textNodes(s.text?.slice(cursor)??'',start+cursor,!!(s.code||s.href)));
    let node = <>{parts}</>;
    if (s.code) node = <code>{node}</code>;
    if (s.bold) node = <strong>{node}</strong>;
    if (s.italic) node = <em>{node}</em>;
    if (s.underline) node = <u>{node}</u>;
    if (s.strike) node = <s>{node}</s>;
    if (s.href && safeHref(s.href)) {
      const external=isExternalWebHref(s.href,typeof window==='undefined'?undefined:window.location.origin);
      const next=ordered[index+1];
      const endOfLink=!next || next.href!==s.href || next.entityId || next.math || next.sourceReference;
      node = <a href={safeHref(s.href)} tabIndex={!readOnly && decorateLinks ? (ordered[index-1]?.href===s.href ? -1 : 0) : undefined} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} title={decorateLinks && external ? uiText(readOnly ? "Open external link in a new tab" : "Ctrl/⌘-click to open link in a new tab") : undefined}>{node}{decorateLinks && external && endOfLink ? <span className="external-link-indicator" aria-hidden="true"><Icon name="external-link"/></span> : null}</a>;
    }
    return <span key={index} data-skip-auto-tag={s.skipAutoTag ? 'true' : undefined}>{node}</span>;
  })}{trailingCaret ? '\u200b' : null}</>);
}
// Remember which rendered spaces came from authored NBSPs without replacing live
// text nodes. Native composition can extend or split the marker's text node.
// The inert snapshots also preserve that mapping when selection/copy clones DOM.
const boundarySpaces = new WeakMap<HTMLElement, {anchor: Node | null; rendered: string; authored: string}>();
function authoredBoundarySpace(element: HTMLElement) {
  const rendered = element.textContent ?? '';
  let previous = boundarySpaces.get(element);
  if (!previous) {
    const baseline = element.dataset.entitySpaceRendered ?? ' ';
    const authored = element.dataset.entitySpaceAuthored ?? '\u00a0';
    const valid = baseline.length === authored.length && baseline.split('').every((character,index) => character === authored[index] || character === ' ' && authored[index] === '\u00a0');
    previous = {anchor: element.firstChild, rendered: valid ? baseline : rendered, authored: valid ? authored : rendered};
  }
  let authored = rendered;
  if (!previous.anchor || element.contains(previous.anchor)) {
    let prefix = 0, suffix = 0;
    while (prefix < previous.rendered.length && prefix < rendered.length && previous.rendered[prefix] === rendered[prefix]) prefix++;
    while (suffix < previous.rendered.length - prefix && suffix < rendered.length - prefix && previous.rendered.at(-1-suffix) === rendered.at(-1-suffix)) suffix++;
    authored = previous.authored.slice(0,prefix) + rendered.slice(prefix,rendered.length-suffix) + previous.authored.slice(previous.authored.length-suffix);
  }
  boundarySpaces.set(element,{anchor: element.firstChild, rendered, authored});
  element.dataset.entitySpaceRendered = rendered;
  element.dataset.entitySpaceAuthored = authored;
  return authored;
}
export function readSegments(el: Node, allowMentions = true): Segment[] {
  const output: Segment[] = [];
  function walk(node: Node, style: TextStyle = {}, replacements?: Map<Node,string>) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (replacements?.get(node) ?? node.textContent)?.replace(/\u200b/g, '');
      if (text) {
        const last = output.at(-1);
        if (last && !last.entityId && JSON.stringify({...last, text: ''}) === JSON.stringify({...style, text: ''})) last.text += text;
        else output.push({...style, text});
      }
    } else if (node instanceof HTMLElement) {
      if (['SCRIPT','STYLE','META','LINK','IFRAME','OBJECT'].includes(node.tagName)) return;
      if (node.dataset.entitySpace === 'true') {
        const authored = authoredBoundarySpace(node), mapped = new Map<Node,string>();
        let offset = 0;
        const collect = (child:Node) => {
          if (child.nodeType === Node.TEXT_NODE) {const length = child.textContent?.length ?? 0; mapped.set(child,authored.slice(offset,offset+length)); offset += length;}
          else child.childNodes.forEach(collect);
        };
        node.childNodes.forEach(collect);
        node.childNodes.forEach(child => walk(child,style,mapped));
        return;
      }
      if (node.dataset.wikilink !== undefined) { walk(document.createTextNode(node.dataset.wikilink), {...style,skipAutoTag:true}); return; }
      if(node.dataset.bibliographicReference!==undefined){
        try{output.push(node.dataset.bibliographicSegment?JSON.parse(node.dataset.bibliographicSegment):{text:' [ref]',bibliographicReference:JSON.parse(node.dataset.bibliographicReference)});}catch{if(node.textContent)output.push({text:node.textContent});}
        return;
      }
      if (node.dataset.sourceReference !== undefined) {
        try {output.push(node.dataset.sourceSegment ? JSON.parse(node.dataset.sourceSegment) : {text:node.dataset.sourceText??'',sourceReference:JSON.parse(node.dataset.sourceReference)});} catch {if(node.textContent)output.push({text:node.textContent});}
        return;
      }
      if (node.dataset.math !== undefined) { output.push({text: node.dataset.math, math: true}); return; }
      if (allowMentions && node.dataset.entity) { output.push({entityId: node.dataset.entity, ...(node.dataset.skipAutoTag === 'true' ? {skipAutoTag:true} : {}), ...(node.dataset.mentionText ? {mentionText: node.dataset.mentionText} : {})}); return; }
      if (node.tagName === 'BR') { output.push({text: '\n'}); return; }
      const next = {...style}, tag = node.tagName;
      if (allowMentions && node.dataset.skipAutoTag === 'true') next.skipAutoTag = true;
      if (['STRONG','B'].includes(tag) || /^(bold|[6-9]00)$/.test(node.style.fontWeight)) next.bold = true;
      if (['EM','I'].includes(tag) || node.style.fontStyle === 'italic') next.italic = true;
      if (tag === 'U' || node.style.textDecoration.includes('underline')) next.underline = true;
      if (['S','DEL','STRIKE'].includes(tag) || node.style.textDecoration.includes('line-through')) next.strike = true;
      if (tag === 'CODE') next.code = true;
      if (tag === 'A') { const href = safeHref(node.getAttribute('href') || ''); if (href) next.href = href; }
      if (['P','DIV'].includes(tag) && output.length && output.at(-1)?.text?.endsWith('\n') !== true) output.push({text: '\n'});
      node.childNodes.forEach(child => walk(child, next, replacements));
    }
  }
  el.childNodes.forEach(node => walk(node)); return output;
}
