import type {PersonaExpression} from '../../shared/ai-personas';
import {t as uiText} from '../i18n';
import {useEffect,useLayoutEffect,useRef,useState,type FormEvent,type RefObject} from 'react';
import type {Page} from '../../shared/domain';
import {PersonaSelect,PersonaExpressionSelect} from '../components/PersonaSelect';
import {highlightColors,readingNoteMaxWords,readingNoteWordCount,readingExplanationFamiliarities,type ReadingExplanationOptions,type HighlightColor,type SourceHighlight,type SourceSelection} from '../../shared/source-reading';
import {sourcePageLanguages} from '../../shared/source-page';
import {Select} from '../components/Select';
import {request} from '../api';
import {randomUUID} from '../../shared/uuid';
import {Icon} from '../components/Icon';
import {selectionPopoverPlacement} from '../editor/selection-annotation';
import {SourceSelectionPaint} from './SourceSelectionPaint';

interface ReadingFile {vault_id:string;id:string;entity_id:string|null;text:string;textHash:string}
interface SelectedPassage {highlightId?:string;color?:HighlightColor;selection:SourceSelection;box:{left:number;right:number;top:number;bottom:number}}
function mappedElement(node:Node):HTMLElement|null {
  return (node instanceof Element?node:node.parentElement)?.closest<HTMLElement>('[data-source-start][data-source-end]')??null;
}
function endpoint(element:HTMLElement,node:Node,offset:number,end:boolean):number {
  const start=Number(element.dataset.sourceStart),finish=Number(element.dataset.sourceEnd);
  if(element.hasAttribute('data-source-atomic'))return end?finish:start;
  const prefix=document.createRange();prefix.selectNodeContents(element);prefix.setEnd(node,offset);
  return Math.min(finish,start+prefix.toString().length);
}
function selectedPassage(root:HTMLElement,file:ReadingFile):SelectedPassage|null {
  const selection=getSelection();if(!selection?.rangeCount||selection.isCollapsed)return null;
  const range=selection.getRangeAt(0);
  if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return null;
  const mapped=Array.from(root.querySelectorAll<HTMLElement>('[data-source-start][data-source-end]')).filter(element=>range.intersectsNode(element));
  const first=mappedElement(range.startContainer)??mapped[0],last=mappedElement(range.endContainer)??mapped.at(-1);
  if(!first||!last)return null;
  const start=first.contains(range.startContainer)?endpoint(first,range.startContainer,range.startOffset,false):Number(first.dataset.sourceStart);
  const end=last.contains(range.endContainer)?endpoint(last,range.endContainer,range.endOffset,true):Number(last.dataset.sourceEnd);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start||start<0||end>file.text.length)return null;
  const excerpt=file.text.slice(start,end);if(!excerpt.trim())return null;
  const box=range.getBoundingClientRect();if(!box.width&&!box.height)return null;
  return {selection:{sourceId:file.entity_id!,fileId:file.id,sourceHash:file.textHash,startOffset:start,endOffset:end,excerpt},box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom}};
}
export function SourceReadingTools({file,article,highlights,onHighlight,onHighlightRemoved,onNoteCreated}:{file:ReadingFile;highlights:SourceHighlight[];article:RefObject<HTMLElement|null>;onHighlight:(highlight:SourceHighlight)=>void;onHighlightRemoved:(id:string)=>void;onNoteCreated:(page:Page)=>void}) {
  const [selected,setSelected]=useState<SelectedPassage|null>(null),[note,setNote]=useState<SourceSelection|null>(null);
  const [explain,setExplain]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [pendingColor,setPendingColor]=useState<HighlightColor|null>(null);
  const menu=useRef<HTMLDivElement>(null),selectionRef=useRef(selected);selectionRef.current=selected;
  const pinnedHighlight=useRef(false),selectionDismissed=useRef(false);
  const busyRef=useRef(busy);busyRef.current=busy;
  const [position,setPosition]=useState({left:8,top:8,maxHeight:200});
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer);},[notice]);
  useEffect(()=>{
    let frame=0,timer:ReturnType<typeof setTimeout>|undefined;
    let dragging=false,keySelecting=false;
    function inspect(){
      if(selectionDismissed.current||pinnedHighlight.current||busyRef.current||note||document.querySelector('dialog[open]')||menu.current?.contains(document.activeElement))return;
      setSelected(article.current?selectedPassage(article.current,file):null);
    }
    function schedule(){
      clearTimeout(timer);cancelAnimationFrame(frame);
      if(dragging||keySelecting||busyRef.current||note||menu.current?.contains(document.activeElement))return;
      timer=setTimeout(()=>{frame=requestAnimationFrame(inspect);},200);
    }
    function changing(){
      if(pinnedHighlight.current||busyRef.current||note||menu.current?.contains(document.activeElement))return;
      setSelected(null);schedule();
    }
    function start(event:PointerEvent){
      if(note||busyRef.current||!article.current?.contains(event.target as Node))return;
      selectionDismissed.current=false;pinnedHighlight.current=false;dragging=true;clearTimeout(timer);cancelAnimationFrame(frame);setSelected(null);
    }
    function finish(){dragging=false;schedule();}
    function keyStart(event:KeyboardEvent){
      if(note||busyRef.current)return;
      if(event.shiftKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)){
        selectionDismissed.current=false;keySelecting=true;clearTimeout(timer);cancelAnimationFrame(frame);setSelected(null);
      }
    }
    function keyFinish(){keySelecting=false;schedule();}
    function outside(event:PointerEvent){if(!menu.current?.contains(event.target as Node)&&!article.current?.contains(event.target as Node)&&!note&&!busyRef.current){pinnedHighlight.current=false;setSelected(null);}}
    function dismiss(event:KeyboardEvent){if(event.key==='Escape'&&!note){pinnedHighlight.current=false;clearTimeout(timer);cancelAnimationFrame(frame);setSelected(null);getSelection()?.removeAllRanges();}}
    function scroll(){if(!note&&!busyRef.current){pinnedHighlight.current=false;clearTimeout(timer);cancelAnimationFrame(frame);setSelected(null);}}
    function context(event:MouseEvent){if(article.current&&selectedPassage(article.current,file)){event.preventDefault();selectionDismissed.current=false;inspect();requestAnimationFrame(()=>menu.current?.querySelector<HTMLButtonElement>('button')?.focus());}}
    function openHighlight(event:MouseEvent|KeyboardEvent){
      if(note||busyRef.current)return;
      if(event instanceof KeyboardEvent&&!['Enter',' '].includes(event.key))return;
      if(!(event instanceof KeyboardEvent)&&getSelection()?.toString().trim())return;
      const element=(event.target instanceof Element?event.target:event.target instanceof Node?event.target.parentElement:null)?.closest<HTMLElement>('[data-highlight-id]');
      if(!element||!article.current?.contains(element))return;
      const highlight=highlights.find(item=>item.id===element.dataset.highlightId);if(!highlight)return;
      event.preventDefault();event.stopPropagation();clearTimeout(timer);cancelAnimationFrame(frame);selectionDismissed.current=false;pinnedHighlight.current=true;
      const box=element.getBoundingClientRect();setError('');
      setSelected({highlightId:highlight.id,color:highlight.color,selection:highlight,box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom}});
      if(event instanceof KeyboardEvent)requestAnimationFrame(()=>menu.current?.querySelector<HTMLButtonElement>('button')?.focus());
    }
    document.addEventListener('selectionchange',changing);document.addEventListener('pointerdown',start);document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);document.addEventListener('keydown',keyStart);document.addEventListener('keyup',keyFinish);
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',dismiss);window.addEventListener('scroll',scroll,true);window.addEventListener('resize',scroll);
    const root=article.current;root?.addEventListener('contextmenu',context);root?.addEventListener('click',openHighlight);root?.addEventListener('keydown',openHighlight);
    return()=>{clearTimeout(timer);cancelAnimationFrame(frame);document.removeEventListener('selectionchange',changing);document.removeEventListener('pointerdown',start);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',finish);document.removeEventListener('keydown',keyStart);document.removeEventListener('keyup',keyFinish);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',dismiss);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',scroll);root?.removeEventListener('contextmenu',context);root?.removeEventListener('click',openHighlight);root?.removeEventListener('keydown',openHighlight);};
  },[article,file,note,highlights]);
  useLayoutEffect(()=>{
    if(!selected)return;
    const element=menu.current;if(!element)return;
    function place(){
      const bounds=element!.getBoundingClientRect();
      const next=selectionPopoverPlacement(selected!.box,{width:bounds.width,height:element!.scrollHeight},{width:window.innerWidth,height:window.innerHeight});
      setPosition(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
    }
    place();const resize=new ResizeObserver(place);resize.observe(element);
    window.addEventListener('resize',place);
    return()=>{resize.disconnect();window.removeEventListener('resize',place);};
  },[selected,error,busy,note]);
  function dismissSelection() {
    // Ignore queued selection inspections until the next deliberate selection.
    selectionDismissed.current=true;pinnedHighlight.current=false;selectionRef.current=null;
    setNote(null);setSelected(null);getSelection()?.removeAllRanges();
  }
  async function highlight(color:HighlightColor) {
    const passage=selectionRef.current;if(!passage||busyRef.current)return;
    busyRef.current=true;setBusy(true);setError('');setNotice('');
    setPendingColor(color);
    try {
      const route=`source-files/${encodeURIComponent(file.id)}/highlights`;
      const saved=await request<SourceHighlight>(passage.highlightId?`${route}/${encodeURIComponent(passage.highlightId)}`:route,passage.highlightId?'PUT':'POST',passage.highlightId?{color}:{...passage.selection,color},file.vault_id);
      dismissSelection();
      setNotice(passage.highlightId?'Highlight color updated.':'Passage highlighted.');
      onHighlight(saved);
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{busyRef.current=false;setBusy(false);setPendingColor(null);}
  }
  async function removeHighlight() {
    const id=selectionRef.current?.highlightId;if(!id||busyRef.current)return;
    busyRef.current=true;setBusy(true);setError('');setNotice('');
    try {
      await request<{ok:true}>(`source-files/${encodeURIComponent(file.id)}/highlights/${encodeURIComponent(id)}`,'DELETE',undefined,file.vault_id);
      dismissSelection();setNotice('Highlight removed.');onHighlightRemoved(id);
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{busyRef.current=false;setBusy(false);}
  }
  return <>
    <SourceSelectionPaint article={article}/>
    {selected&&<div ref={menu} className={"source-reading-menu"+(note?" is-composing":"")} role={note?"dialog":"toolbar"} aria-label={note?(explain?uiText("Explain with AI"):uiText("Add reading note")):uiText("Source selection actions")} aria-modal={note?false:undefined} style={position} onPointerDown={event=>{if(!note)event.preventDefault();}} onKeyDown={event=>{
      if(note){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();}return;}
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(!buttons.length)return;
      event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+buttons.length)%buttons.length]?.focus();
    }}>
      {note?<ReadingNotePopover key={explain?'explain':'note'} explain={explain} selection={note} vaultId={file.vault_id} onClose={()=>{setNote(null);requestAnimationFrame(()=>menu.current?.querySelector<HTMLButtonElement>(explain?'.source-reading-explain-action':'.source-reading-note-action')?.focus());}} onCreated={page=>{dismissSelection();setNotice(explain?'AI explanation saved to Reading Notes.':'Reading note saved.');onNoteCreated(page);}}/>:<>
      <div className="source-reading-toolbar">
      <div className="source-highlight-colors" role="group" aria-label={uiText("Highlight color")} aria-busy={busy}>{highlightColors.map(color=><button type="button" key={color} className="source-highlight-color" data-color={color} title={uiText("Highlight {value0}",{value0: color})} aria-label={`${selected.highlightId?'Change highlight to':'Highlight passage'} ${color}`} aria-pressed={(pendingColor??selected.color)===color} disabled={busy} onClick={()=>void highlight(color)}>{(pendingColor??selected.color)===color&&<Icon name="check"/>}</button>)}</div>
      <div className="source-reading-menu-actions">
      <button type="button" className="source-reading-note-action" title={uiText("Add reading note")} aria-label={uiText("Add reading note")} disabled={busy} onClick={()=>{setExplain(false);setNote(selected.selection);setError('');}}><Icon name="compose"/></button>
      <button type="button" className="source-reading-note-action source-reading-explain-action" title={uiText("Explain with AI")} aria-label={uiText("Explain with AI")} disabled={busy} onClick={()=>{setExplain(true);setNote(selected.selection);setError('');}}><Icon name="sparkles"/></button>
      {selected.highlightId&&<button type="button" className="source-reading-note-action source-reading-remove-action" title={uiText("Remove highlight")} aria-label={uiText("Remove highlight")} disabled={busy} onClick={()=>void removeHighlight()}><Icon name="trash"/></button>}
      </div>
      </div>
      {error&&<p role="alert">{error}</p>}
      </>}
    </div>}
    {notice&&<p className="source-reading-notice" role="status">{notice}</p>}
  </>;
}
function ReadingNotePopover({selection,vaultId,onCreated,onClose,explain=false}:{selection:SourceSelection;vaultId:string;onCreated:(page:Page)=>void;onClose:()=>void;explain?:boolean}) {
  const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [requestId,setRequestId]=useState(randomUUID);
  const [personaId,setPersonaId]=useState('');
  const [personaExpression,setPersonaExpression]=useState<PersonaExpression|''>('');
  const [language,setLanguage]=useState(''),[familiarity,setFamiliarity]=useState<ReadingExplanationOptions['familiarity']>('familiar');
  const inFlight=useRef<AbortController|null>(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;inFlight.current?.abort();};},[]);
  const words=readingNoteWordCount(text),valid=explain||words>0&&words<=readingNoteMaxWords;
  async function submit(event:FormEvent){
    event.preventDefault();if(inFlight.current||!valid)return;
    const controller=new AbortController();inFlight.current=controller;setBusy(true);setError('');
    const timeout=setTimeout(()=>controller.abort(),explain?60000:15000);
    let saved:Page|undefined;
    try {
      saved=await request<Page>(`source-files/${encodeURIComponent(selection.fileId)}/reading-notes${explain?'/explain':''}`,'POST',{...selection,...(explain?{language,familiarity,...(personaId?{personaId}:{}),...(personaExpression?{personaExpression}:{})}:{text:text.trim()}),requestId},vaultId,controller.signal);
    }catch(cause){
      if(mounted.current)setError(controller.signal.aborted?'Couldn’t confirm the save. Please try again.':cause instanceof Error?cause.message:String(cause));
    }finally{clearTimeout(timeout);inFlight.current=null;if(mounted.current)setBusy(false);}
    // End the pending state before notifying the reader and updating note markers.
    if(saved&&mounted.current)onCreated(saved);
  }
  return <form className="source-reading-note-popover" onSubmit={submit} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy||explain)onClose();}
    if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&!event.nativeEvent.isComposing){event.preventDefault();if(valid&&!busy)event.currentTarget.requestSubmit();}
  }}>
    <header><span className="reading-note-form-title"><Icon name={explain?'sparkles':'annotation'}/><strong>{explain?uiText("Explain with AI"):uiText("Reading note")}</strong></span><button type="button" title={busy&&explain?uiText("Cancel explanation"):uiText("Close reading note")} aria-label={busy&&explain?uiText("Cancel explanation"):uiText("Close reading note")} disabled={busy&&!explain} onClick={onClose}><Icon name="close"/></button></header>
    <div className="reading-note-excerpt"><span>{uiText("Selected passage")}</span><blockquote>{selection.excerpt}</blockquote></div>
    {explain?<div className="reading-explanation-options">
      <label>{uiText("Language")}<Select autoFocus value={language} disabled={busy} onChange={event=>{setLanguage(event.target.value);setRequestId(randomUUID());}}><option value="">{uiText("Same as passage")}</option>{sourcePageLanguages.map(language=><option key={language} value={language}>{language}</option>)}</Select></label>
      <label>{uiText("Reader familiarity")}<Select value={familiarity} disabled={busy} onChange={event=>{setFamiliarity(event.target.value as ReadingExplanationOptions['familiarity']);setRequestId(randomUUID());}}>{Object.entries(readingExplanationFamiliarities).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label>
      <PersonaExpressionSelect value={personaExpression} disabled={busy} onChange={value=>{setPersonaExpression(value);setRequestId(randomUUID());}}/><PersonaSelect value={personaId} disabled={busy} onChange={id=>{setPersonaId(id);setRequestId(randomUUID());}}/>
      <p className="reading-explanation-help">{uiText("Creates an AI-generated reading note explaining only this passage. Up to") + " "}{readingNoteMaxWords}{" " + uiText("words.")}</p>
      {busy&&<span className="reading-explanation-status" role="status">{uiText("Explaining the passage… You can cancel with ×.")}</span>}
    </div>:<div className="reading-note-writing-area">
    <label htmlFor="source-reading-note-text">{uiText("Your note")}</label>
    <textarea id="source-reading-note-text" autoFocus rows={5} maxLength={10000} value={text} readOnly={busy} onChange={event=>setText(event.target.value)} aria-invalid={words>readingNoteMaxWords||undefined} aria-describedby="reading-note-words" placeholder={uiText("What stands out to you?")} required/>
    </div>}
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    <footer><span id="reading-note-words" className={!explain&&words>readingNoteMaxWords?'dialog-error':''}>{explain?uiText("Up to {value0} words",{value0: readingNoteMaxWords}):<>{words}<span> / {readingNoteMaxWords}{" " + uiText("words")}</span></>}</span><button className="button primary small" title={explain?uiText("Explain and save as a reading note"):uiText("Save note (⌘ / Ctrl + Enter)")} disabled={busy||!valid}>{busy?(explain?uiText("Explaining…"):uiText("Saving…")):explain?uiText("Explain & save"):uiText("Save note")}</button></footer>
  </form>;
}
