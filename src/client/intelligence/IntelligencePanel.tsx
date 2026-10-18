import {PageMetadata} from './PageMetadata';
import {PageConceptCategory} from './PageConceptCategory';
import {NoteConnections} from './NoteConnections';
import { SummaryText } from './SummaryText';
import { HelpMenu } from '../components/HelpMenu';
import { EntityScanReview } from './EntityScanReview';
import type { EntityScan, EntitySuggestionEdit } from '../../shared/entity-scan';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { api } from '../api';
import { ConnectedEntities } from './ConnectedEntities';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import type { CreateEntityRequest } from '../knowledge/CreateEntityDialog';
import { Mention } from '../components/Mention';
import type { AIEnrichment, AISummary, Entity, Page, PageSummary } from '../../shared/domain';
interface KnowledgeSnapshot { summary:AISummary|null; scan:EntityScan|null }
function KnowledgePage({inactive=false,initialItems,initialError,snapshot,onSnapshot,page,pages,onOpenPage,entities,onOpenEntity,onSourcesChange,onCreateEntity,onClose,onSettings,onFlush,onReview}:{inactive?:boolean;initialItems:AIEnrichment[];initialError:string;snapshot?:KnowledgeSnapshot;onSnapshot:(snapshot:KnowledgeSnapshot)=>void;page:Page;pages:PageSummary[];onOpenPage:(id:string)=>void;entities:Entity[];onOpenEntity:(id:string)=>void;onSourcesChange:(sourceIds:string[])=>void;onCreateEntity:(request:CreateEntityRequest)=>void;onClose:()=>void;onSettings:()=>void;onFlush:()=>Promise<Page|null>;onReview:(scanId:string,id:string|string[],decision:'accepted'|'rejected',edits?:EntitySuggestionEdit[])=>Promise<EntityScan>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(initialError),[result,setResult]=useState<AISummary|null>(()=>{
    if(snapshot)return snapshot.summary;
    const saved=initialItems.find(item=>item.kind==='summary');
    return saved && typeof saved.data.summary==='string' ? {summary:saved.data.summary,revision:saved.revision,contentHash:saved.contentHash,model:saved.model,reasoningEffort:saved.reasoningEffort} : null;
  });
  const [deleting, setDeleting] = useState(false);
  const [scan,setScan] = useState<EntityScan|null>(()=>snapshot?snapshot.scan:initialItems.find(item=>item.kind==='entity_scan')?.data.scan as unknown as EntityScan ?? null);
  useLayoutEffect(()=>{onSnapshot({summary:result,scan});},[result,scan]);
  const loading = false;
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [summaryOverflow, setSummaryOverflow] = useState(false);
  const summaryText = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = summaryText.current;
    if (!element) return;
    const measure = () => setSummaryOverflow(element.scrollHeight > parseFloat(getComputedStyle(element).lineHeight) * 3 + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [result]);
  const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
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
  const summaryChanged = !!result && (!result.contentHash || result.contentHash !== page.summaryContentHash);
  return <aside inert={inactive} aria-busy={inactive} className="entity-panel intelligence-panel" id="intelligence-panel" aria-label="Knowledge" onKeyDown={event=>{if(event.key==='Escape')onClose();}}>
    <div className="panel-top knowledge-panel-top"><span><Icon name="knowledge"/>Knowledge</span><div className="knowledge-panel-actions"><button className="page-tool" aria-label="Knowledge settings" title="Knowledge settings" onClick={onSettings}><Icon name="settings"/></button><button className="page-tool" aria-label="Close Knowledge panel" title="Close Knowledge panel" onClick={onClose}>×</button></div></div>
    <div className="panel-body">
      <PageConceptCategory page={page}/>
      <section className="knowledge-summary" aria-labelledby="knowledge-summary-heading">
        <div className="knowledge-section-heading"><h2 id="knowledge-summary-heading">{result?<><Icon name="sparkles"/>AI Summary</>:<button type="button" className="summary-heading-action" disabled={busy||loading} aria-busy={busy} onClick={()=>void summarize()}><Icon name="sparkles"/>{loading?'Loading summary…':busy?'Summarizing…':'Summarize this page'}</button>}</h2><HelpMenu label="About AI summaries"><p>Summarizing sends this page’s title, text, and mentioned entity names to OpenAI. Attached sources and other pages are excluded. API charges may apply.</p><p>AI can make mistakes. Check the original page. Summaries are saved with this page.</p>{result&&<p>{result.model} · {result.reasoningEffort} reasoning</p>}</HelpMenu></div>
        {busy&&<p className="section-hint summary-progress" role="status">Creating your summary…</p>}
        {error&&<p role="alert" className="inline-error">{error}</p>}
        {result&&<section className="ai-result" aria-label="Page summary"><div id="knowledge-summary-text" ref={summaryText} className={'ai-summary' + (summaryExpanded ? '' : ' is-collapsed')}><SummaryText text={result.summary}/></div><div className="summary-actions">{summaryOverflow&&<button type="button" className="summary-toggle" aria-expanded={summaryExpanded} aria-controls="knowledge-summary-text" onClick={()=>setSummaryExpanded(value=>!value)}>{summaryExpanded?'Show less':'Show more'}</button>}{summaryChanged&&<button type="button" className="summary-toggle" disabled={busy||deleting||loading} onClick={()=>void summarize()}>{busy?'Refreshing…':'Refresh'}</button>}<button type="button" className="summary-toggle summary-delete" disabled={busy||deleting||loading} onClick={()=>void deleteSummary()}>{deleting?'Deleting…':'Delete summary'}</button></div>{summaryChanged&&<p className="section-hint">Page changed since this summary.</p>}</section>}
      </section>
      <ConnectedEntities page={page} entities={entities} onOpenEntity={onOpenEntity}>
        <EntityScanReview entities={entities} page={page} scan={scan} onScan={setScan} onFlush={onFlush} onReview={onReview} disabled={!!page.editLocked||busy||deleting||loading}/>
      </ConnectedEntities>
    <NoteConnections key={page.vault_id+'/'+page.id} page={page} pages={pages} onOpenPage={onOpenPage} inactive={inactive}/>
    <section className="knowledge-sources" aria-labelledby="knowledge-sources-heading"><div className="knowledge-section-heading"><h2 id="knowledge-sources-heading">Sources</h2><span className="knowledge-count">{page.sourceIds.length}</span></div><div className="toolbar-source-list">{page.sourceIds.map(id => <div key={id} className="page-source"><Mention id={id} entities={entities} onOpen={onOpenEntity}/><button disabled={!!page.editLocked} aria-label={'Remove source from page: ' + (entities.find(entity => entity.id === id)?.name || id)} onClick={() => onSourcesChange(page.sourceIds.filter(source => source !== id))}>×</button></div>)}</div>{!page.sourceIds.length && <p className="empty-small">No sources attached yet.</p>}<div className="toolbar-source-actions"><Select disabled={!!page.editLocked} aria-label="Attach existing source" value="" onChange={event => { if (event.target.value) onSourcesChange([...new Set([...page.sourceIds, event.target.value])]); }}><option value="">Add a source…</option>{entities.filter(entity => entity.type === 'source' && !entity.inactive && !page.sourceIds.includes(entity.id)).map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</Select><button className="button small" disabled={!!page.editLocked} onClick={() => onCreateEntity({source: true})}>+ New source</button></div></section>
      <PageMetadata page={page}/>
    </div>
  </aside>;
}

// Keep the displayed knowledge intact while the next page's saved data is fetched.
// Page-local state is reset only when that complete result is ready to display.
export function IntelligencePanel(props: Omit<ComponentProps<typeof KnowledgePage>, 'initialItems' | 'initialError' | 'snapshot' | 'onSnapshot'>) {
  type Entry={page:Page;items:AIEnrichment[];error:string;snapshot?:KnowledgeSnapshot};
  const cache=useRef(new Map<string,Entry>());
  const [ready,setReady]=useState<Entry|null>(null);
  const key=props.page.vault_id+'/'+props.page.id;
  const displayed=cache.current.get(key)??ready;
  const focused=useRef(false);
  useEffect(()=>{
    if(cache.current.has(key))return;
    let cancelled=false;
    void api.enrichments(props.page.vault_id,props.page.id).then(items=>{
      if(!cancelled){const entry={page:props.page,items,error:''};cache.current.set(key,entry);setReady(entry);}
    }).catch(error=>{
      if(!cancelled)setReady({page:props.page,items:[],error:error instanceof Error?error.message:'Could not load saved knowledge.'});
    });
    return()=>{cancelled=true;};
  },[props.page.vault_id,props.page.id]);
  useEffect(()=>{
    if(ready&&!focused.current){focused.current=true;document.querySelector<HTMLButtonElement>('#intelligence-panel [aria-label="Close Knowledge panel"]')?.focus({preventScroll:true});}
  },[ready]);
  if(!displayed)return <aside className="entity-panel intelligence-panel" id="intelligence-panel" aria-label="Knowledge" aria-busy="true"><div className="panel-top knowledge-panel-top"><span><Icon name="knowledge"/>Knowledge</span><div className="knowledge-panel-actions"><button className="page-tool" aria-label="Close Knowledge panel" onClick={props.onClose}>×</button></div></div><div className="panel-body"><span className="sr-only" role="status">Loading knowledge…</span></div></aside>;
  const current=displayed.page.id===props.page.id&&displayed.page.vault_id===props.page.vault_id;
  return <KnowledgePage {...props} key={displayed.page.vault_id+'/'+displayed.page.id} page={current?props.page:displayed.page} initialItems={displayed.items} initialError={displayed.error} snapshot={displayed.snapshot} onSnapshot={snapshot=>{displayed.snapshot=snapshot;}} inactive={props.inactive||!current}/>;
}
