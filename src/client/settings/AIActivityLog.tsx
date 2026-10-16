import { useEffect, useState } from 'react';
import { aiActivityLabels, type AIActivity, type AIActivityPage } from '../../shared/intelligence';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { api } from '../api';

export function AIActivityLog({onOpenPage, onClose}: {onClose: () => void; onOpenPage: (vaultId: string, pageId: string) => Promise<void>}) {
  const [confirmClear,setConfirmClear]=useState(false);
  const [message,setMessage]=useState('');
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
    setBusy(true);setError('');setMessage('');
    try {const result=await api.aiActivity(cursor);setData(current=>cursor?{...result,items:[...current.items,...result.items.filter(item=>!current.items.some(old=>old.id===item.id))]}:result);}
    catch(error){setError(error instanceof Error?error.message:'Could not load activity.');}
    finally{setBusy(false);}
  }
  async function open(item:AIActivity) {
    try {await onOpenPage(item.vaultId!,item.objectId!);}
    catch(error){setError(error instanceof Error?error.message:'Could not open page.');}
  }
  async function exportCSV() {
    setBusy(true);setError('');setMessage('');
    try {
      const items:AIActivity[]=[];
      let cursor:number|undefined;
      do {
        const page=await api.aiActivity(cursor);
        items.push(...page.items);cursor=page.nextCursor??undefined;
      } while(cursor!==undefined);
      const fields: (keyof AIActivity)[]=['id','action','status','startedAt','finishedAt','vaultId','vaultName','objectKind','objectId','objectTitle','revision','model','reasoningEffort','promptBytes','durationMs','httpStatus'];
      const cell=(value:unknown)=>{
        const text=String(value??'');
        return '"'+(/^[\s]*[=+@-]/.test(text)?"'"+text:text).replace(/"/g,'""')+'"';
      };
      const csv=[fields.map(cell).join(','),...items.map(item=>fields.map(field=>cell(item[field])).join(','))].join('\r\n');
      const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download='noema-ai-activity-'+new Date().toISOString().slice(0,10)+'.csv';
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage(`Exported ${items.length} activity records.`);
    }catch(error){setError(error instanceof Error?error.message:'Could not export activity.');}
    finally{setBusy(false);}
  }
  if(confirmClear) return <ConfirmDialog title="Clear AI activity?" description="Permanently delete all available activity records, including older rows and running entries. This does not cancel running requests. Locked vault activity is kept." action="Clear activity" onClose={()=>setConfirmClear(false)} onConfirm={async()=>{await api.clearAIActivity();setData({items:[],nextCursor:null});setMessage('Activity cleared.');}}/>;
  return <Modal className="ai-activity-modal" titleId="ai-activity-heading" onClose={onClose}>
    <header className="settings-heading"><div><div className="dialog-eyebrow">INTELLIGENCE</div><h2 id="ai-activity-heading">AI activity log</h2></div><button className="settings-close" aria-label="Close activity log" onClick={onClose}>×</button></header>
    <p className="ai-activity-description">The latest 1,000 actions are stored locally. Prompts and responses are never copied into the log. Locked vault activity is hidden and excluded from export and clear.</p>
    <div className="ai-activity-toolbar"><button className="button" disabled={busy} onClick={()=>void load()}>Refresh</button><button className="button" disabled={busy||!data.items.length} onClick={()=>void exportCSV()}>Export CSV</button><button className="button danger" disabled={busy||!data.items.length} onClick={()=>setConfirmClear(true)}>Clear activity</button></div>
    {error&&<p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{busy?'Loading activity…':message||`${data.items.length} records loaded`}</p>
    <div className="ai-activity-table-wrap" tabIndex={0} role="region" aria-label="AI activity records" aria-busy={busy}>
      <table className="ai-activity-table">
        <caption className="sr-only">AI activity, newest first</caption>
        <thead><tr>{['Started','Action','Status','Source','Model / reasoning','Input bytes','Duration','HTTP'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.items.map(item=><tr key={item.id}>
          <td><time dateTime={item.startedAt}>{new Date(item.startedAt).toLocaleString()}</time></td>
          <td>{aiActivityLabels[item.action]}</td>
          <td><span className={'ai-activity-status '+item.status}>{item.status}</span></td>
          <td>{item.objectId?<>
            {item.available?<button className="ai-activity-link" onClick={()=>void open(item)}>{item.objectTitle||'Untitled'}</button>:<span>{item.objectTitle||'Unavailable page'}</span>}
            <small>{item.vaultName} · {item.objectKind} / {item.objectId}{item.revision!==null?` · revision ${item.revision}`:''}</small>
          </>:item.action==='search_embedding'?<span>Vault search<small>{item.vaultName}</small></span>:<span>Settings → Intelligence</span>}</td>
          <td>{item.model}{item.action!=='note_embedding'&&item.action!=='search_embedding'&&<small>{item.reasoningEffort} reasoning</small>}</td>
          <td>{item.promptBytes===null?'Not sent':item.promptBytes.toLocaleString()}</td>
          <td>{item.durationMs===null?'—':`${(item.durationMs/1000).toFixed(1)}s`}</td>
          <td>{item.httpStatus??'—'}</td>
        </tr>)}</tbody>
      </table>
      {!busy&&!data.items.length&&!error&&<p className="ai-activity-empty">No AI activity yet. Titles, summaries, entity scans, embeddings, and connection tests will appear here.</p>}
    </div>
    <footer className="ai-activity-footer">{data.nextCursor!==null&&<button className="button" disabled={busy} onClick={()=>void load(data.nextCursor!)}>Load older activity</button>}<p>Export includes all available records, including older rows. Input size counts UTF-8 bytes, not tokens. Embedding retries appear as separate attempts; queued jobs remain in embedding settings. Skipped means a note changed or indexing was cancelled. Interrupted means the server stopped before recording an outcome. Refresh to check running actions.</p><button className="button primary" onClick={onClose}>Done</button></footer>
  </Modal>;
}
