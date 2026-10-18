import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {citationKey,citationLocation,noteCitations} from '../../shared/citations';
import type {Block,Entity,EntityDetail,SourceFile,SourceReference} from '../../shared/domain';
import {sourceDocumentEntries,sourceNodeLabel,sourceNodeLocator,type SourceDocument} from '../../shared/source-document';
import {sourceTextLines,sourcePageRange} from '../../shared/source-text';
import {randomUUID} from '../../shared/uuid';
import {request} from '../api';
import {Icon} from '../components/Icon';
import {menuPlacement} from '../components/menu-placement';
import {mentionCaretRect,mentionMatches} from './mention-picker';

type LoadedFile=SourceFile & {textHash:string;document?:SourceDocument};
type Location={label:string;nodeId?:string;reference?:SourceReference};
interface Props {vaultId:string;entities:Entity[];blocks:Block[];getAnchor:()=>Range|null;editor:HTMLElement;onInsert:(references:SourceReference[])=>void;onClose:(restoreFocus?:boolean)=>void}

function referenceFor(file:LoadedFile,location:Location):SourceReference {
  const label=location.label.trim(),entries=file.document?sourceDocumentEntries(file.document):[];
  const entry=entries.find(({node})=>node.id===location.nodeId);
  const lines=sourceTextLines(file.text);
  let startLine=1,endLine=lines.length,located=!label;
  const line=label.match(/^(?:l(?:ines?)?\.?\s*:?\s*)(\d+)(?:\s*[-–—]\s*(?:l\s*)?(\d+))?$/i);
  const page=label.match(/^(?:p(?:p|ages?)?\.?\s*:?\s*)(\d+)(?:\s*[-–—]\s*(?:p\.?\s*)?(\d+))?$/i);
  const starts=file.document?.physical.pages.map(page=>page.range.startLine)??JSON.parse(file.page_start_lines??'[]') as number[];
  if(line) {startLine=Number(line[1]);endLine=Number(line[2]??line[1]);located=startLine>=1&&endLine>=startLine&&endLine<=lines.length;}
  if(page) {
    const first=Number(page[1]),last=Number(page[2]??page[1]);
    located=first>=1&&last>=first&&last<=starts.length;
    if(located){startLine=starts[first-1]!;endLine=(starts[last]??lines.length+1)-1;}
  }
  if(entry){startLine=entry.node.range.startLine;endLine=entry.node.range.endLine;located=true;}
  const ref:SourceReference={id:randomUUID(),sourceId:file.entity_id!,fileId:file.id,sourceHash:file.textHash,startLine:located?startLine:1,endLine:located?endLine:1,excerpt:located?lines.slice(startLine-1,endLine).join('\n').slice(0,16000):`Location: ${label}`,userLocator:label||'Whole source'};
  if(located){
    const startOffset=lines.slice(0,startLine-1).reduce((total,line)=>total+line.length+1,0);
    ref.startOffset=entry?.node.range.startOffset??startOffset;
    ref.endOffset=entry?.node.range.endOffset??startOffset+lines.slice(startLine-1,endLine).join('\n').length;
    Object.assign(ref,file.format==='pdf'?sourcePageRange(starts,startLine,endLine):{});
  }
  if(entry){ref.nodeId=entry.node.id;ref.contextLabel=sourceNodeLabel(entry.path);ref.appLocator=sourceNodeLocator(entry.path);delete ref.userLocator;}
  return ref;
}

