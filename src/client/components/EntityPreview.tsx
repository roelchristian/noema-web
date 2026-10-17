import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { entityLabels, type Entity } from '../../shared/domain';
import { Icon } from './Icon';

/** Delegated events also cover entity mentions rendered as editor-owned HTML. */
export function EntityPreview({entities, onOpen}: {entities: Entity[]; onOpen: (id: string) => void}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({left: 0, top: 0});
  const card = useRef<HTMLDivElement>(null), trigger = useRef<HTMLElement | null>(null);
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(entities); latest.current = entities;
  const entity = entities.find(item => item.id === target?.dataset.entity);
  function cancelTimers() { clearTimeout(opening.current); clearTimeout(closing.current); }
  function dismiss() { cancelTimers(); trigger.current = null; setTarget(null); }
  useEffect(() => {
    function mention(node: EventTarget | null) { return node instanceof Element ? node.closest<HTMLElement>('.mention[data-entity]') : null; }
    function enter(event: PointerEvent | FocusEvent) {
      if (event instanceof PointerEvent && event.pointerType === 'touch') return;
      if (card.current?.contains(event.target as Node)) { clearTimeout(closing.current); return; }
      const el = mention(event.target);
      if (!el || el.closest('[inert], dialog') || !latest.current.some(item => item.id === el.dataset.entity)) return;
      clearTimeout(closing.current);
      if (trigger.current === el) return;
      clearTimeout(opening.current); setTarget(null); trigger.current = el;
      opening.current = setTimeout(() => {
        if (el.isConnected && !document.querySelector('dialog[open]')) setTarget(el);
      }, event.type === 'focusin' ? 0 : 280);
    }
    function leave(event: PointerEvent | FocusEvent) {
      const from = event.target as Node, to = event.relatedTarget as Node | null;
      if (!trigger.current?.contains(from) && !card.current?.contains(from)) return;
      if (to && (trigger.current?.contains(to) || card.current?.contains(to))) return;
      clearTimeout(opening.current);
      closing.current = setTimeout(dismiss, 180);
    }
    function key(event: KeyboardEvent) {
      if (!trigger.current) return;
      if (event.key === 'Escape') {
        const returnFocus = card.current?.contains(document.activeElement), el = trigger.current;
        if (returnFocus) el.focus();
        dismiss(); event.preventDefault();
      } else if (event.key === 'ArrowDown' && trigger.current.contains(event.target as Node) && card.current) {
        event.preventDefault(); card.current.querySelector('button')?.focus();
      }
    }
    function outside(event: PointerEvent) { if (!card.current?.contains(event.target as Node)) dismiss(); }
    function scroll(event: Event) { if (!card.current?.contains(event.target as Node)) dismiss(); }
    document.addEventListener('pointerover', enter);
    document.addEventListener('pointerout', leave);
    document.addEventListener('focusin', enter);
    document.addEventListener('focusout', leave);
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      cancelTimers();
      document.removeEventListener('pointerover', enter);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('focusin', enter);
      document.removeEventListener('focusout', leave);
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', dismiss);
    };
  }, []);
  useLayoutEffect(() => {
    if (!target || !card.current || !entity) return;
    if (!target.isConnected) { dismiss(); return; }
    const anchor = target.getBoundingClientRect(), box = card.current.getBoundingClientRect();
    setPosition({left: Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8)), top: Math.max(8, Math.min(anchor.bottom + box.height + 16 <= innerHeight ? anchor.bottom + 8 : anchor.top - box.height - 8, innerHeight - box.height - 8))});
    target.setAttribute('aria-controls', 'entity-preview');
    return () => { target.removeAttribute('aria-controls'); };
  }, [target, entity]);
  if (!entity || !target?.isConnected) return null;
  return <div ref={card} id="entity-preview" className="entity-preview" style={position} role="dialog" aria-labelledby="entity-preview-title" aria-describedby="entity-preview-description">
    <div className="entity-preview-type"><Icon name={entity.type}/><span>{entityLabels[entity.type]}</span></div>
    <h3 id="entity-preview-title">{entity.name}</h3>
    <p id="entity-preview-description" className={!entity.description.trim() ? 'is-empty' : ''}>{entity.description.trim() || 'No description yet.'}</p>
    <button type="button" onClick={() => { const id = entity.id; dismiss(); onOpen(id); }}>Open full entity<Icon name="chevron"/></button>
    {target.closest('.page #blocks .block-content[contenteditable="true"]') && <button type="button" className="remove-entity-tag" title="Keep this text and skip automatic tagging for it" onClick={() => {
      const editor = target.closest<HTMLElement>('.block-content[contenteditable="true"]');
      if (!editor || !target.isConnected) return;
      const text = document.createElement('span');
      text.dataset.skipAutoTag = 'true';
      text.textContent = target.dataset.mentionText || entity.name;
      target.replaceWith(text);
      dismiss();
      editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'deleteContentBackward'}));
    }}>Remove entity tag<Icon name="close"/></button>}
  </div>;
}
