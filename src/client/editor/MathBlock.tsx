import type {MathInlinePlacement} from '../../shared/math-blocks';
import {EquationEditor} from './EquationEditor';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Block } from '../../shared/domain';
import { renderMath } from './math';
export function MathBlock({block, onChange, onExit, onSave, onDelete, register, inlineOptions, onInline, recommendedInline}: {recommendedInline?:MathInlinePlacement;inlineOptions?:Record<MathInlinePlacement,boolean>;onInline?:(placement:MathInlinePlacement)=>void;block: Block; onChange: (source: string) => void; onExit: () => void; onSave: () => void; onDelete: () => void; register: (el: HTMLDivElement | null) => void}) {
  const source = block.content.map(segment => segment.text ?? '').join('');
  const [editing, setEditing] = useState(!source);
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), preview = useRef<HTMLButtonElement>(null);
  const editorId=useId();
  useEffect(()=>{
    if(!editing)return;
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setEditing(false);};
    document.addEventListener('pointerdown',outside,true);
    return()=>document.removeEventListener('pointerdown',outside,true);
  },[editing]);
  const close=()=>{setEditing(false);requestAnimationFrame(()=>preview.current?.focus({preventScroll:true}));};
  useLayoutEffect(() => {
    const block = root.current?.closest<HTMLElement>('[data-block-id]');
    const reveal = (event: Event) => {event.preventDefault(); setEditing(true);};
    block?.addEventListener('noema:restore-input', reveal);
    return () => block?.removeEventListener('noema:restore-input', reveal);
  }, [block.id]);
  return <div className={"math-block"+(editing?" is-editing":"")} onBlur={event=>{
    if(event.currentTarget.contains(event.relatedTarget))return;
    const element=event.currentTarget;
    // Allow focus to settle when the preview is replaced by the source field.
    requestAnimationFrame(()=>{if(element.isConnected&&!element.contains(document.activeElement))setEditing(false);});
  }} ref={el => {root.current = el; register(el);}} tabIndex={0} role="group" aria-label="Equation block" aria-description="Press Enter to add text below. Press Backspace or Delete to remove this equation." onKeyDown={event => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {event.preventDefault(); onSave();}
    if (event.key === 'Enter') {event.preventDefault(); onExit();}
    if (event.key === 'Backspace' || event.key === 'Delete') {event.preventDefault(); onDelete();}
  }}>
    <button type="button" ref={preview} hidden={editing} className="math-block-render" aria-expanded={editing} aria-controls={editing?editorId:undefined} aria-label="Edit equation" title="Edit equation" onClick={() => setEditing(value => !value)}>{source ? <span dangerouslySetInnerHTML={{__html: renderMath(source, true)}}/> : <span className="math-placeholder">Add a LaTeX equation…</span>}</button>
    {editing&&<div className="math-block-source equation-editor-shell" id={editorId}><EquationEditor inputRef={input} value={source} onChange={onChange} displayMode label="Block equation LaTeX" description="Click outside or press Escape to finish editing. Enter adds text below; Shift+Enter adds an equation line." onDone={close} conversion={onInline&&inlineOptions?{
      label:'Make Inline',disabled:!recommendedInline||!inlineOptions[recommendedInline],
      title:recommendedInline?({previous:'Make inline in the text above',next:'Make inline in the text below',both:'Join surrounding text with this inline equation'})[recommendedInline]:'Add adjacent text to make this equation inline',
      onClick:()=>{if(recommendedInline&&inlineOptions[recommendedInline])onInline(recommendedInline);},
    }:undefined} onKeyDown={event=>{
      if(event.nativeEvent.isComposing)return;
      if((event.metaKey||event.ctrlKey)&&event.key==='s'){event.preventDefault();onSave();}
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();setEditing(false);onExit();}
    }}/></div>}

  </div>;
}
