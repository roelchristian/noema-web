import {t as uiText, languageLabel} from '../i18n';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {Icon} from '../components/Icon';
import {SourceLoadingProgress} from './SourceLoadingProgress';
import {SummaryText} from '../intelligence/SummaryText';
import { numberedSourceText } from '../../shared/source-text';
import { useEffect, useRef, useState } from 'react';
import type { SourceFile } from '../../shared/domain';
import { request } from '../api';
import { SourcePolicy } from './SourcePolicy';

const emptyFiles:SourceFile[]=[];

export function SourceAttachments({vaultId, entityId, initial=emptyFiles, onChange, onBusy, disabled=false, compact=false}: {compact?:boolean;vaultId:string;entityId?:string;disabled?:boolean;initial?:SourceFile[];onChange?:(files:SourceFile[])=>void;onBusy?:(busy:boolean)=>void}) {
  const [files,setFiles]=useState(initial),[error,setError]=useState('');
  const [action,setAction]=useState(''),[expanded,setExpanded]=useState<Record<string,boolean>>({});
  const mounted=useRef(true),filesRef=useRef(files),onChangeRef=useRef(onChange);
  onChangeRef.current=onChange;
  filesRef.current=files;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const actionRef=useRef(false);
  const initialRef=useRef(initial);
  const revision=useRef(0);
  useEffect(()=>{
    if(initialRef.current===initial)return;
    initialRef.current=initial;
    revision.current++;
    setFiles(initial);filesRef.current=initial;
  },[initial]);
  function change(next:SourceFile[]){if(!mounted.current)return;setFiles(next);filesRef.current=next;onChangeRef.current?.(next);}
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try {
        const pending=filesRef.current.filter(f=>f.status==='queued'||f.status==='processing'||f.status==='ready'&&(f.enrichment_status==='pending'||f.enrichment_status==='running'));
        if(pending.length&&!actionRef.current){const startedRevision=revision.current;const updated=await Promise.all(pending.map(f=>request<SourceFile>('source-files/'+f.id,'GET',undefined,vaultId,controller.signal)));if(mounted.current&&!controller.signal.aborted&&startedRevision===revision.current){setError('');change(filesRef.current.map(file=>updated.find(f=>f.id===file.id)??file));}}
      }catch(e){if(!controller.signal.aborted&&mounted.current)setError('Unable to refresh extraction status. Reconnecting…');}
      if(!controller.signal.aborted)timer=setTimeout(poll,1500);
    }
    timer=setTimeout(poll,500);return()=>{controller.abort();clearTimeout(timer);};
  },[vaultId,entityId]);
  async function act(file:SourceFile,kind:'retry'|'retry-enrichment'|'remove'){
    if(actionRef.current)return;
    actionRef.current=true;revision.current++;setAction(file.id);onBusy?.(true);setError('');
    try {
      if(kind==='retry'||kind==='retry-enrichment'){setExpanded(current=>({...current,[file.id]:false}));const updated=await request<SourceFile>('source-files/'+file.id+'/'+kind,'POST',undefined,vaultId);change(filesRef.current.map(f=>f.id===file.id?updated:f));}
      else {await request('source-files/'+file.id,'DELETE',undefined,vaultId);change(filesRef.current.filter(f=>f.id!==file.id));}
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:String(e));}finally{actionRef.current=false;revision.current++;if(mounted.current){setAction('');onBusy?.(false);}}
  }
  return <section className="source-attachments" aria-busy={!!action}>
    {!entityId&&<SourcePolicy method={files[0]?.import_method==='url'?'url':'file'} ingestionRoute={files[0]?.ingestion_origin}/>}
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    <div className="source-file-list">{files.map(file=><article key={file.id} className="source-file"><strong>{file.generated_name||file.name}</strong><small>{uiText("Original filename:") + " "}{file.original_filename||file.name}</small>{file.language&&<small>{uiText("Language:") + " "}{languageLabel(file.language)}</small>}{!entityId&&file.summary&&<div className="ai-summary-text"><SummaryText text={file.summary}/></div>}<small>{(file.size/1024).toFixed(1)}{" " + uiText("KB ·") + " "}{file.format==='url'?uiText("URL"):file.format.toUpperCase()}</small>
      <small>{file.import_method==='url'?uiText("Imported via URL"):uiText("Uploaded file")}{file.pdf_flattened===1?uiText(" · Flattened locally for safety"):''}{file.source_url&&<> · <a href={file.source_url} target="_blank" rel="noopener noreferrer">{uiText("Source URL")}</a></>}</small>
      <p role="status" className={'source-status '+file.status}>{file.status==='queued'?uiText("Waiting for background processing…"):file.status==='processing'?uiText(file.ingestion_origin&&file.ingestion_origin!=='local'?"Processing source with PDF provider… {value0}%{value1}":"Processing source on this device… {value0}%{value1}",{value0: file.progress,value1: file.pages?` · ${file.pages} pages`:''}):file.status==='ready'?`${file.enrichment_status==='pending'||file.enrichment_status==='running'?'Processed · Enriching with AI':file.enrichment_status==='failed'?'Processed · AI enrichment failed':'Processed'}${file.pages?` · ${file.pages} pages`:''}${file.ocr_pages?` · ${file.ocr_pages} OCR pages`:''}`:uiText("Source inactive — processing failed")}</p>
      {compact?(file.status==='queued'||file.status==='processing'||file.enrichment_status==='pending'||file.enrichment_status==='running'||file.error||file.enrichment_error)?<details><DisclosureSummary>{uiText("Processing details")}</DisclosureSummary><SourceLoadingProgress file={file}/>{file.status==='processing'&&(!file.ingestion_origin||file.ingestion_origin==='local')&&<progress value={file.progress} max={100} aria-label={uiText("Extracting ")+file.name}/>}{file.enrichment_error&&<p className="dialog-error">{file.enrichment_error}</p>}{file.error&&<p className="dialog-error">{file.error}</p>}</details>:null:<>
      <SourceLoadingProgress file={file}/>
      {file.status==='processing'&&(!file.ingestion_origin||file.ingestion_origin==='local')&&<progress value={file.progress} max={100} aria-label={uiText("Extracting ")+file.name}/>}
      {file.enrichment_error&&<p className="dialog-error">{file.enrichment_error}</p>}{file.error&&<p className="dialog-error">{file.error}</p>}
      </>}
      <div className="source-actions">{file.admitted===1&&<a href={`/api/source-files/${file.id}/download?vault=${encodeURIComponent(vaultId)}`} download title={file.pdf_flattened===1?uiText("Download safe viewing PDF"):uiText("Download original")} aria-label={file.pdf_flattened===1?uiText("Download safe viewing PDF"):uiText("Download original")}><Icon name="download"/>{!entityId&&<span>{file.pdf_flattened===1?uiText("Download flattened PDF"):file.import_method==='url'&&file.format==='txt'?uiText("Download saved text"):uiText("Download original")}</span>}</a>}
        {file.admitted===1&&file.status==='ready'&&file.text.trim()&&(compact?<details className="source-technical-download"><DisclosureSummary>{uiText("Technical export")}</DisclosureSummary><a href={`/api/source-files/${file.id}/download-processed?vault=${encodeURIComponent(vaultId)}`} download><Icon name="page"/><span>{uiText("Download processed JSON")}</span></a></details>:<a href={`/api/source-files/${file.id}/download-processed?vault=${encodeURIComponent(vaultId)}`} download title={uiText("Download processed JSON")} aria-label={uiText("Download processed JSON")}><Icon name="page"/>{!entityId&&<span>{uiText("Download processed JSON")}</span>}</a>)}
        {entityId&&file.status==='ready'&&file.enrichment_status==='failed'&&<button type="button" className="button small" disabled={disabled||!!action} onClick={()=>void act(file,'retry-enrichment')}>{uiText("Retry AI enrichment")}</button>}{entityId&&file.status==='failed'&&<button type="button" className="button small" disabled={disabled||!!action} onClick={()=>void act(file,'retry')}>{action===file.id?uiText("Retrying…"):uiText("Retry processing")}</button>}
        <button type="button" className="button small" hidden={!!entityId} disabled={disabled||!!action||file.status==='processing'} onClick={()=>void act(file,'remove')}>{action===file.id?uiText("Working…"):uiText("Remove")}</button>
      </div>
      {!entityId&&file.status==='ready'&&<details onToggle={event=>{const open=event.currentTarget.open;setExpanded(current=>current[file.id]===open?current:{...current,[file.id]:open});}}><DisclosureSummary>{uiText("Read extracted text")}</DisclosureSummary>{expanded[file.id]&&<><p className="section-hint">{uiText("Line references identify this extracted text, rather than printed document lines or page numbers.")}</p><pre className="source-text">{numberedSourceText(file.text)}</pre></>}</details>}
    </article>)}</div>
  </section>;
}
