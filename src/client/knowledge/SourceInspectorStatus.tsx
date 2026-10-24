import {t as uiText} from '../i18n';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {useEffect, useRef, useState} from 'react';
import type {SourceFile} from '../../shared/domain';
import {request} from '../api';
import {SourceLoadingProgress} from './SourceLoadingProgress';
import {InlineNotice} from '../notifications';

function status(file:SourceFile) {
  if(file.status==='failed')return 'Processing failed';
  if(file.status==='queued')return 'Queued';
  if(file.status==='processing')return 'Processing';
  if(file.enrichment_status==='failed')return 'AI enrichment failed';
  if(['pending','running'].includes(file.enrichment_status))return 'Enriching with AI';
  return 'Ready';
}
export function SourceInspectorStatus({files,vaultId,onChange,onError}:{files:SourceFile[];vaultId:string;onChange:(file:SourceFile)=>void;onError:(error:unknown)=>void}) {
  const [pending,setPending]=useState<string|null>(null);
  const identity=files.map(file=>file.id).join(':');
  const lifecycle=useRef(0);
  useEffect(()=>{lifecycle.current++;setPending(null);return()=>{lifecycle.current++;};},[vaultId,identity]);
  async function retry(file:SourceFile) {
    if(pending)return;
    const generation=lifecycle.current;
    setPending(file.id);
    try {
      const updated=await request<SourceFile>('source-files/'+encodeURIComponent(file.id)+'/'+(file.status==='failed'?'retry':'retry-enrichment'),'POST',undefined,vaultId);
      if(lifecycle.current===generation)onChange(updated);
    }catch(error){if(lifecycle.current===generation)onError(error);}
    finally{if(lifecycle.current===generation)setPending(null);}
  }
  const failed=files.filter(file=>file.status==='failed'||file.enrichment_status==='failed');
  const working=files.filter(file=>file.status==='queued'||file.status==='processing'||file.status==='ready'&&['pending','running'].includes(file.enrichment_status));
  const label=!files.length?'No files attached':failed.length?`${failed.length} ${failed.length===1?'file needs':'files need'} attention`:working.length?`${working.length} ${working.length===1?'file processing':'files processing'}`:'Ready to read';
  return <section className="source-inspector-status" aria-label={uiText("Source processing")}>
    <div className="source-inspector-status-row"><span role="status">{label}</span></div>
    {failed.map(file=><InlineNotice id={`source-failure-${file.id}`} key={file.id} tone="error" title={file.generated_name||file.name} description={uiText(status(file))} actions={<button type="button" className="button small" disabled={!!pending} onClick={()=>void retry(file)}>{pending===file.id?uiText("Retrying…"):file.status==='failed'?uiText("Retry processing"):uiText("Retry AI")}</button>}/>)}
    {!!files.length&&<details><DisclosureSummary>{uiText("Processing details")}</DisclosureSummary><div className="source-inspector-status-files">{files.map(file=><div key={file.id}><strong>{file.generated_name||file.name}</strong><p>{status(file)}</p><SourceLoadingProgress file={file}/>{file.error&&<InlineNotice id={`source-processing-error-${file.id}`} tone="error" title={file.error} variant="compact" announcement="off"/>}{file.enrichment_error&&<InlineNotice id={`source-enrichment-error-${file.id}`} tone="error" title={file.enrichment_error} variant="compact" announcement="off"/>}</div>)}</div></details>}
  </section>;
}
