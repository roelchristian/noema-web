import { renderToStaticMarkup } from 'react-dom/server';
import { safeHref, type Entity, type Segment, type TextStyle } from '../../shared/domain';
import { Mention } from '../components/Mention';
import { renderMath } from './math';
/** Only escaped text and explicitly supported formatting reach the editable surface. */
export function segmentHTML(content: Segment[], entities: Entity[]) {
  return renderToStaticMarkup(<>{content.map((s, index) => {
    if (s.entityId) return <Mention key={index} id={s.entityId} entities={entities} onOpen={() => {}}/>;
    if (s.math) return <span key={index} className="inline-math" data-math={s.text} contentEditable={false} role="button" tabIndex={0} title="Edit equation" aria-label={`Edit equation: ${s.text}`} dangerouslySetInnerHTML={{__html: renderMath(s.text ?? '')}}/>;
    let node = <>{s.text}</>;
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
      if (node.dataset.math !== undefined) { output.push({text: node.dataset.math, math: true}); return; }
      if (allowMentions && node.dataset.entity) { output.push({entityId: node.dataset.entity}); return; }
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
