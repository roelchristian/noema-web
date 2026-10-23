import {useEffect,useMemo,useRef,useState} from 'react';
import {isPageAIStatus,pageAIStatusDescriptions} from '../../shared/page-ai-status';
import type {Entity,Page,PageSummary} from '../../shared/domain';
import type {PageVersion,PageVersionDetail} from '../../shared/page-history';
import {api} from '../api';
import {t as uiText,getLocale} from '../i18n';
import {Modal,ModalHeader} from '../components/Modal';
import {TitleText} from '../components/TitleText';
import {ReadOnlyPageBlocks} from './ReadOnlyPageBlocks';
import {historySessions,compareHistoryBlocks} from './page-history-model';
const date=(value:string)=>new Date(value).toLocaleString(getLocale());
const origins:Record<PageVersion['kind'],string>={created:'Page created',baseline:'History started',edit:'Editing',ai_acceptance:'AI content accepted',import:'Imported document',checkpoint:'Named checkpoint',restore:'Restored version'};
export function PageHistoryDrawer({page,entities,pages,saveStatus,onClose,onChange}: {
  page:Page;entities:Entity[];pages:PageSummary[];saveStatus:string;onClose:()=>void;
  onChange:(action:'restore'|'copy'|'checkpoint',value:string)=>Promise<unknown>;
}) {
  const [versions,setVersions]=useState<PageVersion[]>([]),[selected,setSelected]=useState<PageVersionDetail|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [name,setName]=useState(''),[compare,setCompare]=useState(false),[confirm,setConfirm]=useState(false);
  const mounted=useRef(true),request=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;++request.current;};},[]);
  useEffect(()=>{
    const controller=new AbortController();
    void api.pageHistory(page.vault_id,page.id,controller.signal).then(rows=>{if(!controller.signal.aborted)setVersions(rows);}).catch(reason=>{if(!controller.signal.aborted)setError(String(reason.message??reason));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[page.vault_id,page.id,page.revision]);
  const sessions=useMemo(()=>historySessions(versions),[versions]);
  const changes=useMemo(()=>selected&&compare?compareHistoryBlocks(selected.snapshot.blocks,page.blocks):[],[selected,compare,page.blocks]);
  async function select(id:string) {
    const sequence=++request.current;setLoading(true);setError('');setConfirm(false);
    try {const version=await api.pageVersion(page.vault_id,page.id,id);if(mounted.current&&sequence===request.current)setSelected(version);}
    catch(reason) {if(mounted.current&&sequence===request.current)setError(reason instanceof Error?reason.message:String(reason));}
    finally {if(mounted.current&&sequence===request.current)setLoading(false);}
  }
  async function mutate(action:'restore'|'copy'|'checkpoint',value:string) {
    setBusy(true);setError('');
    try {
      await onChange(action,value);
      if(!mounted.current)return;
      if(action==='restore'){onClose();return;}
      if(action==='copy'){setConfirm(false);setError(uiText('Created a separate page from this version.'));return;}
      setName('');setVersions(await api.pageHistory(page.vault_id,page.id));
    }catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:String(reason));}
    finally{if(mounted.current)setBusy(false);}
  }
  const readonly=(blocks:Page['blocks'])=><ReadOnlyPageBlocks blocks={blocks} entities={entities} pages={pages} vaultId={page.vault_id} onOpenEntity={()=>{}} onOpenPage={()=>{}}/>;
  return <Modal className="page-history-drawer" titleId="page-history-title" onClose={()=>{if(!busy)onClose();}}>
    <ModalHeader titleId="page-history-title" closeDisabled={busy}>{uiText('Version history')}</ModalHeader>
    <div className="page-history-workspace">
      <aside className="page-history-timeline" aria-label={uiText('Saved versions')}>
        <button type="button" className={!selected?'is-selected':''} disabled={busy} onClick={()=>{++request.current;setLoading(false);setSelected(null);setConfirm(false);}}><strong>{uiText('Current page')}</strong><small>{uiText(saveStatus==='saved'?'All changes saved':'Unfinished changes will be saved before restoring')}</small></button>
        <form onSubmit={event=>{event.preventDefault();if(name.trim())void mutate('checkpoint',name.trim());}}>
          <label htmlFor="history-checkpoint-name">{uiText('Name a checkpoint')}</label>
          <input id="history-checkpoint-name" value={name} maxLength={120} disabled={busy||!!page.editLocked} onChange={event=>setName(event.target.value)}/>
          <button type="submit" className="button" disabled={busy||!!page.editLocked||!name.trim()}>{uiText('Preserve checkpoint')}</button>
        </form>
        {!loading&&!versions.length&&<p>{uiText('History starts with the next saved change. Earlier versions have not been invented.')}</p>}
        {sessions.map(session=>{
          const first=session.versions[0]!;
          const item=(version:PageVersion)=><button type="button" key={version.id} disabled={busy} className={selected?.id===version.id?'is-selected':''} onClick={()=>void select(version.id)}><strong>{version.name||uiText(origins[version.kind])}</strong><time dateTime={version.createdAt}>{date(version.createdAt)}</time>{(version.pinned||version.kind==='restore')&&<small>{uiText('Preserved permanently')}</small>}</button>;
          return session.versions.length===1?<div key={session.id}>{item(first)}</div>:<details key={session.id} open={session.versions.some(version=>version.id===selected?.id)}><summary>{uiText('Editing session')} · {date(first.createdAt)}<small>{session.versions.length} {uiText('revisions')}</small></summary>{session.versions.map(item)}</details>;
        })}
        <p className="page-history-policy">{uiText('History is retained. Automatic retention pruning is disabled.')}</p>
      </aside>
      <section className="page-history-preview" aria-label={uiText('Read-only version preview')}>
        {error&&<p role="status" className="page-history-message">{error}</p>}
        {loading&&<p role="status">{uiText('Loading history…')}</p>}
        {selected?<>
          <header><h3><TitleText text={selected.name||selected.snapshot.title||uiText('Untitled')}/></h3><p>{date(selected.createdAt)} · {uiText(origins[selected.kind])}</p><p>{selected.snapshot.icon} {selected.snapshot.language||''} · {isPageAIStatus(selected.snapshot.aiStatus)?uiText(pageAIStatusDescriptions[selected.snapshot.aiStatus]):uiText('Unknown provenance')} · {selected.snapshot.sourceIds.length} {uiText('sources')}</p><p>{uiText('Read-only preview. Your current page remains unchanged.')}</p>
            <label><input type="checkbox" checked={compare} onChange={event=>setCompare(event.target.checked)}/>{uiText('Compare blocks with current page')}</label>
            <div className="page-history-actions"><button type="button" className="button primary" disabled={busy||!!page.editLocked||loading} onClick={()=>setConfirm(true)}>{uiText('Restore this version')}</button><button type="button" className="button" disabled={busy||!!page.editLocked||loading} onClick={()=>void mutate('copy',selected.id)}>{uiText('Create page from this version')}</button></div>
            {confirm&&<div className="page-history-confirm" role="group" aria-label={uiText('Confirm restoration')}><p>{uiText('Save pending changes and restore this version as a new current revision? All later versions and the pre-restore state remain in history. Authored classifications and original provenance are restored; unavailable references prevent restoration.')}</p><button type="button" className="button" disabled={busy} onClick={()=>setConfirm(false)}>{uiText('Cancel')}</button><button type="button" className="button primary" disabled={busy} onClick={()=>void mutate('restore',selected.id)}>{uiText(busy?'Restoring…':'Confirm restore')}</button></div>}
          </header>
          {compare?<><p>{changes.length} {uiText('changed blocks')}{selected.snapshot.title!==page.title?' · '+uiText('Title changed'):''}</p>{!changes.length&&<p>{uiText('No added, removed, or modified blocks. Metadata and block order may differ.')}</p>}{changes.map(change=><section className={'page-history-difference is-'+change.kind} key={change.id}><h4>{uiText(change.kind==='added'?'Added block':change.kind==='removed'?'Removed block':'Modified block')}</h4><div className="page-history-comparison">{change.before&&<div><h5>{uiText('Historical version')}</h5>{readonly([change.before])}</div>}{change.after&&<div><h5>{uiText('Current page')}</h5>{readonly([change.after])}</div>}</div></section>)}</>:<><h2><TitleText text={selected.snapshot.title||uiText('Untitled')}/></h2>{readonly(selected.snapshot.blocks)}</>}
        </>:<><h3>{uiText('Current page')}</h3><p>{uiText('Select a saved version to preview or compare it. Saving, editor undo, and durable history are separate.')}</p><h2><TitleText text={page.title||uiText('Untitled')}/></h2>{readonly(page.blocks)}</>}
      </section>
    </div>
  </Modal>;
}
