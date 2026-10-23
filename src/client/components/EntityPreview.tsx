import type {NoteDateItem} from '../../shared/note-dates';
import {t as uiText} from '../i18n';
import { entityMentionName } from '../../shared/domain';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Entity } from '../../shared/domain';
import { Icon } from './Icon';

/** One shared card for editor mentions and explicitly marked entity list items. */
export function EntityPreview({entities, onOpen, dates=[], onOpenDate}: {entities: Entity[]; onOpen: (id: string) => void; dates?:NoteDateItem[]; onOpenDate?:(id:string)=>void}) {
  const items=useMemo(()=>[...entities,...dates.map(item=>({id:item.id,name:item.name,type:'date' as const,description:`${item.date.calendar==='julian'?'Julian':'Gregorian'} · ${item.date.precision} precision`}))],[entities,dates]);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({left: 0, top: 0});
  const card = useRef<HTMLDivElement>(null), trigger = useRef<HTMLElement | null>(null);
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(items); latest.current = items;
  const entity = items.find(item => item.id === (target?.dataset.entity??target?.dataset.noteDate));
  function cancelTimers() { clearTimeout(opening.current); clearTimeout(closing.current); }
  function dismiss() { cancelTimers(); trigger.current = null; setTarget(null); }
  useEffect(() => {
    function mention(node: EventTarget | null) { return node instanceof Element ? node.closest<HTMLElement>('.mention[data-entity], [data-entity-preview][data-entity], [data-note-date]') : null; }
    function enter(event: PointerEvent | FocusEvent) {
      if (event instanceof PointerEvent && event.pointerType === 'touch') return;
      if (card.current?.contains(event.target as Node)) { clearTimeout(closing.current); return; }
      const el = mention(event.target);
      if (!el || el.closest('[inert], dialog') || !latest.current.some(item => item.id === (el.dataset.entity??el.dataset.noteDate))) return;
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
  const description=entity.description.trim();
  return <div ref={card} id="entity-preview" className="entity-preview" style={position} role="dialog" aria-labelledby="entity-preview-title" aria-describedby={description?'entity-preview-description':undefined}>
    <div className="entity-preview-heading"><Icon name={entity.type==='date'?'event':entity.type}/><h3 id="entity-preview-title">{entity.name}</h3></div>
    {description&&<p id="entity-preview-description">{description}</p>}
    <div className="entity-preview-actions">
    <button type="button" className="entity-preview-open" onClick={() => { const id = entity.id; dismiss(); if(entity.type==='date')onOpenDate?.(id);else onOpen(id); }}><Icon name="external-link"/>{uiText(entity.type==='date'?'Open date':'Open entity')}</button>
    {target.closest('.page #blocks .block-content[contenteditable="true"]') && <button type="button" className="remove-entity-tag" aria-label={uiText("Remove entity tag")} title={uiText("Remove entity tag")+' · '+uiText("Keep this text and skip automatic tagging for it")} onClick={() => {
      const editor = target.closest<HTMLElement>('.block-content[contenteditable="true"]');
      if (!editor || !target.isConnected) return;
      const text = document.createElement('span');
      text.dataset.skipAutoTag = 'true';
      text.textContent = target.dataset.mentionText ?? (entity.type==='date'?target.textContent:entityMentionName(entity)) ?? entity.name;
      if(entity.type==='date'){
        for(const fragment of editor.querySelectorAll<HTMLElement>('[data-note-date]'))if(fragment.dataset.noteDate===target.dataset.noteDate&&fragment.dataset.noteDateStart===target.dataset.noteDateStart){
          const replacement=document.createElement('span');replacement.dataset.skipAutoTag='true';
          for(const child of [...fragment.childNodes])if(!(child instanceof Element&&child.matches('.icon')))replacement.append(child);
          fragment.replaceWith(replacement);
        }
      }else target.replaceWith(text);
      dismiss();
      editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'deleteContentBackward'}));
    }}><Icon name="unlink"/></button>}
    </div>
  </div>;
}
