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
    <div className="knowledge-section-heading"><h2>Subjects</h2><span className="domain-status">{status}</span>{onRefresh&&domains?.origin!=='manual'&&!editing&&<button type="button" className="summary-toggle" disabled={busy||!!page.editLocked} onClick={()=>void refresh()}>{busy?'Refreshing…':'Refresh subjects'}</button>}{onDomainsChange && !editing && <button type="button" className="summary-toggle" disabled={!!page.editLocked} onClick={() => {setPrimary(domains?.primaryDomainId ? [domains.primaryDomainId] : []);setSecondary(domains?.secondaryDomainIds ?? []);setError('');setEditing(true);}}>Edit</button>}</div>
    {editing ? <div className="page-domain-editor">
      <DomainPicker label="Primary subject" value={primary} max={1} onChange={value => {setPrimary(value);setSecondary(current => current.filter(id => id !== value[0]));}} disabled={busy}/>
      <DomainPicker label="Secondary subjects" value={secondary} max={2} onChange={value => setSecondary(value.filter(id => id !== primary[0]))} disabled={busy}/>
      <p className="section-hint">Manual subjects stay selected when this page changes. Leave subjects empty for an unclassified page.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="page-domain-actions"><button type="button" className="button small" disabled={busy} onClick={() => setEditing(false)}>Cancel</button><button type="button" className="button small primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save subjects'}</button></div>
    </div> : <div className="page-domain-summary">{domains?.primaryDomainId && <p>{domainBreadcrumb(domains.primaryDomainId)}</p>}{domains?.secondaryDomainIds.map(id => <p className="section-hint" key={id}>{domainBreadcrumb(id)}</p>)}{!domains?.primaryDomainId && !domains?.secondaryDomainIds.length && <p className="section-hint">No subjects selected.</p>}{status === 'Needs refresh' && <p className="section-hint">The page’s subject may have changed. Refresh to reassess it.</p>}{domains?.origin==='manual'&&<p className="section-hint">Your selected subjects are protected from automatic changes.</p>}{domains?.lastClassifiedAt&&<p className="section-hint">Last inferred {new Date(domains.lastClassifiedAt).toLocaleString()}.</p>}{error&&!editing&&<p className="inline-error" role="alert">{error}</p>}</div>}
  </section>;
}
