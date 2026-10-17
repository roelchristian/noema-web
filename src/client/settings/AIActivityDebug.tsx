import { useEffect, useState } from 'react';
import type { AIActivityDebug as DebugPayload } from '../../shared/intelligence';
import { Modal } from '../components/Modal';
import { api } from '../api';

function pretty(value:string|null) {
  if(value===null)return 'Not received yet.';
  try{return JSON.stringify(JSON.parse(value),null,2);}catch{return value;}
}
function outputText(data:DebugPayload) {
  if(data.response) {
    try {
      const response=JSON.parse(data.response);
      return (response.output??[]).filter((item:{type:string})=>item.type==='message').flatMap((item:{content?:{type:string;text?:string}[]})=>item.content??[]).filter((part:{type:string})=>part.type==='output_text').map((part:{text:string})=>part.text).join('\n');
    } catch { /* Partial payloads are displayed in the raw viewer. */ }
  }
  return data.events.filter(event=>event.type==='response.output_text.delta').map(event=>{
    try {const value=JSON.parse(event.data);return typeof value.delta==='string'?value.delta:'';} catch {return '';}
  }).join('');
}

export function AIActivityDebug({id,onClose}:{id:string;onClose:()=>void}) {
  const [data,setData]=useState<DebugPayload|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    let active=true,timer:ReturnType<typeof setTimeout>;
    const controller=new AbortController();
    async function refresh() {
      try{const result=await api.aiActivityDebug(id,controller.signal);if(active){setData(result);setError('');}}
      catch(error){if(active){setData(null);setError(error instanceof Error?error.message:'Could not load debug payload.');}}
      finally{if(active)timer=setTimeout(()=>void refresh(),1000);}
    }
    void refresh();
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[id]);
  function download() {
    if(!data)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`noema-ai-debug-${id}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <Modal className="ai-debug-modal" titleId="ai-debug-title" onClose={onClose}>
    <header className="settings-heading"><h2 id="ai-debug-title">AI debug payload</h2><button className="settings-close" aria-label="Close debug payload" onClick={onClose}>×</button></header>
    {error&&<p role="alert">{error}</p>}
    {!data&&!error&&<p role="status">Loading payload…</p>}
    {data&&<>
      <p className="ai-debug-status" role="status">{data.status} · {data.events.length} stream events · updates every second</p>
      <p className="ai-debug-endpoint">{data.endpoint??'Request not sent yet.'}{data.responseStatus!==null&&` · HTTP ${data.responseStatus}`}</p>
      {data.error&&<p role="alert">{data.error}</p>}
      {data.endpoint?.endsWith('/responses')&&<details open><summary>Live output</summary><pre>{outputText(data)||'Waiting for output…'}</pre></details>}
      <details open><summary>Request body</summary><pre>{pretty(data.request)}</pre></details>
      <details open><summary>Provider response {data.status==='running'?'so far':''}</summary><pre>{data.response?pretty(data.response):data.responseBody||'Waiting for response…'}</pre></details>
      <details><summary>Raw response body</summary><pre>{data.responseBody||'Waiting for response…'}</pre></details>
      <details><summary>Response metadata</summary><pre>{pretty(data.responseHeaders)}</pre></details>
      <details><summary>Stream events ({data.events.length})</summary><ol className="ai-debug-events">{data.events.map(event=><li key={event.sequence}><details><summary><time dateTime={event.receivedAt}>{new Date(event.receivedAt).toLocaleTimeString()}</time> · {event.type}</summary><pre>{pretty(event.data)}</pre></details></li>)}</ol></details>
    </>}
    <div className="dialog-actions"><button className="button" disabled={!data} onClick={download}>Download JSON</button><button className="button primary" onClick={onClose}>Back to activity</button></div>
  </Modal>;
}
