import {createPortal} from 'react-dom';
import {DetailSidePanel} from '../components/DetailSidePanel';
import {useEffect,useMemo,useRef,useState,type RefObject} from 'react';
import type {ReadingNoteAnchor,SourceHighlight} from '../../shared/source-reading';
import {Icon} from '../components/Icon';
import {sourceDocumentEntries,type SourceDocument} from '../../shared/source-document';
import {canonicalReadingOffset,createReadingAnchor,rawReadingOffset,resolveReadingAnchor,type ReadingAnchor,type ReadingContinuity,type ReadingLocation} from '../../shared/reading-continuity';
import {request} from '../api';
import {randomUUID} from '../../shared/uuid';

interface File {id:string;vault_id:string;text:string;textHash:string;document?:SourceDocument}
const readingEdge=()=>((document.querySelector('.topbar')?.getBoundingClientRect().bottom??0)+24);
/** Select a stable text leaf at the reading edge, independent of viewport pixels. */
export function visibleReadingOffset(root:HTMLElement) {
 const leaves=Array.from(root.querySelectorAll<HTMLElement>('[data-source-start][data-source-end]'));
 const edge=readingEdge();let low=0,high=leaves.length;
 while(low<high){const mid=(low+high)>>>1;if(leaves[mid]!.getBoundingClientRect().bottom<=edge)low=mid+1;else high=mid;}
 const leaf=leaves[Math.min(low,leaves.length-1)];
 return leaf?Number(leaf.dataset.sourceStart):0;
}
export function jumpToReadingOffset(root:HTMLElement,rawOffset:number) {
 const leaves=Array.from(root.querySelectorAll<HTMLElement>('[data-source-start][data-source-end]')).sort((a,b)=>Number(a.dataset.sourceStart)-Number(b.dataset.sourceStart));
 const leaf=leaves.find(leaf=>Number(leaf.dataset.sourceEnd)>rawOffset)??leaves.at(-1);
 if(!leaf)return;
 let top=leaf.getBoundingClientRect().top;
 if(!leaf.hasAttribute('data-source-atomic')&&leaf.firstChild?.nodeType===Node.TEXT_NODE){
  const range=document.createRange();range.setStart(leaf.firstChild,Math.max(0,Math.min(leaf.firstChild.textContent?.length??0,rawOffset-Number(leaf.dataset.sourceStart))));range.collapse(true);
  const bounds=range.getBoundingClientRect();if(bounds.height)top=bounds.top;
 }
 window.scrollBy({top:top-readingEdge(),behavior:'instant'});
}
export function SourceReadingContinuity({file,revisionId,article,selectedOffset,highlights=[],notes=[],onOpenNote,onRemoveNote,onRemoveHighlight,onOpenChange,inspectorOpen=false}:{file:File;revisionId?:string;article:RefObject<HTMLElement|null>;selectedOffset?:number;highlights?:SourceHighlight[];notes?:ReadingNoteAnchor[];onOpenNote?:(id:string)=>void;onRemoveNote?:(note:ReadingNoteAnchor)=>void;onRemoveHighlight?:(id:string)=>void;onOpenChange?:(open:boolean)=>void;inspectorOpen?:boolean}) {
 const [data,setData]=useState<ReadingContinuity|null>(null),[resume,setResume]=useState<ReadingLocation|null>(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[open,setOpen]=useState(false),[label,setLabel]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{onOpenChange?.(open);return()=>onOpenChange?.(false);},[open,onOpenChange]);
 useEffect(()=>{if(inspectorOpen)setOpen(false);},[inspectorOpen]);
 const [previewLines,setPreviewLines]=useState<1|2>(()=>{try{return localStorage.getItem('noema:source-activity-lines')==='1'?1:2;}catch{return 2;}});
 function changePreviewLines(lines:1|2){setPreviewLines(lines);try{localStorage.setItem('noema:source-activity-lines',String(lines));}catch{/* Keep the option for this session. */}}
 const contextEntries=useMemo(()=>file.document?sourceDocumentEntries(file.document):[],[file.document]);
 function contextFor(offset:number){
  const canonical=canonicalReadingOffset(file.text,offset);
  const headings=contextEntries.filter(({node})=>node.title&&node.range.startOffset<=canonical);
  const containing=headings.filter(({node})=>node.range.endOffset>canonical);
  const heading=(containing.at(-1)??headings.at(-1))?.node.title;
  const page=file.document?.physical.pages.find(page=>page.range.startOffset<=canonical&&page.range.endOffset>canonical);
  return [heading,page?`p. ${page.number}`:`Line ${file.text.slice(0,offset).split('\n').length}`].filter(Boolean).join(' · ');
 }
 const [tab,setTab]=useState<'bookmarks'|'annotations'|'highlights'>('bookmarks');
 const panel=useRef<HTMLElement>(null),opener=useRef<HTMLElement|null>(null);
 function close(){setOpen(false);opener.current?.focus();}
 const [back,setBack]=useState<ReadingAnchor|null>(null),[saveError,setSaveError]=useState('');
 const saveSequence=useRef(0),interacted=useRef(false),restored=useRef(false);
 const sessionKey='noema-source-position/'+JSON.stringify([file.vault_id,file.id]);
 const dirty=useRef<{offset:number;atEnd:boolean}|null>(null),loaded=useRef(false),alive=useRef(true);
 const route=`source-files/${encodeURIComponent(file.id)}/reading-locations`;
 useEffect(()=>{
  alive.current=true;const controller=new AbortController();
  void request<ReadingContinuity>(route+(revisionId?`?revisionId=${encodeURIComponent(revisionId)}`:''),'GET',undefined,file.vault_id,controller.signal).then(value=>{if(controller.signal.aborted)return;loaded.current=true;setData(value);setResume(value.resume);}).catch(()=>{if(!controller.signal.aborted)setError('Reading locations could not be loaded. Reopen the source to retry.');});
  return()=>{alive.current=false;controller.abort();};
 },[route,file.vault_id,revisionId]);
 useEffect(()=>{
  const root=article.current;if(!root||!data||restored.current)return;
  restored.current=true;
  if(interacted.current||selectedOffset!==undefined)return;
  let location=data.resume,viewportTop:number|undefined;
  try {
   const anchor=JSON.parse(sessionStorage.getItem(sessionKey)??'null') as (ReadingAnchor&{viewportTop?:number})|null;
   if(anchor?.fileId===file.id&&typeof anchor.quote==='string'&&typeof anchor.prefix==='string'&&typeof anchor.suffix==='string'&&Number.isSafeInteger(anchor.offset)){
    const resolution=resolveReadingAnchor(anchor,file.text,file.textHash);
    if(resolution.status==='resolved'){location={id:'session',label:'',anchor,resolution};if(anchor.revision===file.textHash&&Number.isFinite(anchor.viewportTop))viewportTop=anchor.viewportTop;}
   }
  }catch{/* Fall back to the server's saved reading position. */}
  if(location?.resolution.status!=='resolved')return;
  const offset=rawReadingOffset(file.text,location.resolution.offset);
  const restore=()=>{
   if(interacted.current)return;
   if(viewportTop!==undefined){
    const leaf=Array.from(root.querySelectorAll<HTMLElement>('[data-source-start][data-source-end]')).sort((a,b)=>Number(a.dataset.sourceStart)-Number(b.dataset.sourceStart)).find(item=>Number(item.dataset.sourceEnd)>offset);
    if(leaf){window.scrollBy({top:leaf.getBoundingClientRect().top-viewportTop,behavior:'instant'});return;}
   }
   jumpToReadingOffset(root,offset);
  };
  restore();setResume(null);
  const resize=new ResizeObserver(restore);resize.observe(root);
  return()=>resize.disconnect();
 },[data,article,file,selectedOffset,sessionKey]);
 useEffect(()=>{
  const toggle=()=>{opener.current=document.activeElement as HTMLElement;setOpen(value=>!value);};window.addEventListener('noema:reading-bookmarks',toggle);
  return()=>window.removeEventListener('noema:reading-bookmarks',toggle);
 },[]);
 useEffect(()=>{
  if(!open)return;
  panel.current?.querySelector<HTMLButtonElement>('.panel-top button')?.focus();
  function dismiss(event:KeyboardEvent){if(event.key==='Escape'&&!document.querySelector('dialog[open]')){event.preventDefault();close();}}
  document.addEventListener('keydown',dismiss);
  return()=>document.removeEventListener('keydown',dismiss);
 },[open]);
 useEffect(()=>{
  const root=article.current;if(!root)return;
  let timer:ReturnType<typeof setTimeout>|undefined,frame=0;
  function flush(){
   clearTimeout(timer);const position=dirty.current;if(!position||!loaded.current)return;dirty.current=null;const sequence=++saveSequence.current;
   // keepalive also delivers the final anchor when this reader closes or reloads.
   void fetch('/api/'+route+'/resume',{method:'PUT',keepalive:true,headers:{'X-Noema-Request':'1','Content-Type':'application/json','X-Vault-Id':file.vault_id},body:JSON.stringify({...position,revision:file.textHash,...(revisionId?{revisionId}:{})})}).then(response=>{if(!response.ok)throw new Error();if(alive.current&&saveSequence.current===sequence)setSaveError('');}).catch(()=>{if(saveSequence.current!==sequence)return;dirty.current??=position;if(alive.current)setSaveError('Reading position could not be saved. Continue reading; scroll to retry.');});
  }
  function capture(){
   if(!root!.isConnected||!interacted.current||!file.text.trim()||(root!.dataset.sourceCoordinateHash!==undefined&&root!.dataset.sourceCoordinateHash!==file.textHash))return;
   dirty.current={offset:visibleReadingOffset(root!),atEnd:root!.getBoundingClientRect().bottom<=window.innerHeight&&root!.getBoundingClientRect().bottom>readingEdge()};
   const leaf=Array.from(root!.querySelectorAll<HTMLElement>('[data-source-start][data-source-end]')).find(item=>Number(item.dataset.sourceStart)===dirty.current!.offset);
   try{sessionStorage.setItem(sessionKey,JSON.stringify({...createReadingAnchor(file.id,file.textHash,file.text,dirty.current.offset,file.document,dirty.current.atEnd),viewportTop:leaf?.getBoundingClientRect().top}));}catch{/* Server persistence remains available. */}
   clearTimeout(timer);timer=setTimeout(flush,300);
  }
  function scroll(){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=0;capture();});}
  function intent(event:Event){
   if(event instanceof KeyboardEvent&&!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))return;
   interacted.current=true;
   if(event.type==='pointerdown')capture();
  }
  function beforeJump(){
   if(!loaded.current)return;
   const origin=createReadingAnchor(file.id,file.textHash,file.text,visibleReadingOffset(root!),file.document);
   setBack(previous=>previous??origin);interacted.current=true;
  }
  function hide(){if(document.visibilityState==='hidden'){capture();flush();}}
  function close(){capture();flush();}
  // Anchor navigation is observed before the browser's default hash scroll.
  function click(event:MouseEvent){const target=event.target as Element;if(target.closest?.('a[href^="#"]'))beforeJump();}
  window.addEventListener('noema:before-reading-jump',beforeJump);document.addEventListener('click',click,true);
  window.addEventListener('scroll',scroll,{passive:true});
  for(const type of ['wheel','touchstart','pointerdown','keydown'])window.addEventListener(type,intent,{passive:true});
  window.addEventListener('pagehide',close);document.addEventListener('visibilitychange',hide);
  return()=>{cancelAnimationFrame(frame);capture();flush();clearTimeout(timer);window.removeEventListener('noema:before-reading-jump',beforeJump);document.removeEventListener('click',click,true);window.removeEventListener('scroll',scroll);window.removeEventListener('pagehide',close);document.removeEventListener('visibilitychange',hide);for(const type of ['wheel','touchstart','pointerdown','keydown'])window.removeEventListener(type,intent);};
 },[article,file,route,sessionKey,revisionId]);
 function go(location:ReadingLocation){
  if(location.resolution.status!=='resolved'||!article.current)return;
  window.dispatchEvent(new Event('noema:before-reading-jump'));
  jumpToReadingOffset(article.current,rawReadingOffset(file.text,location.resolution.offset));
  close();setResume(null);setNotice(location.anchor.atEnd&&location.anchor.revision===file.textHash?'Returned to the end of the source.':'Reading location opened.');
 }
 async function add(){
  const root=article.current;if(!root||busy||!data)return;
  const selection=getSelection(),node=selection?.anchorNode;
  const selectedLeaf=node&&(node instanceof Element?node:node.parentElement)?.closest<HTMLElement>('[data-source-start]');
  const offset=selectedOffset??(selectedLeaf&&root.contains(selectedLeaf)?Number(selectedLeaf.dataset.sourceStart):visibleReadingOffset(root));
  setBusy(true);setError('');
  try{
   const saved=await request<ReadingLocation>(route+'/'+randomUUID(),'PUT',{offset,revision:file.textHash,label,...(revisionId?{revisionId}:{})},file.vault_id);
   setData(current=>current?{...current,bookmarks:[...current.bookmarks,saved]}:current);setLabel('');setNotice('Bookmark saved.');setTab('bookmarks');setOpen(true);
  }catch{setError('Bookmark could not be saved. Try again.');}finally{setBusy(false);}
 }
 async function rename(bookmark:ReadingLocation,value:string){
  setBusy(true);setError('');try{await request(route+'/'+bookmark.id,'PATCH',{label:value},file.vault_id);setData(current=>current?{...current,bookmarks:current.bookmarks.map(item=>item.id===bookmark.id?{...item,label:value}:item)}:current);setNotice('Bookmark label saved.');return true;}catch{setError('Bookmark label could not be saved. Try again.');return false;}finally{setBusy(false);}
 }
 async function remove(id:string){
  setBusy(true);setError('');try{await request(route+'/'+id,'DELETE',undefined,file.vault_id);setData(current=>current?{...current,bookmarks:current.bookmarks.filter(item=>item.id!==id)}:current);setNotice('Bookmark removed.');}catch{setError('Bookmark could not be removed. Try again.');}finally{setBusy(false);}
 }
 function reveal(offset:number){
  if(!article.current)return;
  window.dispatchEvent(new Event('noema:before-reading-jump'));
  jumpToReadingOffset(article.current,offset);close();
 }
 async function removeHighlight(id:string){
  if(busy)return;setBusy(true);setError('');
  try{await request(`source-files/${encodeURIComponent(file.id)}/highlights/${encodeURIComponent(id)}`,'DELETE',undefined,file.vault_id);onRemoveHighlight?.(id);setNotice('Highlight removed.');}
  catch{setError('Highlight could not be removed. Try again.');}finally{setBusy(false);}
 }
 function returnToReading(){
  if(!back||!article.current)return;const resolved=resolveReadingAnchor(back,file.text,file.textHash);
  if(resolved.status==='resolved'){jumpToReadingOffset(article.current,rawReadingOffset(file.text,resolved.offset));setBack(null);}
 }
 return <aside className="source-reading-continuity" aria-label="Reading continuity">
  <div className="source-continuity-actions">
   {resume&&(resume.resolution.status==='resolved'?<button className="button small" onClick={()=>go(resume)}>{resume.anchor.atEnd&&resume.anchor.revision===file.textHash?'Continue reading · End of source':'Continue reading'}</button>:<span role="status">Saved position {resume.resolution.status} after source changes.</span>)}
  </div>
  {open&&createPortal(<DetailSidePanel ref={panel} inspector className="source-reading-activity" aria-label="Reading activity" toolbar={<div className="panel-top entity-detail-toolbar"><div className="entity-toolbar-heading"><span className="entity-detail-icon" aria-hidden="true"><Icon name="reading-activity"/></span><div className="entity-toolbar-identity"><span className="source-inspector-eyebrow">Source</span><h2 className="entity-toolbar-title">Reading activity</h2></div></div><button type="button" title="Close reading activity" aria-label="Close reading activity" onClick={close}><Icon name="close"/></button></div>} tabs={
   <div className="entity-detail-tabs" role="tablist" aria-label="Activity type">{(['bookmarks','annotations','highlights'] as const).map(value=><button type="button" key={value} id={`source-activity-tab-${file.id}-${value}`} role="tab" aria-selected={tab===value} aria-controls={`source-activity-content-${file.id}`} tabIndex={tab===value?0:-1} onClick={()=>setTab(value)} onKeyDown={event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const tabs=['bookmarks','annotations','highlights'] as const,index=tabs.indexOf(value),next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:-1)+3)%3;
    setTab(tabs[next]);document.getElementById(`source-activity-tab-${file.id}-${tabs[next]}`)?.focus();
   }}>{value==='bookmarks'?'Bookmarks':value==='annotations'?'Annotations':'Highlights'} <span>{value==='bookmarks'?data?.bookmarks.length??0:value==='annotations'?notes.length:highlights.length}</span></button>)}</div>}>
   <div className="panel-body entity-detail-body source-activity-body" data-preview-lines={previewLines} id={`source-activity-content-${file.id}`} role="tabpanel" aria-labelledby={`source-activity-tab-${file.id}-${tab}`} tabIndex={0}>
   <div className="source-activity-list-options"><span>Passage context</span><div role="group" aria-label="Preview lines">{([1,2] as const).map(lines=><button type="button" className="source-activity-icon-action" key={lines} title={`${lines===1?'One-line':'Two-line'} previews`} aria-label={`${lines===1?'One-line':'Two-line'} previews`} aria-pressed={previewLines===lines} onClick={()=>changePreviewLines(lines)}><Icon name={lines===1?'preview-one-line':'preview-two-lines'}/></button>)}</div></div>
   {tab==='bookmarks'&&<section aria-label="Passage bookmarks">
   <form className="source-activity-add" onSubmit={event=>{event.preventDefault();void add();}}><input aria-label="New bookmark label" maxLength={80} placeholder="Bookmark label (optional)" value={label} onChange={event=>setLabel(event.target.value)}/><button className="source-activity-icon-action" title="Bookmark selected passage or current reading position" aria-label="Bookmark passage" disabled={busy||!data||!file.text.trim()}><Icon name="plus"/></button></form>
   {!data&&!error&&<p role="status">Loading bookmarks…</p>}
   {data?.bookmarks.length===0&&<p className="entity-detail-empty">No bookmarks yet.</p>}
   {data?.bookmarks.map(bookmark=><Bookmark key={bookmark.id} bookmark={bookmark} context={contextFor(rawReadingOffset(file.text,bookmark.resolution.status==='resolved'?bookmark.resolution.offset:bookmark.anchor.offset))} busy={busy} onOpen={()=>go(bookmark)} onRename={value=>rename(bookmark,value)} onRemove={()=>void remove(bookmark.id)}/>)}
   </section>}
   {tab==='annotations'&&<section aria-label="Source annotations">{!notes.length&&<p className="entity-detail-empty">No annotations yet. Select a passage and choose Add reading note.</p>}{[...notes].sort((a,b)=>a.startOffset-b.startOffset).map(note=><ActivityRow key={note.pageId} icon="annotation" title={note.title||'Reading note'} excerpt={file.text.slice(note.startOffset,note.endOffset)} text={note.text} context={contextFor(note.startOffset)} onOpen={()=>reveal(note.startOffset)} actions={<><button type="button" className="source-activity-icon-action" title="Open note" aria-label="Open note" onClick={()=>onOpenNote?.(note.pageId)}><Icon name="external-link"/></button><button type="button" className="source-activity-icon-action" title="Remove note" aria-label="Remove note" onClick={()=>onRemoveNote?.(note)}><Icon name="trash"/></button></>}/>)}</section>}
   {tab==='highlights'&&<section aria-label="Source highlights">{!highlights.length&&<p className="entity-detail-empty">No highlights yet. Select a passage to highlight it.</p>}{[...highlights].sort((a,b)=>a.startOffset-b.startOffset).map(highlight=><ActivityRow key={highlight.id} icon="reference-highlight" color={highlight.color} excerpt={highlight.excerpt} context={contextFor(highlight.startOffset)} onOpen={()=>reveal(highlight.startOffset)} actions={<button type="button" className="source-activity-icon-action" title="Remove highlight" aria-label="Remove highlight" disabled={busy} onClick={()=>void removeHighlight(highlight.id)}><Icon name="trash"/></button>}/>)}</section>}
   {error&&<p role="alert">{error}</p>}
   </div>
  </DetailSidePanel>,document.getElementById('root')??document.body)}
  {back&&<button className="button small source-reading-return" onClick={returnToReading}>↩ Return to reading</button>}
  {((error&&!open)||saveError)&&<p role="alert">{saveError||error}</p>}
  <span className="sr-only" role="status">{notice}</span>
 </aside>;
}
function ActivityRow({icon,title,excerpt,text,context,color,disabled=false,onOpen,actions}:{icon:string;title?:string;excerpt:string;text?:string;context:string;color?:string;disabled?:boolean;onOpen:()=>void;actions:import('react').ReactNode}){
 const passage=excerpt.replace(/\s+/g,' ').trim(),preview=(text||excerpt).replace(/\s+/g,' ').trim();
 return <div className="source-activity-row">
  <span className={'source-activity-mark'+(color?' source-highlight':'')} data-color={color} title={color?`${color} highlight`:undefined} aria-hidden="true"><Icon name={icon}/></span>
  <button type="button" className="source-activity-destination" disabled={disabled} title={[title,text,context,passage].filter(Boolean).join('\n')} aria-label={`Go to passage: ${title||passage}`} onClick={onOpen}>
   {title&&<strong className="source-activity-title">{title}</strong>}
   <span className="source-activity-preview">{preview}</span>
   <small className="source-activity-context">{context}{text&&<> · “{passage}”</>}</small>
  </button>
  <div className="source-activity-row-actions">{actions}</div>
 </div>;
}
function Bookmark({bookmark,context,busy,onOpen,onRename,onRemove}:{bookmark:ReadingLocation;context:string;busy:boolean;onOpen:()=>void;onRename:(value:string)=>Promise<boolean>;onRemove:()=>void}){
 const [label,setLabel]=useState(bookmark.label),[editing,setEditing]=useState(false);
 const resolved=bookmark.resolution.status==='resolved';
 const location=resolved?(bookmark.anchor.physicalPage!==undefined?`Saved p. ${bookmark.anchor.physicalPage} · ${context}`:context):`${bookmark.resolution.status==='ambiguous'?'Ambiguous':'Unresolved'} after source changes · save a new bookmark`;
 return <div className="source-activity-bookmark">
  <ActivityRow icon="star" title={bookmark.label||undefined} excerpt={bookmark.anchor.quote} context={location} disabled={!resolved} onOpen={onOpen} actions={<><button type="button" className="source-activity-icon-action" title="Rename bookmark" aria-label="Rename bookmark" disabled={busy} aria-expanded={editing} onClick={()=>{setLabel(bookmark.label);setEditing(value=>!value);}}><Icon name="edit"/></button><button type="button" className="source-activity-icon-action" title="Remove bookmark" aria-label="Remove bookmark" disabled={busy} onClick={onRemove}><Icon name="trash"/></button></>}/>
  {editing&&<form className="source-activity-rename" onSubmit={event=>{event.preventDefault();void onRename(label).then(saved=>{if(saved)setEditing(false);});}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)setEditing(false);}}}>
   <input autoFocus aria-label="Bookmark label" maxLength={80} disabled={busy} value={label} onChange={event=>setLabel(event.target.value)}/><button className="source-activity-icon-action" title="Save label" aria-label="Save label" disabled={busy||label===bookmark.label}><Icon name="check"/></button><button type="button" className="source-activity-icon-action" title="Cancel rename" aria-label="Cancel rename" disabled={busy} onClick={()=>setEditing(false)}><Icon name="close"/></button>
  </form>}
 </div>;
}
