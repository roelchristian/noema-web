import {useState} from 'react';
import {TAXONOMY_VERSION} from '../../shared/domains';
import type {Page} from '../../shared/domain';
import {DomainPicker, domainBreadcrumb} from '../knowledge/DomainPicker';

export function PageConceptCategory({page, onDomainsChange}: {page: Page; onDomainsChange?: (primary: string | null, secondary: string[]) => Promise<void>}) {
  const [editing, setEditing] = useState(false), [primary, setPrimary] = useState<string[]>([]), [secondary, setSecondary] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const domains = page.pageDomains;
  const staleInference = domains?.origin === 'inferred' && !!(domains.primaryDomainId || domains.secondaryDomainIds.length) && (!page.conceptContentHash || domains.contentHash !== page.conceptContentHash || domains.taxonomyVersion !== TAXONOMY_VERSION);
  const status = staleInference ? 'Needs refresh' : domains?.status === 'needs_refresh' ? 'Needs refresh' : domains?.status === 'manual' ? 'Manual' : domains?.status === 'inferred' ? 'Inferred' : 'Unclassified';
  async function save() {
    setBusy(true);setError('');
    try {await onDomainsChange?.(primary[0] ?? null, secondary.filter(id => id !== primary[0]));setEditing(false);}
    catch (error) {setError(error instanceof Error ? error.message : 'Could not save subjects.');}
    finally {setBusy(false);}
  }
  return <section className="knowledge-concept-category" aria-label="Page subjects">
    <div className="knowledge-section-heading"><h2>Subjects</h2><span className="domain-status">{status}</span>{onDomainsChange && !editing && <button type="button" className="summary-toggle" disabled={!!page.editLocked} onClick={() => {setPrimary(domains?.primaryDomainId ? [domains.primaryDomainId] : []);setSecondary(domains?.secondaryDomainIds ?? []);setError('');setEditing(true);}}>Edit</button>}</div>
    {editing ? <div className="page-domain-editor">
      <DomainPicker label="Primary subject" value={primary} max={1} onChange={value => {setPrimary(value);setSecondary(current => current.filter(id => id !== value[0]));}} disabled={busy}/>
      <DomainPicker label="Secondary subjects" value={secondary} max={2} onChange={value => setSecondary(value.filter(id => id !== primary[0]))} disabled={busy}/>
      <p className="section-hint">Manual subjects stay selected when this page changes. Leave subjects empty for an unclassified page.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="page-domain-actions"><button type="button" className="button small" disabled={busy} onClick={() => setEditing(false)}>Cancel</button><button type="button" className="button small primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save subjects'}</button></div>
    </div> : <div className="page-domain-summary">{domains?.primaryDomainId && <p>{domainBreadcrumb(domains.primaryDomainId)}</p>}{domains?.secondaryDomainIds.map(id => <p className="section-hint" key={id}>{domainBreadcrumb(id)}</p>)}{!domains?.primaryDomainId && !domains?.secondaryDomainIds.length && <p className="section-hint">No subjects selected.</p>}{status === 'Needs refresh' && <p className="section-hint">Page changed since subjects were inferred.</p>}</div>}
  </section>;
}
