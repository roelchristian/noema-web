import {memo, useEffect, useRef, useState} from 'react';
import type {Entity, Organization, PagePreview, PageSummary} from '../../shared/domain';
import {api} from '../api';
import {TitleText} from '../components/TitleText';
import {Modal, ModalHeader} from '../components/Modal';
import {Select} from '../components/Select';
import {ReadOnlyPageBlocks} from '../editor/ReadOnlyPageBlocks';

const PreviewBlocks=memo(ReadOnlyPageBlocks);

export function InboxIndicators({page}:{page:PageSummary}) {
  return <span className="inbox-indicators">
    {(!page.title.trim() || page.title.trim().toLowerCase() === 'untitled') && <span>Untitled</span>}
    {page.isReadingNote === true && <span>Reading note</span>}
    {page.hasEntityAssociations === false && <span title="No explicit page associations with knowledge entities. Inline mentions are separate.">No associated entities</span>}
  </span>;
}

export function InboxTriage({vaultId, pages, allPages, entities, data, checked, onToggle, onChanged, onOpenPage, onOpenEntity, onTrash, disabled = false, onBusyChange, onSelectAll, onRefresh}: {
  vaultId:string; pages:PageSummary[]; allPages:PageSummary[]; entities:Entity[]; data:Organization;
  checked:Set<string>; onToggle:(id:string)=>void; onChanged:(data:Organization)=>void;
  onOpenPage:(id:string)=>void; onOpenEntity:(id:string)=>void; onTrash:(page:PageSummary)=>void; disabled?:boolean; onBusyChange:(busy:boolean)=>void; onSelectAll:(ids:string[])=>void; onRefresh?:()=>Promise<void>;
}) {
  const [kept,setKept]=useState<Set<string>>(()=>new Set());
  const [selected,setSelected]=useState<string|null>(null);
  const position=useRef(0);
  const queue=pages.filter(page=>!kept.has(page.id));
  const active=queue.find(page=>page.id===selected) ?? queue[Math.min(position.current,Math.max(0,queue.length-1))];
  const index=active?queue.findIndex(page=>page.id===active.id):-1;
  const [mobileDetail,setMobileDetail]=useState(false);
  const [preview,setPreview]=useState<{key:string;page?:PagePreview;error?:string}|null>(null);
  const [retry,setRetry]=useState(0);
  const [picker,setPicker]=useState<'folder'|'collection'|null>(null);
  const [target,setTarget]=useState('');
  const [pending,setPending]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('');
  const lock=useRef(false), detail=useRef<HTMLElement>(null);
  const busy=pending||disabled;
  async function refresh() {
    if(lock.current||!onRefresh)return;
    lock.current=true;setPending(true);onBusyChange(true);setError('');
    try {await onRefresh();setRetry(value=>value+1);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally {lock.current=false;setPending(false);onBusyChange(false);}
  }
  const previewKey=active?JSON.stringify([vaultId,active.id,active.updated_at,retry]):'';
  useEffect(()=>{position.current=Math.max(0,index);},[index]);
  useEffect(()=>{setSelected(active?.id??null);setPicker(null);setError('');},[active?.id]);
  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();setPreview({key:previewKey});
    void api.pagePreview(vaultId,active.id,controller.signal).then(page=>{
      if(!controller.signal.aborted)setPreview({key:previewKey,page});
    }).catch(reason=>{if(!controller.signal.aborted)setPreview({key:previewKey,error:reason instanceof Error?reason.message:String(reason)});});
    return()=>controller.abort();
  },[previewKey]);
  function choose(id:string,show=true) {
    if(busy||picker)return;
    position.current=queue.findIndex(page=>page.id===id);setSelected(id);setMobileDetail(show);setError('');
    if(show)requestAnimationFrame(()=>detail.current?.focus());
  }
  function keep() {
    if(!active||busy||picker)return;
    position.current=index;setKept(previous=>new Set([...previous,active.id]));setSelected(null);
    setNotice('Kept in Inbox for this session.');
  }
  async function save() {
    if(!active||!picker||!target||lock.current)return;
    const pageId=active.id, mode=picker, destination=target;
    lock.current=true;setPending(true);onBusyChange(true);setError('');
    try {
      // Recheck location before filing: another tab may already have filed this page.
      const current=await api.organization(vaultId);
      if(mode==='collection'&&current.memberships.some(member=>member.kind==='page'&&member.item_id===pageId&&member.collection_id===destination)) {
        onChanged(current);setPicker(null);setNotice('Already in this collection. Still in Inbox.');return;
      }
      if(mode==='folder'&&current.locations.some(location=>location.kind==='page'&&location.item_id===pageId&&location.folder_id)) {
        onChanged(current);throw new Error('This page was already filed elsewhere. The queue has been refreshed.');
      }
      const updated=await api.organize(vaultId,mode==='folder'?'locations':'memberships',{
        kind:'page',item_id:pageId,...(mode==='folder'?{folder_id:destination,expected_folder_id:null}:{collection_id:destination}),
      });
      position.current=index;onChanged(updated);setPicker(null);
      setNotice(mode==='folder'?'Filed in folder.':'Added to collection. Still in Inbox.');
    } catch(reason) {setError(reason instanceof Error?reason.message:String(reason));}
    finally {lock.current=false;setPending(false);onBusyChange(false);}
  }
  const currentPreview=preview?.key===previewKey?preview:undefined;
  return <div className={'inbox-triage'+(mobileDetail?' is-detail':'')} aria-busy={pending}>
    <div className="inbox-queue" role="group" aria-label="Inbox queue">
      <div className="inbox-navigation"><button className="button" disabled={busy||!!picker||!queue.length} onClick={()=>onSelectAll(queue.map(page=>page.id))}>Select all visible pages</button>{onRefresh&&<button className="button" disabled={busy||!!picker} onClick={()=>void refresh()}>Refresh</button>}</div><p className="inbox-session" role="status">{queue.length} to review · {pages.length-queue.length} kept this session</p>
      {queue.map(page=><div key={page.id} className={'inbox-queue-row'+(active?.id===page.id?' is-selected':'')}>
        <label><input type="checkbox" aria-label={'Select '+(page.title||'Untitled')} checked={checked.has(page.id)} disabled={busy} onChange={()=>onToggle(page.id)}/></label>
        <button type="button" disabled={busy||!!picker} aria-current={active?.id===page.id?'true':undefined} onClick={()=>choose(page.id)}><strong><TitleText text={page.title||'Untitled'}/></strong><InboxIndicators page={page}/></button>
      </div>)}
      {!queue.length&&<p role="status">{pages.length?'Session complete. Kept pages remain in Inbox.':'No pages in this view.'}</p>}
      {kept.size>0&&<button type="button" className="button" disabled={busy||!!picker} onClick={()=>{position.current=0;setSelected(null);setKept(new Set());setMobileDetail(false);}}>Review kept pages</button>}
    </div>
    <section className="inbox-detail" ref={detail} tabIndex={-1} aria-label="Selected Inbox page">
      <button type="button" className="button inbox-back" disabled={busy||!!picker} onClick={()=>{setMobileDetail(false);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.inbox-queue button[aria-current]')?.focus());}}>Back to queue</button>
      <div className="inbox-navigation" aria-label="Queue navigation"><button type="button" className="button" disabled={busy||!!picker||index<=0} onClick={()=>choose(queue[index-1]!.id)}>Previous</button><span>{active?`${index+1} of ${queue.length}`:'No page selected'}</span><button type="button" className="button" disabled={busy||!!picker||index<0||index>=queue.length-1} onClick={()=>choose(queue[index+1]!.id)}>Next</button></div>
      {active&&<><h2><TitleText text={active.title||'Untitled'}/></h2><InboxIndicators page={active}/>
        <div className="inbox-decisions" role="group" aria-label="Page decisions">
          <button className="button primary" disabled={busy||!!picker||!currentPreview?.page} onClick={()=>{setTarget('');setPicker('folder');}}>File…</button>
          <button className="button" disabled={busy||!!picker||!currentPreview?.page} onClick={()=>{setTarget('');setPicker('collection');}}>Add to collection…</button>
          <button className="button" disabled={busy||!!picker} onClick={keep}>Keep in Inbox</button>
          <button className="button is-danger" disabled={busy||!!picker||!currentPreview?.page} onClick={()=>onTrash(active)}>Trash…</button>
        </div>
        <p className="organization-hint">File moves to a folder. Collections keep this page in Inbox.</p>
        <button className="button" disabled={busy||!!picker||!currentPreview?.page} onClick={()=>onOpenPage(active.id)}>Open full editor</button>
        {(!currentPreview||!currentPreview.page&&!currentPreview.error)&&<p role="status">Loading preview…</p>}
        {currentPreview?.error&&<div role="alert"><p>{currentPreview.error}</p><button className="button" onClick={()=>setRetry(value=>value+1)}>Retry preview</button></div>}
        {currentPreview?.page&&<div className="inbox-preview"><PreviewBlocks blocks={currentPreview.page.blocks} pages={allPages} entities={entities} vaultId={vaultId} onOpenPage={onOpenPage} onOpenEntity={onOpenEntity}/>{!currentPreview.page.blocks.length&&<p>This page has no content yet.</p>}{currentPreview.page.truncated&&<p>Preview shows the first 80 blocks. Open the full editor to read the rest.</p>}</div>}
      </>}
      <p role="status" className="organization-hint">{notice}</p>{onRefresh&&currentPreview?.error&&<button className="button" disabled={busy} onClick={()=>void refresh()}>Refresh queue</button>}
      {error&&!picker&&<p role="alert">{error}</p>}
    </section>
    {picker&&active&&<Modal titleId="triage-picker-title" onClose={()=>{if(!pending)setPicker(null);}}><form onSubmit={event=>{event.preventDefault();void save();}}><ModalHeader titleId="triage-picker-title" closeDisabled={pending}>{picker==='folder'?'File in folder':'Add to collection'}</ModalHeader>
      <p>{picker==='folder'?'Moves this page out of Inbox. Collection memberships are kept.':'Adds membership without changing folder location. This page stays in Inbox.'}</p>
      <label>{picker==='folder'?'Folder':'Collection'}<Select autoFocus aria-label="Triage destination" disabled={pending} value={target} onChange={event=>setTarget(event.target.value)}><option value="">Choose a destination</option>{(picker==='folder'?data.folders:data.collections.filter(collection=>!data.memberships.some(member=>member.kind==='page'&&member.item_id===active.id&&member.collection_id===collection.id))).map(item=><option key={item.id} value={item.id}>{item.name}{'parent_id' in item&&item.parent_id?' (in '+data.folders.find(folder=>folder.id===item.parent_id)?.name+')':''}</option>)}</Select></label>
      {picker==='folder'&&!data.folders.length&&<p>Create a folder from the sidebar to file pages.</p>}
      {picker==='collection'&&!data.collections.length&&<p>Create a collection from the sidebar to add pages.</p>}
      {error&&<p role="alert" className="dialog-error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button" disabled={pending} onClick={()=>setPicker(null)}>Cancel</button><button className="button primary" disabled={pending||!target}>{pending?'Saving…':picker==='folder'?'File':'Add to collection'}</button></div>
    </form></Modal>}
  </div>;
}
