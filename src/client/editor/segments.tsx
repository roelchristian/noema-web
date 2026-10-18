import {citationKey,citationLocation,sortCitationRuns} from '../../shared/citations';
import type {CitationPresentation} from '../sources/CitationPresentation';
import { renderToStaticMarkup } from 'react-dom/server';
import { safeHref, type Entity, type Segment, type TextStyle } from '../../shared/domain';
import { Mention } from '../components/Mention';
import { pageLinkNodes } from './page-links';
import { renderMath } from './math';
import type { EntityReviewItem } from '../../shared/entity-match-cache';
import { segmentsEqual } from '../../shared/segments-equal';
import { replaceEditableHTML } from './preserve-caret';
import { canIdentifyEntities } from './auto-entity-matching';
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
  if (!changed && previous?.source === source && previous.key === key) return;
  clearTimeout(previous?.timer);
  const selection = document.getSelection();
  const selecting = element.closest('[data-text-selected]') || selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(element);
  const composing = element.closest('.page[data-entity-composing]');
  const citationDisplayChanged=previous?.source!==source&&content.some(segment=>segment.sourceReference)&&!composing;
  if (changed || citationDisplayChanged || (!selecting && !composing && element.querySelector('[data-entity-review]'))) {
    // Strip inherited highlight wrappers immediately when typing resumes.
    replaceEditableHTML(element, source);
  }
  const pending = {source, key, timer: undefined as ReturnType<typeof setTimeout> | undefined};
  reviewTimers.set(element, pending);
  if (key === '[]') return;
  const decorate = () => {
    if (!element.isConnected || reviewTimers.get(element) !== pending) return;
    if (!canIdentifyEntities()) { pending.timer = setTimeout(decorate, 300); return; }
    if (!segmentsEqual(readSegments(element), content)) return;
    replaceEditableHTML(element, segmentHTML(content, entities, location,false,citations));
  };
  pending.timer = setTimeout(decorate, 0);
}
/** Only escaped text and explicitly supported formatting reach the editable surface. */
export function segmentHTML(content: Segment[], entities: Entity[], review?: ReviewLocation, readOnly = false, citations?:CitationPresentation) {
  const ranges = review ? entityReviewRanges(content, entities, review) : [];
  let offset = 0;
  const numberOf=(ref:NonNullable<Segment['sourceReference']>)=>citations?.style==='references'?citations.entries.get(citationKey(ref))?.number??ref.sourceNumber??1:ref.sourceNumber??1;
  const ordered=sortCitationRuns(content,(left,right)=>numberOf(left)-numberOf(right));
  return renderToStaticMarkup(<>{ordered.map((s, index) => {
    const start = offset; offset += s.text?.length ?? 0;
    if (s.sourceReference) {
      const ref=s.sourceReference, source=entities.find(entity=>entity.id===ref.sourceId);
      const entry=citations?.entries.get(citationKey(ref)), footnote=citations?.style==='references'&&entry;
      const label=footnote?`[${entry.number}]`:`[${ref.sourceNumber??1}, ${citationLocation(ref)}]`;
      return <span key={index} id={`note-citation-${ref.id}`} className={'source-reference-tag'+(footnote?' is-footnote':'')} data-citation-number={footnote?entry.number:undefined} data-reference-target={footnote?`note-reference-${entry.number}`:undefined} contentEditable={false} role={footnote?'link':'button'} tabIndex={0} data-entity={ref.sourceId} data-source-reference={JSON.stringify(ref)} data-source-text={s.text ?? ''} data-source-segment={JSON.stringify(s)} aria-controls={footnote?`note-reference-${entry.number}`:"source-viewer"} aria-label={`${footnote?`Go to reference ${entry.number}`:`Open reference ${ref.sourceNumber??1}`}: ${source?.name??'Source'}, ${citationLocation(ref)}`}>{label}</span>;
    }
    if (s.entityId) return <Mention key={index} id={s.entityId} label={s.mentionText} entities={entities} onOpen={() => {}}/>;
    if (s.math) return <span key={index} className="inline-math" data-math={s.text} contentEditable={false} role={readOnly ? undefined : "button"} tabIndex={readOnly ? undefined : 0} title={readOnly ? undefined : "Edit equation"} aria-label={`${readOnly ? "Equation" : "Edit equation"}: ${s.text}`} dangerouslySetInnerHTML={{__html: renderMath(s.text ?? '')}}/>;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const range of ranges.filter(range => range.start < offset && range.end > start)) {
      const from = Math.max(0, range.start - start), to = Math.min(s.text?.length ?? 0, range.end - start);
      if (from > cursor) parts.push(...(s.code || s.href ? [s.text?.slice(cursor, from)] : pageLinkNodes(s.text?.slice(cursor, from) ?? '')));
      parts.push(<span key={range.id} className={'entity-review-highlight' + (range.start === start + from ? ' is-start' : '')} data-entity-review={range.id} title="Ambiguous entity · click to review">{s.text?.slice(from, to)}</span>);
      cursor = to;
    }
    parts.push(...(s.code || s.href ? [s.text?.slice(cursor)] : pageLinkNodes(s.text?.slice(cursor) ?? '')));
    let node = <>{parts}</>;
    if (s.code) node = <code>{node}</code>;
    if (s.bold) node = <strong>{node}</strong>;
    if (s.italic) node = <em>{node}</em>;
    if (s.underline) node = <u>{node}</u>;
    if (s.strike) node = <s>{node}</s>;
    if (s.href && safeHref(s.href)) node = <a href={safeHref(s.href)}>{node}</a>;
    return <span key={index} data-skip-auto-tag={s.skipAutoTag ? 'true' : undefined}>{node}</span>;
  })}</>);
}
export function readSegments(el: Node, allowMentions = true): Segment[] {
  const output: Segment[] = [];
  function walk(node: Node, style: TextStyle = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.replace(/\u200b/g, '');
      if (text) {
        const last = output.at(-1);
        if (last && !last.entityId && JSON.stringify({...last, text: ''}) === JSON.stringify({...style, text: ''})) last.text += text;
        else output.push({...style, text});
      }
    } else if (node instanceof HTMLElement) {
      if (['SCRIPT','STYLE','META','LINK','IFRAME','OBJECT'].includes(node.tagName)) return;
      if (node.dataset.wikilink !== undefined) { walk(document.createTextNode(node.dataset.wikilink), {...style,skipAutoTag:true}); return; }
      if (node.dataset.sourceReference !== undefined) {
        try {output.push(node.dataset.sourceSegment ? JSON.parse(node.dataset.sourceSegment) : {text:node.dataset.sourceText??'',sourceReference:JSON.parse(node.dataset.sourceReference)});} catch {if(node.textContent)output.push({text:node.textContent});}
        return;
      }
      if (node.dataset.math !== undefined) { output.push({text: node.dataset.math, math: true}); return; }
      if (allowMentions && node.dataset.entity) { output.push({entityId: node.dataset.entity, ...(node.dataset.mentionText ? {mentionText: node.dataset.mentionText} : {})}); return; }
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
      node.childNodes.forEach(child => walk(child, next));
    }
  }
  el.childNodes.forEach(node => walk(node)); return output;
}
