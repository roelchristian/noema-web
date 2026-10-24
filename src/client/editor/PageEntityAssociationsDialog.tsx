import {useEffect, useRef, useState} from 'react';
import type {Entity, Page, PageEntityAssociation, PageSummary, PagePageAssociation} from '../../shared/domain';
import {api} from '../api';
import {t as uiText} from '../i18n';
import {Modal, ModalHeader} from '../components/Modal';
import {Icon} from '../components/Icon';
import {ConnectPicker} from '../knowledge/ConnectPicker';

type Association = PageEntityAssociation;

export function PageEntityAssociationsDialog({page, pages=[], entities, onClose, onChanged, onOpenEntity}: {
  page:Page; pages?:PageSummary[]; entities:Entity[]; onClose:()=>void; onChanged?:()=>Promise<void>; onOpenEntity?:(id:string)=>void;
}) {
  const [associations,setAssociations]=useState<Association[]>([]);
  const [pageLinks,setPageLinks]=useState<PagePageAssociation[]>([]);
  const [pageUndo,setPageUndo]=useState<{id:string;previous?:PagePageAssociation}|null>(null);
  const [loading,setLoading]=useState(true),[pending,setPending]=useState(false),[error,setError]=useState('');
  const lock=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [undo,setUndo]=useState<{entityId:string;previous?:Association}|null>(null);
  const [loadAttempt,setLoadAttempt]=useState(0),[loadFailed,setLoadFailed]=useState(false);
  useEffect(()=>{
    let active=true;
    setLoading(true);setLoadFailed(false);setError('');
    void Promise.all([api.pageEntityAssociations(page.vault_id,page.id),pages.length?api.pageAssociations(page.vault_id,page.id):Promise.resolve([])]).then(([items,links])=>{if(active){setAssociations(items);setPageLinks(links);setLoading(false);}},error=>{if(active){setLoadFailed(true);setError(error instanceof Error?error.message:uiText('Could not load entity associations.'));setLoading(false);}});
    return ()=>{active=false;};
  },[page.vault_id,page.id,loadAttempt]);
  const eligible=entities.filter(entity=>entity.vault_id===page.vault_id&&entity.type!=='source'&&!entity.archived_at&&!entity.inactive);
  async function update(entityId:string,values:{pinned?:boolean;annotation?:string},remove=false,remember=true) {
    if(lock.current)return;
    lock.current=true;setPending(true);setError('');
    const previous=associations.find(item=>item.entityId===entityId);
    try {
      if(remove)await api.removeEntityPage(page.vault_id,entityId,page.id);
      else await api.associateEntityPage(page.vault_id,entityId,page.id,values);
      if(!alive.current)return;
      setAssociations(current=>remove?current.filter(item=>item.entityId!==entityId):current.some(item=>item.entityId===entityId)?current.map(item=>item.entityId===entityId?{...item,...values}:item):[...current,{entityId,pinned:false,annotation:'',...values}]);
      if(remember){setUndo({entityId,previous});setPageUndo(null);}else setUndo(null);
      try {await onChanged?.();}
      catch {if(alive.current)setError(uiText('Association saved, but the entity list could not refresh. Reopen the entity homepage to see the latest changes.'));}
    }catch(error){if(alive.current)setError(error instanceof Error?error.message:uiText('Could not update entity associations.'));throw error;}
    finally{lock.current=false;if(alive.current)setPending(false);}
  }
  const run=(work:()=>Promise<void>)=>{void work().catch(()=>{});};
  async function updatePage(targetId:string,values:{pinned?:boolean;annotation?:string},remove=false,remember=true) {
    if(lock.current)return;lock.current=true;setPending(true);setError('');
    const previous=pageLinks.find(item=>item.id===targetId);
    try {const links=await (remove?api.removePageAssociation(page.vault_id,page.id,targetId):api.associatePages(page.vault_id,page.id,targetId,values));if(alive.current){setPageLinks(links);window.dispatchEvent(new CustomEvent('noema:page-connections-changed',{detail:{vaultId:page.vault_id,pageId:page.id}}));if(remember){setPageUndo({id:targetId,previous});setUndo(null);}else setPageUndo(null);await onChanged?.();}}
    catch(value){if(alive.current)setError(value instanceof Error?value.message:String(value));throw value;}
    finally{lock.current=false;if(alive.current)setPending(false);}
  }
  const close=()=>{if(!pending)onClose();};
  return <Modal className="page-entity-dialog" titleId="page-entity-dialog-title" onClose={close}>
    <ModalHeader titleId="page-entity-dialog-title" leading={<Icon name="knowledge"/>} closeDisabled={pending}>{uiText('Connect')}</ModalHeader>
    <p>{uiText('Connect this page to an entity without adding a mention to its text. Pin it to feature it on the entity homepage.')}</p>
    <section aria-label={uiText('Associated entities')} className="page-entity-existing">
      {loading?<p role="status">{uiText('Loading associations…')}</p>:associations.length===0?<p className="empty">{uiText('This page has no explicit entity associations yet.')}</p>:associations.map(item=>{
        const entity=entities.find(entity=>entity.id===item.entityId&&entity.vault_id===page.vault_id);
        return <AssociationRow key={item.entityId} association={item} name={entity?.name??uiText('Unavailable entity')} pending={pending} onOpen={onOpenEntity?()=>{onClose();onOpenEntity(item.entityId);}:undefined} onSave={values=>run(()=>update(item.entityId,values))} onRemove={()=>run(()=>update(item.entityId,{},true))}/>;
      })}
    </section>
    {!!pageLinks.length&&<section className="page-entity-existing" aria-label={uiText('Associated pages')}>{pageLinks.map(item=><AssociationRow key={item.id} association={{entityId:item.id,pinned:item.pinned,annotation:item.annotation}} name={item.title||uiText('Untitled')} pending={pending} onSave={values=>run(()=>updatePage(item.id,values))} onRemove={()=>run(()=>updatePage(item.id,{},true))}/>)}</section>}
    <ConnectPicker pages={pages} excludePageIds={[page.id,...pageLinks.map(item=>item.id)]} sourceLabel={page.title||uiText('Untitled')} entities={eligible} excludeEntityIds={associations.map(item=>item.entityId)} disabled={pending||loading||loadFailed} onConnect={async(target,options)=>{if(target.kind==='page')await updatePage(target.id,{pinned:options.pinned,annotation:options.annotation});else await update(target.id,{pinned:options.pinned,annotation:options.annotation});}}/>
    {pageUndo&&<p role="status">{uiText('Connection updated.')} <button type="button" disabled={pending} onClick={()=>run(()=>updatePage(pageUndo.id,pageUndo.previous?{pinned:pageUndo.previous.pinned,annotation:pageUndo.previous.annotation}:{},!pageUndo.previous,false))}>{uiText('Undo')}</button></p>}
    {undo&&<p role="status">{uiText('Connection updated.')} <button type="button" disabled={pending} onClick={()=>run(()=>update(undo.entityId,undo.previous?{pinned:undo.previous.pinned,annotation:undo.previous.annotation}:{},!undo.previous,false))}>{uiText('Undo')}</button></p>}
    {error&&<p role="alert" className="dialog-error">{error}{loadFailed&&!loading&&<button type="button" className="button" disabled={pending} onClick={()=>setLoadAttempt(value=>value+1)}>{uiText('Retry loading')}</button>}</p>}
    <div className="dialog-actions"><span role="status">{pending?uiText('Saving changes…'):uiText('Associations save automatically')}</span><button type="button" className="button" disabled={pending} onClick={close}>{uiText('Done')}</button></div>
  </Modal>;
}

