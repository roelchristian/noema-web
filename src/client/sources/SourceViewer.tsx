import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {Entity, SourceFile, SourceReference} from '../../shared/domain';
import {sourceTextLines} from '../../shared/source-text';
import {request} from '../api';
import {Icon} from '../components/Icon';

export function citationLabel(reference:SourceReference) {
  return reference.startLine===reference.endLine?`Line ${reference.startLine}`:`Lines ${reference.startLine}–${reference.endLine}`;
}
export function SourceLines({lines,startLine,reference}: {lines:string[];startLine:number;reference:SourceReference}) {
  return <div className="source-viewer-lines">{lines.map((text,index)=>{
    const number=startLine+index,cited=number>=reference.startLine&&number<=reference.endLine;
    return <div key={number} className={'source-viewer-line'+(cited?' is-cited':'')} data-cited-line={cited?number:undefined}>
      <span className="source-viewer-line-number" aria-hidden="true">{number}</span>
      {cited?<mark>{text||'\u00a0'}</mark>:<span className="source-viewer-line-text">{text||'\u00a0'}</span>}
    </div>;
  })}</div>;
}

export function SourceViewer({vaultId,reference,entities,onClose,onOpenEntity}: {vaultId:string;reference:SourceReference;entities:Entity[];onClose:()=>void;onOpenEntity:(id:string)=>void}) {
  const [loaded,setLoaded]=useState<{file:SourceFile;matches:boolean}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [before,setBefore]=useState(8),[after,setAfter]=useState(8);
  const panel=useRef<HTMLElement>(null),body=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null);
  const source=entities.find(entity=>entity.id===reference.sourceId);
  useEffect(()=>{
    const controller=new AbortController();setLoaded(null);setError('');
    void request<SourceFile & {textHash:string}>(`source-files/${encodeURIComponent(reference.fileId)}?fingerprint=1`,'GET',undefined,vaultId,controller.signal).then(file=>{
      if(file.entity_id!==reference.sourceId)throw new Error('This file no longer belongs to the cited source.');
      const matches=file.status==='ready'&&file.admitted===1&&file.textHash===reference.sourceHash;
      if(!controller.signal.aborted)setLoaded({file,matches});
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));});
    return()=>controller.abort();
  },[vaultId,reference.fileId,reference.sourceId,reference.sourceHash,retry]);
  useEffect(()=>{close.current?.focus({preventScroll:true});},[]);
  const lines=loaded?.matches?sourceTextLines(loaded.file.text):sourceTextLines(reference.excerpt);
  const first=loaded?.matches?Math.max(1,reference.startLine-before):reference.startLine;
  const last=loaded?.matches?Math.min(lines.length,reference.endLine+after):reference.startLine+lines.length-1;
  const visible=loaded?.matches?lines.slice(first-1,last):lines;
  useLayoutEffect(()=>{
    const target=body.current?.querySelector<HTMLElement>('[data-cited-line]'),container=panel.current;
    if(target&&container){const toolbar=container.querySelector('.panel-top')?.getBoundingClientRect().height??56;container.scrollTop+=target.getBoundingClientRect().top-container.getBoundingClientRect().top-toolbar-100;}
  },[reference.id,loaded]);
  return <aside ref={panel} id="source-viewer" className="entity-panel entity-detail-panel source-viewer" aria-labelledby="source-viewer-title" tabIndex={-1}>
    <div className="panel-top entity-detail-toolbar"><div className="entity-toolbar-heading"><span className="entity-detail-icon"><Icon name="source"/></span><h2 id="source-viewer-title" className="entity-toolbar-title">[{reference.sourceNumber??1}] {source?.name??'Source'}</h2></div><button ref={close} type="button" aria-label="Close source viewer" title="Close source viewer" onClick={onClose}><Icon name="close"/></button></div>
    <div ref={body} className="panel-body entity-detail-body">
      <div className="entity-detail-classification"><span className="entity-detail-type">Source lines</span><span>{citationLabel(reference)}</span></div>
      <div className="source-viewer-heading"><h3>Cited passage</h3><button type="button" onClick={()=>onOpenEntity(reference.sourceId)}>Source details<Icon name="chevron"/></button></div>
      <p className="section-hint">Highlighted lines support this citation. Line numbers refer to extracted text.</p>
      {!loaded&&!error&&<p className="source-viewer-status" role="status">Loading surrounding context…</p>}
      {error&&<p className="source-viewer-status" role="alert">{error} Showing the saved citation. <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
      {loaded&&!loaded.matches&&<p className="source-viewer-status">The source text has changed. Showing the excerpt saved with this citation.</p>}
      {loaded?.matches&&first>1&&<button type="button" className="source-viewer-more" onClick={()=>setBefore(value=>value+30)}><Icon name="chevron"/>Show earlier lines</button>}
      <SourceLines lines={visible} startLine={first} reference={reference}/>
      {loaded?.matches&&last<lines.length&&<button type="button" className="source-viewer-more" onClick={()=>setAfter(value=>value+30)}>Show following lines<Icon name="chevron"/></button>}
      {loaded?.matches&&<p className="source-viewer-range">Lines {first}–{last} of {lines.length.toLocaleString()} · {loaded.file.name}</p>}
    </div>
  </aside>;
}
