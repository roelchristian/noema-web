import {t as uiText} from '../i18n';
import {revealCitationTarget} from './citation-navigation';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {Entity, SourceReference} from '../../shared/domain';
import {Icon} from '../components/Icon';
import {citationLocation as citationLabel} from '../../shared/citations';

/** Delegation covers citations in editable notes, and locked notes. */
export function SourceReferencePreview({entities,onOpen}: {entities:Entity[];onOpen:(reference:SourceReference,trigger:HTMLElement)=>void}) {
  const [target,setTarget]=useState<HTMLElement|null>(null);
  const [position,setPosition]=useState({left:0,top:0});
  const card=useRef<HTMLDivElement>(null),trigger=useRef<HTMLElement|null>(null);
  const opening=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),closing=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const open=useRef(onOpen);open.current=onOpen;
  function dismiss(){clearTimeout(opening.current);clearTimeout(closing.current);trigger.current=null;setTarget(null);}
  function reference(element:HTMLElement):SourceReference|null {
    try{return JSON.parse(element.dataset.sourceReference!);}catch{return null;}
  }
  useEffect(()=>{
    const tag=(node:EventTarget|null)=>node instanceof Element?node.closest<HTMLElement>('[data-source-reference]'):null;
    function enter(event:PointerEvent|FocusEvent){
      if(event instanceof PointerEvent&&event.pointerType==='touch')return;
      if(card.current?.contains(event.target as Node)){clearTimeout(closing.current);return;}
      const element=tag(event.target);
      if(!element||element.closest('[inert],dialog'))return;
      clearTimeout(closing.current);
      if(trigger.current===element)return;
      clearTimeout(opening.current);setTarget(null);trigger.current=element;
      opening.current=setTimeout(()=>{if(element.isConnected)setTarget(element);},event.type==='focusin'?0:280);
    }
    function leave(event:PointerEvent|FocusEvent){
      const from=event.target as Node,to=event.relatedTarget as Node|null;
      if(!trigger.current?.contains(from)&&!card.current?.contains(from))return;
      if(to&&(trigger.current?.contains(to)||card.current?.contains(to)))return;
      clearTimeout(opening.current);closing.current=setTimeout(dismiss,180);
    }
    function activate(event:MouseEvent|KeyboardEvent){
      const element=tag(event.target);
      if(!element||element.closest('[inert],dialog')||event instanceof KeyboardEvent&&!['Enter',' '].includes(event.key))return;
      const citation=reference(element);if(!citation)return;
      event.preventDefault();event.stopPropagation();dismiss();
      const entry=element.dataset.referenceTarget?document.getElementById(element.dataset.referenceTarget):null;
      if(entry)revealCitationTarget(entry);
      else open.current(citation,element);
    }
    function key(event:KeyboardEvent){
      if(event.key==='Escape'&&trigger.current){
        const element=trigger.current,restore=card.current?.contains(document.activeElement);
        if(restore)element.focus({preventScroll:true});dismiss();event.preventDefault();event.stopPropagation();
      }else if(event.key==='ArrowDown'&&trigger.current?.contains(event.target as Node)&&card.current){
        event.preventDefault();card.current.querySelector('button')?.focus();
      }else activate(event);
    }
    function outside(event:PointerEvent){if(!card.current?.contains(event.target as Node))dismiss();}
    function scroll(event:Event){if(!card.current?.contains(event.target as Node))dismiss();}
    document.addEventListener('pointerover',enter);document.addEventListener('pointerout',leave);
    document.addEventListener('focusin',enter);document.addEventListener('focusout',leave);
    document.addEventListener('click',activate,true);document.addEventListener('keydown',key,true);
    document.addEventListener('pointerdown',outside);window.addEventListener('scroll',scroll,true);window.addEventListener('resize',dismiss);
    return()=>{
      dismiss();document.removeEventListener('pointerover',enter);document.removeEventListener('pointerout',leave);
      document.removeEventListener('focusin',enter);document.removeEventListener('focusout',leave);
      document.removeEventListener('click',activate,true);document.removeEventListener('keydown',key,true);
      document.removeEventListener('pointerdown',outside);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',dismiss);
    };
  },[]);
  useLayoutEffect(()=>{
    if(!target||!card.current)return;
    const anchor=target.getBoundingClientRect(),box=card.current.getBoundingClientRect();
    setPosition({left:Math.max(8,Math.min(anchor.left,innerWidth-box.width-8)),top:Math.max(8,Math.min(anchor.bottom+box.height+16<=innerHeight?anchor.bottom+8:anchor.top-box.height-8,innerHeight-box.height-8))});
    target.setAttribute('aria-describedby','source-reference-preview-label');
    return()=>target.removeAttribute('aria-describedby');
  },[target]);
  const citation=target?reference(target):null;
  if(!citation||!target?.isConnected)return null;
  const source=entities.find(entity=>entity.id===citation.sourceId);
  return <div ref={card} id="source-reference-preview" className="entity-preview source-reference-preview" style={position} role="dialog" aria-labelledby="source-reference-preview-title" aria-describedby="source-reference-preview-label">
    <div className="entity-preview-type"><Icon name="source"/><span title={citation.contextLabel}>{uiText("Ref.") + " "}{target.dataset.citationNumber??citation.sourceNumber??1} · {citationLabel(citation)}</span></div>
    <h3 id="source-reference-preview-title">{source?.name??uiText("Source")}</h3>
    <div className="source-reference-preview-passage">{citation.excerpt.replace(/\s+/g,' ').trim()}</div>
    <small id="source-reference-preview-label">{uiText("Saved cited passage · source context")}</small>
    <button type="button" onClick={()=>{const element=target;dismiss();open.current(citation,element);}}>{uiText("Read with context")}<Icon name="chevron"/></button>
  </div>;
}