function AssociationRow({association,name,pending,onOpen,onSave,onRemove}:{association:Association;name:string;pending:boolean;onOpen?:()=>void;onSave:(values:{pinned?:boolean;annotation?:string})=>void;onRemove:()=>void}) {
  const [annotation,setAnnotation]=useState(association.annotation);
  return <article className="page-entity-association" aria-label={name}>
    <div className="page-entity-association-heading">{onOpen?<button type="button" className="page-entity-name" disabled={pending} onClick={onOpen}>{name}<Icon name="chevron"/></button>:<strong>{name}</strong>}<span>{association.pinned?uiText('Pinned'):uiText('Associated')}</span></div>
    <label>{uiText('Page annotation')}<textarea maxLength={2000} value={annotation} disabled={pending} onChange={event=>setAnnotation(event.target.value)} rows={2}/></label>
    <div className="page-entity-row-actions"><button type="button" className="button" disabled={pending||annotation===association.annotation} onClick={()=>onSave({annotation})}>{uiText('Save annotation')}</button><button type="button" className="button" disabled={pending} onClick={()=>onSave({pinned:!association.pinned})}>{association.pinned?uiText('Unpin page'):uiText('Pin page')}</button><button type="button" className="button" disabled={pending} onClick={onRemove}>{uiText('Remove association')}</button></div>
  </article>;
}
