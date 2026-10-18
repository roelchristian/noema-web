import {SummaryText} from '../intelligence/SummaryText';
import { numberedSourceText } from '../../shared/source-text';
import { useEffect, useRef, useState } from 'react';
import type { SourceFile } from '../../shared/domain';
import { request } from '../api';
import { SourcePolicy } from './SourcePolicy';

export function SourceAttachments({vaultId, entityId, initial=[], onChange, onBusy, disabled=false}: {vaultId:string;entityId?:string;disabled?:boolean;initial?:SourceFile[];onChange?:(files:SourceFile[])=>void;onBusy?:(busy:boolean)=>void}) {
  const [files,setFiles]=useState(initial),[error,setError]=useState('');
  const [action,setAction]=useState(''),[expanded,setExpanded]=useState<Record<string,boolean>>({});
  const mounted=useRef(true),filesRef=useRef(files),onChangeRef=useRef(onChange);
  onChangeRef.current=onChange;
  filesRef.current=files;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  function change(next:SourceFile[]){if(!mounted.current)return;setFiles(next);filesRef.current=next;onChangeRef.current?.(next);}
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try {
        const pending=filesRef.current.filter(f=>f.status==='queued'||f.status==='processing'||f.status==='ready'&&(f.enrichment_status==='pending'||f.enrichment_status==='running'));
        if(pending.length){const updated=await Promise.all(pending.map(f=>request<SourceFile>('source-files/'+f.id,'GET',undefined,vaultId,controller.signal)));if(mounted.current){setError('');change(filesRef.current.map(file=>updated.find(f=>f.id===file.id)??file));}}
      }catch(e){if(!controller.signal.aborted&&mounted.current)setError('Unable to refresh extraction status. Reconnecting…');}
      if(!controller.signal.aborted)timer=setTimeout(poll,1500);
    }
    timer=setTimeout(poll,500);return()=>{controller.abort();clearTimeout(timer);};
  },[vaultId,entityId]);
  async function act(file:SourceFile,kind:'retry'|'retry-enrichment'|'remove'){
    setAction(file.id);onBusy?.(true);setError('');
    try {
      if(kind==='retry'||kind==='retry-enrichment'){setExpanded(current=>({...current,[file.id]:false}));const updated=await request<SourceFile>('source-files/'+file.id+'/'+kind,'POST',undefined,vaultId);change(filesRef.current.map(f=>f.id===file.id?updated:f));}
      else {await request('source-files/'+file.id,'DELETE',undefined,vaultId);change(filesRef.current.filter(f=>f.id!==file.id));}
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{if(mounted.current){setAction('');onBusy?.(false);}}
  }
  return <section className="source-attachments" aria-busy={!!action}>
    <SourcePolicy method={files[0]?.import_method==='url'?'url':'file'}/>
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    <div className="source-file-list">{files.map(file=><article key={file.id} className="source-file"><strong>{file.generated_name||file.name}</strong><small>Original filename: {file.original_filename||file.name}</small>{file.language&&<small>Language: {file.language}</small>}{file.summary&&<div className="ai-summary-text"><SummaryText text={file.summary}/></div>}<small>{(file.size/1024).toFixed(1)} KB · {file.format==='url'?'URL':file.format.toUpperCase()}</small>
      <small>{file.import_method==='url'?'Imported via URL':'Uploaded file'}{file.pdf_flattened===1?' · Flattened locally for safety':''}{file.source_url&&<> · <a href={file.source_url} target="_blank" rel="noopener noreferrer">Source URL</a></>}</small>
      <p role="status" className={'source-status '+file.status}>{file.status==='queued'?'Waiting for background processing…':file.status==='processing'?`Processing source on this device… ${file.progress}%${file.pages?` · ${file.pages} pages`:''}`:file.status==='ready'?`${file.enrichment_status==='pending'||file.enrichment_status==='running'?'Processed · Enriching with AI':file.enrichment_status==='failed'?'Processed · AI enrichment failed':'Processed'}${file.pages?` · ${file.pages} pages`:''}${file.ocr_pages?` · ${file.ocr_pages} OCR pages`:''}`:'Source inactive — processing failed'}</p>
      {file.status==='processing'&&<progress value={file.progress} max={100} aria-label={'Extracting '+file.name}/>}
      {file.enrichment_error&&<p className="dialog-error">{file.enrichment_error}</p>}{file.error&&<p className="dialog-error">{file.error}</p>}
      <div className="source-actions">{file.admitted===1&&<a href={`/api/source-files/${file.id}/download?vault=${encodeURIComponent(vaultId)}`} download>{file.pdf_flattened===1?'Download flattened PDF':file.import_method==='url'&&file.format==='txt'?'Download saved text':'Download original'}</a>}
        {entityId&&file.status==='ready'&&file.enrichment_status==='failed'&&<button type="button" className="button small" disabled={disabled||!!action} onClick={()=>void act(file,'retry-enrichment')}>Retry AI enrichment</button>}{entityId&&file.status==='failed'&&<button type="button" className="button small" disabled={disabled||!!action} onClick={()=>void act(file,'retry')}>{action===file.id?'Retrying…':'Retry processing'}</button>}
        <button type="button" className="button small" hidden={!!entityId} disabled={disabled||!!action||file.status==='processing'} onClick={()=>void act(file,'remove')}>{action===file.id?'Working…':'Remove'}</button>
      </div>
      {file.status==='ready'&&<details onToggle={event=>{const open=event.currentTarget.open;setExpanded(current=>current[file.id]===open?current:{...current,[file.id]:open});}}><summary>Read extracted text</summary>{expanded[file.id]&&<><p className="section-hint">Line references identify this extracted text, rather than printed document lines or page numbers.</p><pre className="source-text">{numberedSourceText(file.text)}</pre></>}</details>}
    </article>)}</div>
  </section>;
}
