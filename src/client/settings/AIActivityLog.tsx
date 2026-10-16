import { useEffect, useState } from 'react';
import type { AIActivity, AIActivityPage } from '../../shared/intelligence';
import { api } from '../api';

export function AIActivityLog({onOpenPage}: {onOpenPage: (vaultId: string, pageId: string) => Promise<void>}) {
  const [data,setData]=useState<AIActivityPage>({items:[],nextCursor:null});
  const [busy,setBusy]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    async function refresh() {
      try {const result=await api.aiActivity();if(active){setData(result);setError('');}}
      catch(error){if(active)setError(error instanceof Error?error.message:'Could not load activity.');}
      finally{if(active)setBusy(false);}
    }
    void refresh();
    return()=>{active=false;};
  },[]);
  async function load(cursor?:number) {
    setBusy(true);setError('');
    try {const result=await api.aiActivity(cursor);setData(current=>cursor?{...result,items:[...current.items,...result.items.filter(item=>!current.items.some(old=>old.id===item.id))]}:result);}
    catch(error){setError(error instanceof Error?error.message:'Could not load activity.');}
    finally{setBusy(false);}
  }
  async function open(item:AIActivity) {
    try {await onOpenPage(item.vaultId!,item.objectId!);}
    catch(error){setError(error instanceof Error?error.message:'Could not open page.');}
  }
  return <section className="settings-section ai-activity" aria-labelledby="ai-activity-heading">
    <div className="ai-activity-heading"><h3 id="ai-activity-heading">AI activity log</h3><button className="button" disabled={busy} onClick={()=>void load()}>Refresh</button></div>
    <p>The latest 1,000 actions are stored locally. Prompts and responses are never copied into the log. Locked vault activity is hidden. Refresh to check running actions.</p>
    {error&&<p role="alert">{error}</p>}
    {busy&&<p role="status">Loading activity…</p>}
    {!busy&&!data.items.length&&!error&&<p role="status">No AI activity yet. Summaries and connection tests will appear here.</p>}
    <ol className="ai-activity-list">{data.items.map(item=><li key={item.id}>
      <div className="ai-activity-heading"><strong>{item.action==='page_summary'?'Page summary':'Connection test'}</strong><span className={'ai-activity-status '+item.status}>{item.status}</span></div>
      <time dateTime={item.startedAt}>{new Date(item.startedAt).toLocaleString()}</time>
      <div className="ai-activity-source">{item.objectId?<>
        {item.available?<button className="ai-activity-link" onClick={()=>void open(item)}>{item.objectTitle||'Untitled'}</button>:<span>{item.objectTitle||'Unavailable page'}</span>}
        <small>{item.vaultName} · {item.objectKind} / {item.objectId}{item.revision!==null?` · revision ${item.revision}`:''}</small>
      </>:<span>Settings → Intelligence</span>}</div>
      <small>{item.model} · {item.reasoningEffort} reasoning · {item.promptBytes===null?'Prompt not sent':`${item.promptBytes.toLocaleString()} prompt bytes`}{item.durationMs!==null?` · ${(item.durationMs/1000).toFixed(1)}s`:''}{item.httpStatus!==null&&item.httpStatus>=400?` · HTTP ${item.httpStatus}`:''}</small>
    </li>)}</ol>
    {data.nextCursor!==null&&<button className="button" disabled={busy} onClick={()=>void load(data.nextCursor!)}>Load older activity</button>}
    <p>Prompt size counts UTF-8 bytes of instructions and input text, including the note wrapper. It is not a token count. Interrupted means the server stopped before recording an outcome.</p>
  </section>;
}
