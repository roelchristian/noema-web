import { renderToStaticMarkup } from 'react-dom/server';
import type { Entity, Segment } from '../../shared/domain';
import { Mention } from '../components/Mention';
/** React escapes all user text. HTML is used only to populate the browser-owned editable surface. */
export function segmentHTML(content: Segment[], entities: Entity[]) {
  return renderToStaticMarkup(<>{content.map((s, index) => s.entityId ? <Mention key={index} id={s.entityId} entities={entities} onOpen={() => {}}/> : s.text)}</>);
}
export function readSegments(el: Node): Segment[] {
  const output: Segment[] = [];
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) { const text = node.textContent?.replace(/\u200b/g, ''); if (text) output.push({text}); }
    else if (node instanceof HTMLElement) {
      if (node.dataset.entity) output.push({entityId: node.dataset.entity});
      else if (node.tagName === 'BR') output.push({text: '\n'});
      else node.childNodes.forEach(walk);
    }
  }
  el.childNodes.forEach(walk); return output;
}
