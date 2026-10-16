import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { AISummary, Page } from '../../shared/domain';
export function IntelligencePanel({page,onClose,onSettings,onFlush}:{page:Page;onClose:()=>void;onSettings:()=>void;onFlush:()=>Promise<Page|null>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<AISummary|null>(null);
  const active=useRef(true),close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{active.current=true;close.current?.focus();return()=>{active.current=false;};},[]);
  async function summarize() {
    setBusy(true);setError('');setResult(null);
    try {
      const saved=await onFlush();
      if(!active.current)return;
      if(!saved||saved.id!==page.id||saved.vault_id!==page.vault_id)throw new Error('The selected page changed. Try again.');
      const response=await api.summarize(saved.vault_id,saved.id,saved.revision);
      if(active.current)setResult(response);
    }catch(error){if(active.current)setError(error instanceof Error?error.message:'Summary failed.');}finally{if(active.current)setBusy(false);}
  }
  return <aside className="entity-panel intelligence-panel" id="intelligence-panel" aria-label="AI intelligence" onKeyDown={event=>{if(event.key==='Escape')onClose();}}>
    <div className="panel-top"><span>INTELLIGENCE</span><button ref={close} aria-label="Close AI sidebar" onClick={onClose}>×</button></div>
    <div className="panel-body"><h2>Page summary</h2><p className="section-hint">{page.title||'Untitled'}</p>
      <p className="section-hint">Send this page’s title, text, and mentioned entity names to OpenAI to create a summary. Attached sources and other pages are excluded. API charges may apply.</p>
      <button className="button primary" disabled={busy} onClick={()=>void summarize()}>{busy?'Summarizing…':'Send page & summarize'}</button>
      <button className="button small" onClick={onSettings}>Intelligence settings</button>
      {busy&&<p role="status">Saving this page and requesting a summary…</p>}
      {error&&<p role="alert" className="inline-error">{error}</p>}
      {result&&<section className="ai-result" aria-label="Page summary"><small>{result.model} · {result.reasoningEffort} reasoning · {result.revision!==page.revision?'Page changed since this summary':'Current saved version'}</small><div className="ai-summary">{result.summary}</div><p className="section-hint">AI can make mistakes. Check the original page. This summary is temporary and is not saved.</p></section>}
    </div>
  </aside>;
}
