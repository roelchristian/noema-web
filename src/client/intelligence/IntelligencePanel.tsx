import {t as uiText} from '../i18n';
import {PageSources} from './PageSources';
import {PageMetadata} from './PageMetadata';
import {PageConceptCategory} from './PageConceptCategory';
import {NoteConnections} from './NoteConnections';
import {RelatedNotes} from './RelatedNotes';
import { SummaryText } from './SummaryText';
import { EntityScanReview } from './EntityScanReview';
import type { EntityScan, EntitySuggestionEdit } from '../../shared/entity-scan';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { api } from '../api';
import { ConnectedEntities } from './ConnectedEntities';
import { Icon } from '../components/Icon';
import type { CreateEntityRequest } from '../knowledge/CreateEntityDialog';
import type { AIEnrichment, AISummary, Entity, Page, PageSummary } from '../../shared/domain';
interface KnowledgeSnapshot { summary:AISummary|null; scan:EntityScan|null }
function KnowledgePage({inactive=false,initialItems,initialError,snapshot,onSnapshot,page,pages,onOpenPage,entities,onOpenEntity,onSourcesChange,onCreateEntity,onClose,onSettings,onFlush,onReview,onDomainsChange}:{onDomainsChange?:(primary:string|null,secondary:string[])=>Promise<void>;inactive?:boolean;initialItems:AIEnrichment[];initialError:string;snapshot?:KnowledgeSnapshot;onSnapshot:(snapshot:KnowledgeSnapshot)=>void;page:Page;pages:PageSummary[];onOpenPage:(id:string)=>void;entities:Entity[];onOpenEntity:(id:string)=>void;onSourcesChange:(sourceIds:string[])=>void;onCreateEntity:(request:CreateEntityRequest)=>void;onClose:()=>void;onSettings:()=>void;onFlush:()=>Promise<Page|null>;onReview:(scanId:string,id:string|string[],decision:'accepted'|'rejected',edits?:EntitySuggestionEdit[])=>Promise<EntityScan>}) {
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
    const measure = () => setSummaryOverflow(element.scrollHeight > parseFloat(getComputedStyle(element).lineHeight) * 5 + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [result]);
  const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function refreshDomains() {
    const saved=await onFlush();
    if(!saved||saved.id!==page.id||saved.vault_id!==page.vault_id)throw new Error('The selected page changed. Try again.');
    const response=await api.generateEnrichment(saved.vault_id,saved.id,saved.revision,['domains']);
    return response.pageDomains;
  }
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
  return <aside inert={inactive} aria-busy={inactive} className="entity-panel intelligence-panel" id="intelligence-panel" aria-label={uiText("Knowledge")} onKeyDown={event=>{if(event.key==='Escape')onClose();}}>
    <div className="panel-top knowledge-panel-top"><span><Icon name="knowledge"/>{uiText("Knowledge")}</span><div className="knowledge-panel-actions"><button className="page-tool" aria-label={uiText("Knowledge settings")} title={uiText("Knowledge settings")} onClick={onSettings}><Icon name="settings"/></button><button className="page-tool" data-close-knowledge aria-label={uiText("Close Knowledge panel")} title={uiText("Close Knowledge panel")} onClick={onClose}><Icon name="close"/></button></div></div>
    <div className="panel-body">
      <PageConceptCategory page={page} onDomainsChange={onDomainsChange} onRefresh={refreshDomains}/>
      <section className="knowledge-summary" aria-labelledby="knowledge-summary-heading">
        <div className="knowledge-section-heading">
          <h2 id="knowledge-summary-heading"><Icon name="sparkles"/>{uiText("Summary")}{summaryChanged&&<span className="knowledge-status-dot" role="status" aria-label={uiText("Summary needs refresh")} title={uiText("Summary needs refresh")}/>}</h2>
          <div className="knowledge-section-actions">
            {result&&summaryOverflow&&<button type="button" className="knowledge-icon-action" aria-label={summaryExpanded?uiText("Collapse summary"):uiText("Expand summary")} title={summaryExpanded?uiText("Collapse summary"):uiText("Expand summary")} aria-expanded={summaryExpanded} aria-controls="knowledge-summary-text" onClick={()=>setSummaryExpanded(value=>!value)}><Icon name={summaryExpanded?'collapse':'expand'}/></button>}
            <button type="button" className={'knowledge-icon-action'+(busy?' is-working':'')} disabled={busy||deleting||loading} aria-busy={busy} aria-label={result?uiText("Refresh summary"):uiText("Summarize this page")} title={result?uiText("Refresh summary"):uiText("Generate summary")} onClick={()=>void summarize()}><Icon name={busy||result?'refresh':'plus'}/></button>
            {result&&<button type="button" className="knowledge-icon-action is-destructive" disabled={busy||deleting||loading} aria-label={uiText("Delete summary")} title={uiText("Delete summary")} onClick={()=>void deleteSummary()}><Icon name="trash"/></button>}
          </div>
        </div>
        {busy&&<span className="sr-only" role="status">{uiText("Creating your summary…")}</span>}
        {error&&<p role="alert" className="inline-error">{error}</p>}
        {result&&<section className="ai-result" aria-label={uiText("Page summary")}><div id="knowledge-summary-text" ref={summaryText} className={'ai-summary' + (summaryExpanded ? '' : ' is-collapsed')}><SummaryText text={result.summary}/></div></section>}

      </section>
      <ConnectedEntities page={page} entities={entities} onOpenEntity={onOpenEntity}>
        <EntityScanReview entities={entities} page={page} scan={scan} onScan={setScan} onFlush={onFlush} onReview={onReview} disabled={!!page.editLocked||busy||deleting||loading}/>
      </ConnectedEntities>
    <NoteConnections key={page.vault_id+'/'+page.id} page={page} pages={pages} onOpenPage={onOpenPage} inactive={inactive}/>
    <RelatedNotes key={page.vault_id+'/'+page.id} page={page} onOpenPage={onOpenPage} inactive={inactive}/>
    <PageSources key={page.vault_id+'/'+page.id} page={page} entities={entities} onOpenEntity={onOpenEntity} onSourcesChange={onSourcesChange} onCreateSource={()=>onCreateEntity({source:true})}/>
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
    if(ready&&!focused.current){focused.current=true;document.querySelector<HTMLButtonElement>('#intelligence-panel [data-close-knowledge]')?.focus({preventScroll:true});}
  },[ready]);
  if(!displayed)return <aside className="entity-panel intelligence-panel" id="intelligence-panel" aria-label={uiText("Knowledge")} aria-busy="true"><div className="panel-top knowledge-panel-top"><span><Icon name="knowledge"/>{uiText("Knowledge")}</span><div className="knowledge-panel-actions"><button className="page-tool" data-close-knowledge aria-label={uiText("Close Knowledge panel")} onClick={props.onClose}><Icon name="close"/></button></div></div><div className="panel-body"><span className="sr-only" role="status">{uiText("Loading knowledge…")}</span></div></aside>;
  const current=displayed.page.id===props.page.id&&displayed.page.vault_id===props.page.vault_id;
  return <KnowledgePage {...props} key={displayed.page.vault_id+'/'+displayed.page.id} page={current?props.page:displayed.page} initialItems={displayed.items} initialError={displayed.error} snapshot={displayed.snapshot} onSnapshot={snapshot=>{displayed.snapshot=snapshot;}} inactive={props.inactive||!current}/>;
}
