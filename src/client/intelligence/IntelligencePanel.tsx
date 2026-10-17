import { HelpMenu } from '../components/HelpMenu';
import { EntityScanReview } from './EntityScanReview';
import type { EntityScan, EntitySuggestionEdit } from '../../shared/entity-scan';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ConnectedEntities } from './ConnectedEntities';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import type { CreateEntityRequest } from '../knowledge/CreateEntityDialog';
import { Mention } from '../components/Mention';
import type { AISummary, Entity, Page } from '../../shared/domain';
export function IntelligencePanel({page,entities,onOpenEntity,onSourcesChange,onCreateEntity,onClose,onSettings,onFlush,onReview}:{page:Page;entities:Entity[];onOpenEntity:(id:string)=>void;onSourcesChange:(sourceIds:string[])=>void;onCreateEntity:(request:CreateEntityRequest)=>void;onClose:()=>void;onSettings:()=>void;onFlush:()=>Promise<Page|null>;onReview:(scanId:string,id:string|string[],decision:'accepted'|'rejected',edits?:EntitySuggestionEdit[])=>Promise<EntityScan>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<AISummary|null>(null);
  const [deleting, setDeleting] = useState(false);
  const [scan,setScan] = useState<EntityScan|null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [summaryOverflow, setSummaryOverflow] = useState(false);
  const summaryText = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = summaryText.current;
    if (!element) return;
    const measure = () => setSummaryOverflow(element.scrollHeight > parseFloat(getComputedStyle(element).lineHeight) * 3 + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [result]);
  const active=useRef(true),close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{active.current=true;close.current?.focus();return()=>{active.current=false;};},[]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.enrichments(page.vault_id, page.id).then(items => {
      if (cancelled) return;
      const scanResult = items.find(item => item.kind === 'entity_scan');
      if (scanResult) setScan(scanResult.data.scan as unknown as EntityScan);
      const saved = items.find(item => item.kind === 'summary');
      if (saved && typeof saved.data.summary === 'string') setResult({summary: saved.data.summary, revision: saved.revision, model: saved.model, reasoningEffort: saved.reasoningEffort});
    }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : 'Could not load saved knowledge.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page.vault_id, page.id]);
  async function summarize() {
    setBusy(true);setError('');
    try {
      const saved=await onFlush();
      if(!active.current)return;
      if(!saved||saved.id!==page.id||saved.vault_id!==page.vault_id)throw new Error('The selected page changed. Try again.');
      const response=await api.summarize(saved.vault_id,saved.id,saved.revision);
      if(active.current){setResult(response);setSummaryExpanded(false);}
    }catch(error){if(active.current)setError(error instanceof Error?error.message:'Summary failed.');}finally{if(active.current)setBusy(false);}
  }
  async function deleteSummary() {
    setDeleting(true);setError('');
    try {
      await api.deleteSummary(page.vault_id, page.id);
      if(active.current){setResult(null);setSummaryExpanded(false);setSummaryOverflow(false);}
    }catch(error){if(active.current)setError(error instanceof Error?error.message:'Could not delete summary.');}
    finally{if(active.current)setDeleting(false);}
  }
  return <aside className="entity-panel intelligence-panel" id="intelligence-panel" aria-label="Knowledge" onKeyDown={event=>{if(event.key==='Escape')onClose();}}>
    <div className="panel-top knowledge-panel-top"><span><Icon name="knowledge"/>Knowledge</span><div className="knowledge-panel-actions"><button className="page-tool" aria-label="Knowledge settings" title="Knowledge settings" onClick={onSettings}><Icon name="settings"/></button><button className="page-tool" ref={close} aria-label="Close Knowledge panel" title="Close Knowledge panel" onClick={onClose}>×</button></div></div>
    <div className="panel-body">
      <section className="knowledge-summary" aria-labelledby="knowledge-summary-heading">
        <div className="knowledge-section-heading"><h2 id="knowledge-summary-heading">{result?<><Icon name="sparkles"/>AI Summary</>:<button type="button" className="summary-heading-action" disabled={busy||loading} aria-busy={busy} onClick={()=>void summarize()}><Icon name="sparkles"/>{loading?'Loading summary…':busy?'Summarizing…':'Summarize this page'}</button>}</h2><HelpMenu label="About AI summaries"><p>Summarizing sends this page’s title, text, and mentioned entity names to OpenAI. Attached sources and other pages are excluded. API charges may apply.</p><p>AI can make mistakes. Check the original page. Summaries are saved with this page.</p>{result&&<p>{result.model} · {result.reasoningEffort} reasoning</p>}</HelpMenu></div>
        {busy&&<p className="section-hint summary-progress" role="status">Creating your summary…</p>}
        {error&&<p role="alert" className="inline-error">{error}</p>}
        {result&&<section className="ai-result" aria-label="Page summary"><div id="knowledge-summary-text" ref={summaryText} className={'ai-summary' + (summaryExpanded ? '' : ' is-collapsed')}>{result.summary}</div><div className="summary-actions">{summaryOverflow&&<button type="button" className="summary-toggle" aria-expanded={summaryExpanded} aria-controls="knowledge-summary-text" onClick={()=>setSummaryExpanded(value=>!value)}>{summaryExpanded?'Show less':'Show more'}</button>}<button type="button" className="summary-toggle" disabled={busy||deleting||loading} onClick={()=>void summarize()}>{busy?'Refreshing…':'Refresh'}</button><button type="button" className="summary-toggle summary-delete" disabled={busy||deleting||loading} onClick={()=>void deleteSummary()}>{deleting?'Deleting…':'Delete summary'}</button></div>{result.revision!==page.revision&&<p className="section-hint">Page changed since this summary.</p>}</section>}
      </section>
      <ConnectedEntities page={page} entities={entities} onOpenEntity={onOpenEntity}>
        <EntityScanReview entities={entities} page={page} scan={scan} onScan={setScan} onFlush={onFlush} onReview={onReview} disabled={busy||deleting||loading}/>
      </ConnectedEntities>
    <section className="knowledge-sources" aria-labelledby="knowledge-sources-heading"><div className="knowledge-section-heading"><h2 id="knowledge-sources-heading">Sources</h2><span className="knowledge-count">{page.sourceIds.length}</span></div><div className="toolbar-source-list">{page.sourceIds.map(id => <div key={id} className="page-source"><Mention id={id} entities={entities} onOpen={onOpenEntity}/><button aria-label={'Remove source from page: ' + (entities.find(entity => entity.id === id)?.name || id)} onClick={() => onSourcesChange(page.sourceIds.filter(source => source !== id))}>×</button></div>)}</div>{!page.sourceIds.length && <p className="empty-small">No sources attached yet.</p>}<div className="toolbar-source-actions"><Select aria-label="Attach existing source" value="" onChange={event => { if (event.target.value) onSourcesChange([...new Set([...page.sourceIds, event.target.value])]); }}><option value="">Add a source…</option>{entities.filter(entity => entity.type === 'source' && !page.sourceIds.includes(entity.id)).map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</Select><button className="button small" onClick={() => onCreateEntity({source: true})}>+ New source</button></div></section>
    </div>
  </aside>;
}
