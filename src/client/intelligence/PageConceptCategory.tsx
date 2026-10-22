import {t as uiText} from '../i18n';
import {Icon} from '../components/Icon';
import {useEffect,useState} from 'react';
import type {Page,PageDomains} from '../../shared/domain';
import {DomainPicker, domainBreadcrumb} from '../knowledge/DomainPicker';

export function PageConceptCategory({page, onDomainsChange,onRefresh}: {page: Page;onRefresh?:()=>Promise<PageDomains>; onDomainsChange?: (primary: string | null, secondary: string[]) => Promise<void>}) {
  const [expanded,setExpanded]=useState(false);
  const [editing, setEditing] = useState(false), [primary, setPrimary] = useState<string[]>([]), [secondary, setSecondary] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [refreshed,setRefreshed]=useState<PageDomains|null>(null);
  useEffect(()=>{setRefreshed(null);},[page.id,page.revision,page.pageDomains?.revision]);
  const domains = refreshed??page.pageDomains;
  const categorizing=busy||domains?.origin!=='manual'&&!!page.enrichmentPendingFields?.includes('domains');
  const status = domains?.status === 'needs_refresh' ? 'Needs refresh' : domains?.status === 'manual' ? 'Manual' : domains?.status === 'inferred' ? 'Inferred' : 'Unclassified';
  async function refresh() {
    setBusy(true);setError('');
    try {const next=await onRefresh?.();if(next)setRefreshed(next);}
    catch(error){setError(error instanceof Error?error.message:'Could not refresh subjects.');}
    finally{setBusy(false);}
  }
  async function save() {
    setBusy(true);setError('');
    try {await onDomainsChange?.(primary[0] ?? null, secondary.filter(id => id !== primary[0]));setEditing(false);setExpanded(false);}
    catch (error) {setError(error instanceof Error ? error.message : 'Could not save subjects.');}
    finally {setBusy(false);}
  }
  const subjectIds=[...(domains?.primaryDomainId?[domains.primaryDomainId]:[]),...(domains?.secondaryDomainIds??[])];
  function edit() {
    setPrimary(domains?.primaryDomainId?[domains.primaryDomainId]:[]);setSecondary(domains?.secondaryDomainIds??[]);
    setError('');setExpanded(true);setEditing(true);
  }
  return <section className="knowledge-concept-category" aria-label={uiText("Page subjects")}>
    <div className="page-domain-summary">
      {subjectIds.length>0 ? <button type="button" className="knowledge-subject-toggle" aria-expanded={expanded||editing} aria-controls="knowledge-subject-details" disabled={busy&&editing} onClick={()=>{setExpanded(!expanded);setEditing(false);}}>
        <span className="knowledge-subject-label">{uiText("Subjects")}</span><span aria-hidden="true">·</span>
        <span className="knowledge-subject-primary" title={domainBreadcrumb(subjectIds[0])}>{domainBreadcrumb(subjectIds[0]).split(' → ').at(-1)}</span>
        {subjectIds.length>1&&<span className="knowledge-subject-count">+{subjectIds.length-1}</span>}
        {status==='Needs refresh'&&<span className="knowledge-status-dot" role="status" aria-label={uiText("Subjects need refresh")} title={uiText("Subjects need refresh")}/>}
        {domains?.origin==='manual'&&<span className="knowledge-subject-origin" title={uiText("Manually selected subjects")} aria-label={uiText("Manually selected subjects")}><Icon name="lock"/></span>}
        <Icon name="chevron"/>
      </button> : categorizing ? <span className="knowledge-empty" role="status">{uiText("Categorizing this page...")}</span> : onDomainsChange ? <button type="button" className="knowledge-empty-action" disabled={!!page.editLocked} onClick={edit}><Icon name="plus"/>{uiText("Add subjects")}</button> : <span className="knowledge-empty">{uiText("Unclassified")}</span>}
    </div>
    <div id="knowledge-subject-details" hidden={!expanded&&!editing}>
      {editing ? <div className="page-domain-editor">
        <DomainPicker label={uiText("Primary subject")} value={primary} max={1} onChange={value => {setPrimary(value);setSecondary(current => current.filter(id => id !== value[0]));}} disabled={busy}/>
        <DomainPicker label={uiText("Secondary subjects")} value={secondary} max={2} onChange={value => setSecondary(value.filter(id => id !== primary[0]))} disabled={busy}/>
        <div className="page-domain-actions"><button type="button" className="button small" disabled={busy} onClick={() => {setEditing(false);setExpanded(false);}}>{uiText("Cancel")}</button><button type="button" className="button small primary" disabled={busy} onClick={() => void save()}>{busy ? uiText("Saving…") : uiText("Save subjects")}</button></div>
      </div> : <div className="knowledge-subject-details">
        <div className="knowledge-subject-list">{subjectIds.map((id,index)=><span className={'knowledge-subject-chip'+(index===0&&domains?.primaryDomainId?' is-primary':'')} key={id} title={domainBreadcrumb(id)}>{domainBreadcrumb(id).split(' → ').at(-1)}</span>)}</div>
        <div className="knowledge-section-actions">
          {onRefresh&&domains?.origin!=='manual'&&<button type="button" className={'knowledge-icon-action'+(busy?' is-working':'')} aria-label={uiText("Refresh subjects")} title={uiText("Refresh subjects")} disabled={busy||!!page.editLocked} onClick={()=>void refresh()}><Icon name="refresh"/></button>}
          {onDomainsChange&&<button type="button" className="knowledge-icon-action" aria-label={uiText("Edit subjects")} title={uiText("Edit subjects")} disabled={!!page.editLocked} onClick={edit}><Icon name="edit"/></button>}
        </div>
      </div>}
    </div>
    {error&&<p className="inline-error" role="alert">{error}</p>}
  </section>;
}