export function CitationPicker({vaultId,entities,blocks,getAnchor,editor,onInsert,onClose}:Props) {
  const popup=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null),locationInput=useRef<HTMLInputElement>(null);
  const [query,setQuery]=useState(''),[source,setSource]=useState<Entity|null>(null),[files,setFiles]=useState<SourceFile[]|null>(null),[fileId,setFileId]=useState('');
  const [file,setFile]=useState<LoadedFile|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[index,setIndex]=useState(0);
  const [locations,setLocations]=useState<Location[]>([{label:''}]),[active,setActive]=useState(0);
  const pageCitations=useMemo(()=>[...noteCitations(blocks).values()],[blocks]);
  const availableSources=entities.filter(entity=>entity.vault_id===vaultId&&entity.type==='source'&&!entity.inactive);
  const citedSourceOrder=new Map<string,number>();
  pageCitations.forEach(({reference},index)=>{if(!citedSourceOrder.has(reference.sourceId))citedSourceOrder.set(reference.sourceId,index);});
  const sources=mentionMatches(availableSources,query).sort((left,right)=>(citedSourceOrder.get(left.id)??Infinity)-(citedSourceOrder.get(right.id)??Infinity));
  const pageSources=sources.filter(entity=>citedSourceOrder.has(entity.id));
  const otherSources=sources.filter(entity=>!citedSourceOrder.has(entity.id));
  const choiceCount=sources.length;
  const optionId=(index:number)=>`citation-source-${index}`;
  const entries=useMemo(()=>file?.document?sourceDocumentEntries(file.document):[],[file]);
  const current=locations[active]??{label:''};
  const locationQuery=current.label.normalize('NFKC').trim().toLocaleLowerCase();
  const citedRanges=pageCitations.filter(({reference})=>reference.sourceId===source?.id&&reference.fileId===fileId);
  const matchingRanges=citedRanges.filter(({reference})=>!locationQuery||`${citationLocation(reference)} ${reference.contextLabel??''}`.normalize('NFKC').toLocaleLowerCase().includes(locationQuery));
  const citedNodes=new Set(citedRanges.filter(({reference})=>reference.sourceHash===file?.textHash).map(({reference})=>reference.nodeId));
  const suggestions=entries.filter(({node,path})=>node.title&&!citedNodes.has(node.id)&&(!locationQuery||`${sourceNodeLabel(path)} ${sourceNodeLocator(path)??''}`.normalize('NFKC').toLocaleLowerCase().includes(locationQuery))).slice(0,8);
  const updateLocation=(location:Location)=>setLocations(values=>values.map((value,i)=>i===active?location:value));
  useEffect(()=>{search.current?.focus({preventScroll:true});},[]);
  useEffect(()=>{if(file)locationInput.current?.focus({preventScroll:true});},[file]);
  useEffect(()=>{
    if(!source)return;
    const controller=new AbortController();setFiles(null);setError('');
    void request<EntityDetail>(`entities/${encodeURIComponent(source.id)}`,'GET',undefined,vaultId,controller.signal).then(detail=>{
      if(controller.signal.aborted)return;
      const available=(detail.attachments??[]).filter(file=>file.status==='ready'&&file.admitted===1);
      const citedFile=pageCitations.find(({reference})=>reference.sourceId===source.id&&available.some(file=>file.id===reference.fileId))?.reference.fileId;
      setFiles(available);setFileId(citedFile??available[0]?.id??'');
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));});
    return()=>controller.abort();
  },[source,vaultId,retry]);
  useEffect(()=>{
    setFile(null);setLocations([{label:''}]);setActive(0);setError('');
    if(!fileId||!source)return;
    const controller=new AbortController();
    void request<LoadedFile>(`source-files/${encodeURIComponent(fileId)}?fingerprint=1&context=1`,'GET',undefined,vaultId,controller.signal).then(file=>{
      if(controller.signal.aborted)return;
      if(file.entity_id!==source.id||file.status!=='ready'||file.admitted!==1)throw new Error('This source is still processing. Choose another source or try again later.');
      setFile(file);locationInput.current?.focus({preventScroll:true});
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));});
    return()=>controller.abort();
  },[fileId,source,vaultId,retry]);
  useLayoutEffect(()=>{
    const element=popup.current;if(!element)return;
    const position=()=>{
      const anchor=getAnchor();
      if(!anchor){onClose();return;}
      const visible=window.visualViewport;
      const viewport={left:visible?.offsetLeft??0,top:visible?.offsetTop??0,width:visible?.width??innerWidth,height:visible?.height??innerHeight};
      const rect=mentionCaretRect(anchor,editor);
      if(rect.bottom<viewport.top||rect.top>viewport.top+viewport.height){onClose();return;}
      element.style.maxHeight='none';
      const placement=menuPlacement(rect,320,element.scrollHeight+element.offsetHeight-element.clientHeight,viewport,'start',380);
      Object.assign(element.style,{left:placement.left+'px',top:placement.top+'px',width:placement.width+'px',maxHeight:placement.maxHeight+'px'});
    };
    position();const observer=new ResizeObserver(position);observer.observe(element);
    window.addEventListener('scroll',position,true);window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
    return()=>{observer.disconnect();window.removeEventListener('scroll',position,true);window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);};
  },[getAnchor,editor,onClose]);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(!popup.current?.contains(event.target as Node))onClose();};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[onClose]);
  const choose=(entity:Entity)=>{setSource(entity);setQuery('');setIndex(0);};
  const insert=()=>{if(file)onInsert(locations.map(location=>location.reference?{...location.reference,id:randomUUID()}:referenceFor(file,location)));};
  return <div ref={popup} className="citation-picker selection-popover" role="dialog" aria-modal="false" aria-label="Add citation" onMouseDown={event=>{if((event.target as Element).closest('button'))event.preventDefault();}} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose(true);}
  }}>
    <div className="citation-picker-heading"><Icon name="source"/><strong>Add citation</strong><button type="button" aria-label="Close citation picker" onClick={()=>onClose(true)}><Icon name="close"/></button></div>
    {!source?<>
      <input ref={search} aria-label="Search citation sources" placeholder="Search sources…" value={query} role="combobox" aria-autocomplete="list" aria-expanded={choiceCount>0} aria-controls="citation-source-options" aria-activedescendant={index<choiceCount?optionId(index):undefined} onChange={event=>{setQuery(event.target.value);setIndex(0);}} onKeyDown={event=>{
        if((event.key==='ArrowDown'||event.key==='ArrowUp')&&choiceCount){event.preventDefault();const next=(index+(event.key==='ArrowDown'?1:-1)+choiceCount)%choiceCount;setIndex(next);popup.current?.querySelector(`#${optionId(next)}`)?.scrollIntoView({block:'nearest'});}
        if(event.key==='Enter'&&index<choiceCount){event.preventDefault();choose(sources[index]!);}
      }}/>
      <div id="citation-source-options" className="citation-picker-options" role="listbox" aria-label="Sources">
        {[{label:'Already in this page',items:pageSources,offset:0},{label:'Other sources',items:otherSources,offset:pageSources.length}].map(group=>group.items.length>0&&<div key={group.label} role="group" aria-label={group.label}>
          {pageSources.length>0&&<div className="citation-picker-group-label" aria-hidden="true">{group.label}</div>}
          {group.items.map((entity,i)=>{const position=i+group.offset;return <button type="button" id={optionId(position)} key={entity.id} role="option" aria-selected={index===position} className={index===position?'highlight':''} onClick={()=>choose(entity)}><Icon name="source"/><span title={entity.name}>{entity.name}</span><Icon name="chevron"/></button>;})}
        </div>)}
      </div>
      {!choiceCount&&<p className="citation-picker-help">{query?'No matching sources. Try another name.':'Add a source to your library to cite it here.'}</p>}
    </>:<>
      <button type="button" className="citation-picker-source" onClick={()=>{setSource(null);setFileId('');setFile(null);setError('');requestAnimationFrame(()=>search.current?.focus());}}><span>‹ Change</span><strong title={source.name}>{source.name}</strong></button>
      {files&&files.length>1&&<label className="citation-picker-label">File<select aria-label="Source file" value={fileId} onChange={event=>setFileId(event.target.value)}>{files.map(file=><option key={file.id} value={file.id}>{file.name}</option>)}</select></label>}
      {!error&&(!files||fileId&&!file)&&<p className="citation-picker-help" role="status">Loading source…</p>}
      {files?.length===0&&<p className="citation-picker-help">This source has no processed files yet. Add a file in source details, then cite it here.</p>}
      {file&&<form className="citation-range-form" onSubmit={event=>{event.preventDefault();insert();}}>
        <label className="citation-picker-label citation-range-label" htmlFor="citation-location">Location <span title="Leave blank to cite the whole source">optional</span></label>
        <p id="citation-location-help" className="block-drag-sr">Any location, or leave blank for the whole source.</p>
        {locations.map((location,i)=><div className="citation-picker-range" key={i}><input id={i===active?'citation-location':undefined} ref={i===active?locationInput:undefined} aria-label={`Citation location ${i+1}`} aria-describedby="citation-location-help" placeholder="pp. 12–18, L20–65, Appendix B…" maxLength={1000} value={location.label} onFocus={()=>setActive(i)} onChange={event=>{setActive(i);setLocations(values=>values.map((value,index)=>index===i?{label:event.target.value}:value));}}/>{locations.length>1&&<button type="button" aria-label={`Remove location ${i+1}`} onClick={()=>{setLocations(values=>values.filter((_,index)=>index!==i));setActive(0);}}><Icon name="close"/></button>}</div>)}
        {(matchingRanges.length>0||suggestions.length>0)&&<div className="citation-picker-options citation-section-options">
          {matchingRanges.length>0&&<div role="group" aria-label="Already cited ranges">
            <div className="citation-picker-group-label" aria-hidden="true">Already cited</div>
            {matchingRanges.map(({reference,number})=><button type="button" key={citationKey(reference)} className={current.reference&&citationKey(current.reference)===citationKey(reference)?'highlight':''} onClick={()=>{updateLocation({label:citationLocation(reference),reference});locationInput.current?.focus();}}>
              <span title={reference.contextLabel??citationLocation(reference)}>{citationLocation(reference)}</span><small>[{number}]</small>
            </button>)}
          </div>}
          {suggestions.length>0&&<div role="group" aria-label="Suggested sections">
            {matchingRanges.length>0&&<div className="citation-picker-group-label" aria-hidden="true">Sections</div>}
            {suggestions.map(({node,path})=><button type="button" key={node.id} className={current.nodeId===node.id?'highlight':''} onClick={()=>{updateLocation({label:sourceNodeLabel(path),nodeId:node.id});locationInput.current?.focus();}}><span title={sourceNodeLabel(path)}>{node.title}</span><small title={sourceNodeLocator(path)}>{sourceNodeLocator(path)}</small></button>)}
          </div>}
        </div>}
        <div className="citation-picker-actions"><button type="button" onClick={()=>{setLocations(values=>[...values,{label:''}]);setActive(locations.length);requestAnimationFrame(()=>locationInput.current?.focus());}}>+ Add range</button><button type="submit" className="button citation-picker-insert">Insert {locations.length>1?`${locations.length} citations`:'citation'}</button></div>
      </form>}
    </>}
    {error&&<p className="citation-picker-error" role="alert">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
  </div>;
}
