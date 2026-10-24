import {useEffect,useRef,useState,type RefObject} from 'react';
import type {ReadingNoteAnchor,SourceHighlight} from '../../shared/source-reading';
import {Icon} from '../components/Icon';
import type {SourceDocument} from '../../shared/source-document';
import {createReadingAnchor,rawReadingOffset,resolveReadingAnchor,type ReadingAnchor,type ReadingContinuity,type ReadingLocation} from '../../shared/reading-continuity';
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
 const leaves=Array.from(root.querySelectorAll<HTMLElement>('[data-source-start][data-source-end]'));
 const leaf=leaves.find(leaf=>Number(leaf.dataset.sourceEnd)>rawOffset)??leaves.at(-1);
 if(!leaf)return;
 let top=leaf.getBoundingClientRect().top;
 if(!leaf.hasAttribute('data-source-atomic')&&leaf.firstChild?.nodeType===Node.TEXT_NODE){
  const range=document.createRange();range.setStart(leaf.firstChild,Math.max(0,Math.min(leaf.firstChild.textContent?.length??0,rawOffset-Number(leaf.dataset.sourceStart))));range.collapse(true);
  const bounds=range.getBoundingClientRect();if(bounds.height)top=bounds.top;
 }
 window.scrollBy({top:top-readingEdge(),behavior:'instant'});
}
export function SourceReadingContinuity({file,article,selectedOffset,highlights=[],notes=[],onOpenNote,onRemoveNote,onRemoveHighlight}:{file:File;article:RefObject<HTMLElement|null>;selectedOffset?:number;highlights?:SourceHighlight[];notes?:ReadingNoteAnchor[];onOpenNote?:(id:string)=>void;onRemoveNote?:(note:ReadingNoteAnchor)=>void;onRemoveHighlight?:(id:string)=>void}) {
 const [data,setData]=useState<ReadingContinuity|null>(null),[resume,setResume]=useState<ReadingLocation|null>(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[open,setOpen]=useState(false),[label,setLabel]=useState(''),[busy,setBusy]=useState(false);
 const [tab,setTab]=useState<'bookmarks'|'annotations'|'highlights'>('bookmarks');
 const panel=useRef<HTMLDivElement>(null),opener=useRef<HTMLElement|null>(null);
 function close(){setOpen(false);opener.current?.focus();}
 const [back,setBack]=useState<ReadingAnchor|null>(null),[saveError,setSaveError]=useState('');
 const saveSequence=useRef(0),interacted=useRef(false),restored=useRef(false);
 const sessionKey='noema-source-position/'+JSON.stringify([file.vault_id,file.id]);
 const dirty=useRef<{offset:number;atEnd:boolean}|null>(null),loaded=useRef(false),alive=useRef(true);
 const route=`source-files/${encodeURIComponent(file.id)}/reading-locations`;
 useEffect(()=>{
  alive.current=true;const controller=new AbortController();
  void request<ReadingContinuity>(route,'GET',undefined,file.vault_id,controller.signal).then(value=>{if(controller.signal.aborted)return;loaded.current=true;setData(value);setResume(value.resume);}).catch(()=>{if(!controller.signal.aborted)setError('Reading locations could not be loaded. Reopen the source to retry.');});
  return()=>{alive.current=false;controller.abort();};
 },[route,file.vault_id]);
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
    const leaf=Array.from(root.querySelectorAll<HTMLElement>('[data-source-start][data-source-end]')).find(item=>Number(item.dataset.sourceEnd)>offset);
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
  panel.current?.querySelector<HTMLButtonElement>('header button')?.focus();
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
   void fetch('/api/'+route+'/resume',{method:'PUT',keepalive:true,headers:{'X-Noema-Request':'1','Content-Type':'application/json','X-Vault-Id':file.vault_id},body:JSON.stringify({...position,revision:file.textHash})}).then(response=>{if(!response.ok)throw new Error();if(alive.current&&saveSequence.current===sequence)setSaveError('');}).catch(()=>{if(saveSequence.current!==sequence)return;dirty.current??=position;if(alive.current)setSaveError('Reading position could not be saved. Continue reading; scroll to retry.');});
  }
  function capture(){
   if(!root!.isConnected||!interacted.current||!file.text.trim())return;
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
 },[article,file,route,sessionKey]);
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
   const saved=await request<ReadingLocation>(route+'/'+randomUUID(),'PUT',{offset,revision:file.textHash,label},file.vault_id);
   setData(current=>current?{...current,bookmarks:[...current.bookmarks,saved]}:current);setLabel('');setNotice('Bookmark saved.');setTab('bookmarks');setOpen(true);
  }catch{setError('Bookmark could not be saved. Try again.');}finally{setBusy(false);}
 }
 async function rename(bookmark:ReadingLocation,value:string){
  setBusy(true);setError('');try{await request(route+'/'+bookmark.id,'PATCH',{label:value},file.vault_id);setData(current=>current?{...current,bookmarks:current.bookmarks.map(item=>item.id===bookmark.id?{...item,label:value}:item)}:current);setNotice('Bookmark label saved.');}catch{setError('Bookmark label could not be saved. Try again.');}finally{setBusy(false);}
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
  {open&&<div ref={panel} className="source-bookmarks source-reading-activity" role="region" aria-label="Reading activity"><header><strong>Reading activity</strong><button type="button" className="button small" aria-label="Close reading activity" onClick={close}><Icon name="close"/></button></header>
   <div className="source-activity-tabs" role="group" aria-label="Activity type">{(['bookmarks','annotations','highlights'] as const).map(value=><button type="button" key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{value==='bookmarks'?'Bookmarks':value==='annotations'?'Annotations':'Highlights'} <span>{value==='bookmarks'?data?.bookmarks.length??0:value==='annotations'?notes.length:highlights.length}</span></button>)}</div>
   {tab==='bookmarks'&&<section aria-label="Passage bookmarks">
   <form onSubmit={event=>{event.preventDefault();void add();}}><label>Bookmark label <input aria-label="New bookmark label" maxLength={80} placeholder="Optional short label" value={label} onChange={event=>setLabel(event.target.value)}/></label><button className="button small" disabled={busy||!data||!file.text.trim()}>Bookmark passage</button><small>Uses the selected passage or current reading position.</small></form>
   {!data&&!error&&<p role="status">Loading bookmarks…</p>}
   {data?.bookmarks.length===0&&<p>No bookmarks yet.</p>}
   {data?.bookmarks.map(bookmark=><Bookmark key={bookmark.id} bookmark={bookmark} busy={busy} onOpen={()=>go(bookmark)} onRename={value=>void rename(bookmark,value)} onRemove={()=>void remove(bookmark.id)}/>)}
   </section>}
   {tab==='annotations'&&<section aria-label="Source annotations"><p className="source-activity-hint">Reading notes saved from passages in this attachment.</p>{!notes.length&&<p>No annotations yet. Select a passage and choose Add reading note.</p>}{[...notes].sort((a,b)=>a.startOffset-b.startOffset).map(note=><div className="source-bookmark" key={note.pageId}><strong>{note.title||'Reading note'}</strong><blockquote>{file.text.slice(note.startOffset,note.endOffset)}</blockquote>{note.text&&<p className="source-activity-note">{note.text}</p>}<div className="source-activity-actions"><button type="button" className="button small" onClick={()=>reveal(note.startOffset)}>Go to passage</button><button type="button" className="button small" onClick={()=>onOpenNote?.(note.pageId)}>Open note</button><button type="button" className="button small" onClick={()=>onRemoveNote?.(note)}>Remove note</button></div></div>)}</section>}
   {tab==='highlights'&&<section aria-label="Source highlights">{!highlights.length&&<p>No highlights yet. Select a passage to highlight it.</p>}{[...highlights].sort((a,b)=>a.startOffset-b.startOffset).map(highlight=><div className="source-bookmark" key={highlight.id}><span className="source-activity-color"><span className="source-highlight" data-color={highlight.color}>{highlight.color}</span></span><blockquote>{highlight.excerpt}</blockquote><div className="source-activity-actions"><button type="button" className="button small" onClick={()=>reveal(highlight.startOffset)}>Go to passage</button><button type="button" className="button small" disabled={busy} onClick={()=>void removeHighlight(highlight.id)}>Remove highlight</button></div></div>)}</section>}
   {error&&<p role="alert">{error}</p>}
  </div>}
  {back&&<button className="button small source-reading-return" onClick={returnToReading}>↩ Return to reading</button>}
  {((error&&!open)||saveError)&&<p role="alert">{saveError||error}</p>}
  <span className="sr-only" role="status">{notice}</span>
 </aside>;
}
function Bookmark({bookmark,busy,onOpen,onRename,onRemove}:{bookmark:ReadingLocation;busy:boolean;onOpen:()=>void;onRename:(value:string)=>void;onRemove:()=>void}){
 const [label,setLabel]=useState(bookmark.label);
 return <div className="source-bookmark">
  <button className="source-bookmark-destination" disabled={bookmark.resolution.status!=='resolved'} onClick={onOpen}>{bookmark.label||bookmark.anchor.quote.slice(0,60)}<small>{bookmark.resolution.status==='resolved'?bookmark.anchor.physicalPage!==undefined&&bookmark.anchor.revision?`Saved on physical page ${bookmark.anchor.physicalPage} (original revision)`:'Passage':`${bookmark.resolution.status==='ambiguous'?'Ambiguous':'Unresolved'} after source changes · choose a passage and save a new bookmark`}</small></button>
  <blockquote>{bookmark.anchor.quote}</blockquote>
  <form onSubmit={event=>{event.preventDefault();onRename(label);}}><input aria-label="Bookmark label" maxLength={80} value={label} onChange={event=>setLabel(event.target.value)}/><button className="button small" disabled={busy||label===bookmark.label}>Save label</button><button className="button small" type="button" disabled={busy} onClick={onRemove}>Remove bookmark</button></form>
 </div>;
}
