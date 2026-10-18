import {Icon} from '../components/Icon';
import {useEffect,useState} from 'react';
import type {Page,PageDomains} from '../../shared/domain';
import {DomainPicker, domainBreadcrumb} from '../knowledge/DomainPicker';

export function PageConceptCategory({page, onDomainsChange,onRefresh}: {page: Page;onRefresh?:()=>Promise<PageDomains>; onDomainsChange?: (primary: string | null, secondary: string[]) => Promise<void>}) {
  const [editing, setEditing] = useState(false), [primary, setPrimary] = useState<string[]>([]), [secondary, setSecondary] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [refreshed,setRefreshed]=useState<PageDomains|null>(null);
  useEffect(()=>{setRefreshed(null);},[page.id,page.revision,page.pageDomains?.revision]);
  const domains = refreshed??page.pageDomains;
  const status = domains?.status === 'needs_refresh' ? 'Needs refresh' : domains?.status === 'manual' ? 'Manual' : domains?.status === 'inferred' ? 'Inferred' : 'Unclassified';
  async function refresh() {
    setBusy(true);setError('');
    try {const next=await onRefresh?.();if(next)setRefreshed(next);}
    catch(error){setError(error instanceof Error?error.message:'Could not refresh subjects.');}
    finally{setBusy(false);}
  }
  async function save() {
    setBusy(true);setError('');
    try {await onDomainsChange?.(primary[0] ?? null, secondary.filter(id => id !== primary[0]));setEditing(false);}
    catch (error) {setError(error instanceof Error ? error.message : 'Could not save subjects.');}
    finally {setBusy(false);}
  }
  return <section className="knowledge-concept-category" aria-label="Page subjects">
    <div className="knowledge-section-heading"><h2><Icon name="semantic"/>Subjects{status==='Needs refresh'&&<span className="knowledge-status-dot" role="status" aria-label="Subjects need refresh" title="Subjects need refresh"/>}{domains?.origin==='manual'&&<span className="knowledge-subject-origin" title="Manually selected subjects" aria-label="Manually selected subjects"><Icon name="lock"/></span>}</h2><div className="knowledge-section-actions">{onRefresh&&domains?.origin!=='manual'&&!editing&&<button type="button" className={'knowledge-icon-action'+(busy?' is-working':'')} aria-label="Refresh subjects" title="Refresh subjects" disabled={busy||!!page.editLocked} onClick={()=>void refresh()}><Icon name="refresh"/></button>}{onDomainsChange&&!editing&&<button type="button" className="knowledge-icon-action" aria-label="Edit subjects" title="Edit subjects" disabled={!!page.editLocked} onClick={()=>{setPrimary(domains?.primaryDomainId?[domains.primaryDomainId]:[]);setSecondary(domains?.secondaryDomainIds??[]);setError('');setEditing(true);}}><Icon name="edit"/></button>}</div></div>
    {editing ? <div className="page-domain-editor">
      <DomainPicker label="Primary subject" value={primary} max={1} onChange={value => {setPrimary(value);setSecondary(current => current.filter(id => id !== value[0]));}} disabled={busy}/>
      <DomainPicker label="Secondary subjects" value={secondary} max={2} onChange={value => setSecondary(value.filter(id => id !== primary[0]))} disabled={busy}/>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="page-domain-actions"><button type="button" className="button small" disabled={busy} onClick={() => setEditing(false)}>Cancel</button><button type="button" className="button small primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save subjects'}</button></div>
    </div> : <div className="page-domain-summary">{[...(domains?.primaryDomainId?[domains.primaryDomainId]:[]),...(domains?.secondaryDomainIds??[])].map((id,index)=><span className={'knowledge-subject-chip'+(index===0&&domains?.primaryDomainId?' is-primary':'')} key={id} title={domainBreadcrumb(id)}>{domainBreadcrumb(id).split(' → ').at(-1)}</span>)}{!domains?.primaryDomainId&&!domains?.secondaryDomainIds.length&&<span className="knowledge-empty">Unclassified</span>}{error&&<p className="inline-error" role="alert">{error}</p>}</div>}
  </section>;
}
