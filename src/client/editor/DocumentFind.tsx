import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Icon} from '../components/Icon';
import type {Block,Entity} from '../../shared/domain';
import {findSurfaces,replaceMatches,type FindResult,type FindSurface,type FindMatch} from './document-find';
import {captureEditorSelection,restoreEditorSelection,type EditorHistorySelection} from './history-selection';

/** Resolve model offsets without counting rendered citation labels or KaTeX internals. */
function rangeMapper(block:HTMLElement|undefined,surface:FindSurface):(match:FindMatch)=>Range|null {
 const host=block?.querySelectorAll<HTMLElement>('.block-content')[surface.surface];if(!host)return ()=>null;
 let offset=0;const atoms=surface.spans.filter(s=>s.protected);
 const pieces:{node:Node;start:number;end:number;atom:boolean;caret?:boolean}[]=[];
 function visit(node:Node){
  if(node instanceof HTMLElement&&node.matches('[aria-hidden="true"]'))return;
  if(node instanceof HTMLElement&&node.matches('[data-wikilink],[data-entity],[data-math],[data-source-reference]')){const span=atoms.find(s=>s.start===offset);const length=node.dataset.wikilink?.length??(span?span.end-span.start:0);pieces.push({node,start:offset,end:offset+length,atom:true});offset+=length;return;}
  if(node.nodeType===Node.TEXT_NODE){const text=node.textContent??'';pieces.push({node,start:offset,end:offset+text.replace(/\u200b/g,'').length,atom:false,caret:text.includes('\u200b')});offset+=text.replace(/\u200b/g,'').length;}else node.childNodes.forEach(visit);
 }visit(host);
 function point(at:number,end:boolean){const piece=pieces.find(p=>end?p.start<at&&p.end>=at:p.start<=at&&p.end>at);if(!piece)return {node:host!,offset:host!.childNodes.length};if(piece.atom)return {node:piece.node.parentNode!,offset:Array.from(piece.node.parentNode!.childNodes).indexOf(piece.node as ChildNode)+(end?1:0)};if(!piece.caret)return {node:piece.node,offset:at-piece.start};let raw=0,count=0;while(raw<(piece.node.textContent??'').length&&count<at-piece.start){if(piece.node.textContent![raw]!=='\u200b')count++;raw++;}return {node:piece.node,offset:raw};}
 return match=>{const a=point(match.start,false),b=point(match.end,true);const range=document.createRange();try{range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);return range;}catch{return null;}};
}
export function DocumentFind({blocks,entities,disabled,onChange}:{blocks:Block[];entities:Entity[];disabled:boolean;onChange:(blocks:Block[])=>void}){
 const [open,setOpen]=useState(false),[mode,setMode]=useState('text'),[query,setQuery]=useState(''),[replacement,setReplacement]=useState(''),[regex,setRegex]=useState(false),[caseSensitive,setCase]=useState(false),[wholeWord,setWhole]=useState(false),[entityId,setEntity]=useState(''),[active,setActive]=useState(0),[notice,setNotice]=useState('');
 const [replacing,setReplacing]=useState(false),[optionsOpen,setOptionsOpen]=useState(false),[snippetsOpen,setSnippetsOpen]=useState(false);
 const [result,setResult]=useState<FindResult>({matches:[]}),[ready,setReady]=useState(false);
 const panel=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),bookmark=useRef<EditorHistorySelection|null>(null);
 const surfaces=useMemo(()=>findSurfaces(blocks,entities),[blocks,entities]);
 const linked=useMemo(()=>{const ids=new Set(surfaces.flatMap(s=>s.spans.flatMap(p=>p.entityId?[p.entityId]:[])));return entities.filter(e=>ids.has(e.id));},[surfaces,entities]);
 const snapshot=useRef<{blocks:Block[];surfaces:FindSurface[];key:string}|null>(null);
 const searchKey=JSON.stringify([mode,query,replacement,regex,caseSensitive,wholeWord,entityId]);
 const current=ready&&snapshot.current?.blocks===blocks&&snapshot.current?.surfaces===surfaces&&snapshot.current?.key===searchKey;
 const restorePending=useRef(false);
 const root=()=>panel.current?.closest<HTMLElement>('article.page')??null;
 function show(replace=false){const el=root();if(el&&(document.activeElement?.closest('#blocks,#page-title')||!bookmark.current)){const captured=captureEditorSelection(el);if(captured)bookmark.current=captured;}setReplacing(replace);setOpen(true);if(open)input.current?.focus();}
 function close(){setNotice('');restorePending.current=true;setOptionsOpen(false);setSnippetsOpen(false);setOpen(false);}
 useLayoutEffect(()=>{if(open)input.current?.focus();else if(restorePending.current){restorePending.current=false;const el=root();if(el)restoreEditorSelection(el,bookmark.current);}},[open]);
 useLayoutEffect(()=>{const el=root(),shell=panel.current;if(!el||!shell)return;const measure=()=>el.style.setProperty('--document-find-height',open?`${shell.getBoundingClientRect().height}px`:'0px');measure();if(typeof ResizeObserver==='undefined')return()=>el.style.removeProperty('--document-find-height');const observer=new ResizeObserver(measure);observer.observe(shell);return()=>{observer.disconnect();el.style.removeProperty('--document-find-height');};},[open]);
 useEffect(()=>{const el=root();if(!el)return;function key(event:KeyboardEvent){if(event.isComposing||el!.dataset.entityComposing)return;const target=event.target as Element;if(!el!.contains(target)||target.closest('[role="dialog"],dialog'))return;
 // Conventional editor shortcuts: Ctrl+H / Cmd+Option+F for replace; never global.
 if((event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&['f','h'].includes(event.key.toLowerCase()))||(event.metaKey&&!event.ctrlKey&&!event.shiftKey&&event.key.toLowerCase()==='f')){event.preventDefault();show(event.key.toLowerCase()==='h'||event.altKey);}
 if(open&&event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}
 function remember(event:FocusEvent){if(open)return;const target=event.target;if(target instanceof HTMLInputElement&&target.id==='page-title')bookmark.current={kind:'title',start:target.selectionStart??0,end:target.selectionEnd??0,direction:target.selectionDirection??'none'};else if(target instanceof Element&&target.closest('#blocks')){const captured=captureEditorSelection(el!);if(captured)bookmark.current=captured;}}
 el.addEventListener('focusout',remember);el.addEventListener('keydown',key);return()=>{el.removeEventListener('focusout',remember);el.removeEventListener('keydown',key);};},[open]);
 useEffect(()=>{snapshot.current=null;setReady(false);setActive(0);if(!open)return;
 if(mode==='entity'){snapshot.current={blocks,surfaces,key:searchKey};const matches:FindMatch[]=[];outer:for(let surface=0;surface<surfaces.length;surface++){for(const span of surfaces[surface]!.spans){if(span.entityId===entityId){matches.push({surface,start:span.start,end:span.end,protected:true});if(matches.length>=2000)break outer;}}}setResult({matches,truncated:matches.length>=2000});setReady(true);return;}
 if(surfaces.reduce((n,s)=>n+s.text.length,0)>2_000_000){snapshot.current={blocks,surfaces,key:searchKey};setResult({matches:[],error:'Page exceeds the 2 million character search limit.'});setReady(true);return;}
 let cancelled=false;
 let worker:Worker|undefined;let timeout:ReturnType<typeof setTimeout>|undefined;
 const debounce=setTimeout(()=>{worker=new Worker(new URL('./document-find.worker.ts',import.meta.url),{type:'module'});timeout=setTimeout(()=>{worker?.terminate();if(cancelled)return;snapshot.current={blocks,surfaces,key:searchKey};setResult({matches:[],error:'Search timed out. Simplify the pattern or shorten the query.'});setReady(true);},300);
 worker.onmessage=event=>{clearTimeout(timeout);worker?.terminate();if(cancelled)return;snapshot.current={blocks,surfaces,key:searchKey};setResult(event.data);setReady(true);};worker.onerror=()=>{clearTimeout(timeout);worker?.terminate();if(cancelled)return;snapshot.current={blocks,surfaces,key:searchKey};setResult({matches:[],error:'Search worker unavailable.'});setReady(true);};worker.postMessage({surfaces,options:{query,replacement,regex,caseSensitive,wholeWord}});},150);
 return()=>{cancelled=true;clearTimeout(debounce);clearTimeout(timeout);worker?.terminate();};
 },[open,mode,query,replacement,regex,caseSensitive,wholeWord,surfaces,blocks,entityId]);
 const matches=current?result.matches:[];
 const suggestionStart=Math.max(0,Math.min(active-5,matches.length-30));
 useEffect(()=>{if(!open)return;const el=root();if(!el)return;const highlights=(CSS as unknown as {highlights?:Map<string,unknown>}).highlights;const HighlightClass=(window as unknown as {Highlight?:new(...ranges:Range[])=>unknown}).Highlight;
 const blocksById=new Map(Array.from(el.querySelectorAll<HTMLElement>('[data-block-id]')).map(b=>[b.dataset.blockId,b]));
 const mappers=new Map<number,(match:FindMatch)=>Range|null>();
 const mapped=matches.map(m=>{let mapper=mappers.get(m.surface);if(!mapper){const surface=surfaces[m.surface]!;mapper=rangeMapper(blocksById.get(surface.blockId),surface);mappers.set(m.surface,mapper);}return mapper(m);});
 const touched=new Set<HTMLElement>();for(const match of matches){const block=blocksById.get(surfaces[match.surface]!.blockId);if(block){block.dataset.documentFind='match';touched.add(block);}}
 const selected=matches[active];if(selected){const block=blocksById.get(surfaces[selected.surface]!.blockId);if(block)block.dataset.documentFind='active';}
 const ranges=mapped.filter((r):r is Range=>!!r);
 if(highlights&&HighlightClass){highlights.set('document-find',new HighlightClass(...ranges));if(mapped[active])highlights.set('document-find-active',new HighlightClass(mapped[active]!));}
 const m=matches[active];if(m){const block=blocksById.get(surfaces[m.surface]!.blockId);block?.scrollIntoView({block:'nearest'});}
 return()=>{for(const block of touched)delete block.dataset.documentFind;highlights?.delete('document-find');highlights?.delete('document-find-active');};},[open,matches,active,surfaces]);
 function replace(all:boolean){const saved=snapshot.current;if(!saved||saved.blocks!==blocks||saved.surfaces!==surfaces||disabled||mode!=='text'||!current)return;
 if(all&&result.truncated){setNotice('Too many matches. Narrow the query before Replace all.');return;}
 const plan=replaceMatches(blocks,surfaces,all?matches:matches[active]?[matches[active]!]:[]);if(plan.replaced)onChange(plan.blocks);setNotice(`${plan.replaced} replaced; ${plan.skipped} protected matches skipped in this page body.`);}
 const protectedCount=matches.filter(match=>match.protected).length;
 const move=(direction:number)=>setActive(index=>(index+direction+matches.length)%Math.max(1,matches.length));
 return <div ref={panel} className="document-find-shell">
 {!open?<button type="button" className="document-find-trigger" title="Find in this page (Ctrl/⌘F)" onPointerDown={()=>{const el=root();if(el)bookmark.current=captureEditorSelection(el);}} onClick={()=>show()}><Icon name="search"/>Find in page</button>:<section className="document-find" aria-label="Find in current page body">
   <div className="document-find-top">
     <button type="button" className="document-find-expand" aria-label="Replace…" title="Toggle replace (Ctrl+H / ⌘Option+F)" aria-expanded={replacing&&mode==='text'} disabled={mode!=='text'} onClick={()=>setReplacing(value=>!value)}><span className={replacing?'is-expanded':''}><Icon name="chevron"/></span></button>
     <input className="document-find-query" ref={input} aria-label={mode==='text'?'Find text':'Filter entities'} placeholder={mode==='text'?'Find in this page':'Find linked entity'} value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();move(event.shiftKey?-1:1);}}}/>
     {mode==='text'&&<div className="document-find-toggles" role="group" aria-label="Match options">
       <button type="button" aria-label="Match case" title="Match case" aria-pressed={caseSensitive} onClick={()=>setCase(value=>!value)}>Aa</button>
       <button type="button" aria-label="Whole word" title="Match whole word" aria-pressed={wholeWord} onClick={()=>setWhole(value=>!value)}><span className="document-find-word">ab</span></button>
       <button type="button" aria-label="Regular expression" title="Use regular expression" aria-pressed={regex} onClick={()=>setRegex(value=>!value)}>.*</button>
     </div>}
     <output className="document-find-count" aria-live="polite" aria-label="Match count" title={current?`${matches.length}${result.truncated?'+':''} matches in this page body`:'Searching this page body'}>{!current?'…':`${matches.length?active+1:0} of ${matches.length}${result.truncated?'+':''}`}</output>
     <button type="button" className="document-find-nav" aria-label="Previous" title="Previous match (Shift+Enter)" disabled={!matches.length} onClick={()=>move(-1)}><Icon name="arrow-up"/></button>
     <button type="button" className="document-find-nav" aria-label="Next" title="Next match (Enter)" disabled={!matches.length} onClick={()=>move(1)}><Icon name="arrow-down"/></button>
     <button type="button" className="document-find-options-toggle" aria-label="Search options" title="Search options, linked entities and snippets" aria-expanded={optionsOpen} onClick={()=>setOptionsOpen(value=>!value)}><Icon name="sliders"/></button>
     <button type="button" className="document-find-close" aria-label="Close find" title="Close (Escape)" onClick={close}><Icon name="close"/></button>
   </div>
   {mode==='text'&&replacing&&<div className="document-find-replace">
     <input aria-label="Replace with" placeholder="Replace" maxLength={10000} value={replacement} onChange={event=>setReplacement(event.target.value)}/>
     <button type="button" aria-label="Replace current" title="Replace current match" disabled={disabled||!current||!matches.length||matches[active]?.protected} onClick={()=>replace(false)}>Replace</button>
     <button type="button" aria-label="Replace all" title="Replace all eligible matches in this page body" disabled={disabled||!current||!matches.length||result.truncated} onClick={()=>replace(true)}>All</button>
   </div>}
   {mode==='entity'&&<div className="document-find-entities"><select aria-label="Linked identity" value={entityId} onChange={event=>setEntity(event.target.value)}><option value="">Choose linked identity</option>{linked.filter(entity=>[entity.name,...(entity.aliases??[]),entity.type,entity.description].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,100).map(entity=><option key={entity.id} value={entity.id}>{entity.name} · {entity.type} · {entity.description.slice(0,100)} · {entity.id.slice(0,8)}</option>)}</select><small>Annotated occurrences only. Find and navigate; entities cannot be replaced.</small></div>}
   {current&&(result.error||result.truncated||result.zeroWidth||protectedCount>0)&&<p className="document-find-feedback" role="status">{result.error??[result.truncated?'Match limit reached. Narrow the query; Replace all is disabled.':'',result.zeroWidth?'Zero-width matches skipped.':'',protectedCount?`${protectedCount} protected · skipped by replacement`: ''].filter(Boolean).join(' ')}</p>}
   {notice&&<p className="document-find-feedback" role="status">{notice}</p>}
   {optionsOpen&&<div className="document-find-options">
     <label>Search mode<select value={mode} onChange={event=>{setMode(event.target.value);setQuery('');setOptionsOpen(false);}}><option value="text">Text in page body</option><option value="entity">Linked entities in this page</option></select></label>
     <button type="button" aria-expanded={snippetsOpen} onClick={()=>setSnippetsOpen(value=>!value)}>{snippetsOpen?'Hide matches':'Show matches'}</button>
     <details><summary>Search and replacement rules</summary><small>Current page body only. Entity annotations, equations, citations, wiki links and mixed link boundaries are protected. Replacement inherits the first text run’s style. Regex captures: $1–$99, $&lt;name&gt;, $&amp; and $$. Zero-width matches are skipped. A 300 ms worker deadline and explicit page/match limits bound search.</small></details>
   </div>}
   {snippetsOpen&&<ol className="document-find-suggestions" aria-label="Matching snippets">{matches.slice(suggestionStart,suggestionStart+30).map((match,index)=>{const i=index+suggestionStart;const surface=surfaces[match.surface]!;return <li key={`${match.surface}:${match.start}`}><button type="button" aria-current={i===active?'true':undefined} onClick={()=>setActive(i)}>{surface.text.slice(Math.max(0,match.start-25),match.start)}<mark>{surface.text.slice(match.start,Math.min(match.end,match.start+100))+(match.end-match.start>100?'…':'')}</mark>{surface.text.slice(match.end,match.end+35)}{match.protected?' · protected':''}</button></li>;})}</ol>}
 </section>}
 </div>;
}
