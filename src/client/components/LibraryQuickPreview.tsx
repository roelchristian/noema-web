import {useEffect, useId, useRef, useState, type RefObject} from 'react';
import type {Entity, Organization, PagePreview, PageSummary} from '../../shared/domain';
import {api} from '../api';
import {Modal, ModalHeader} from './Modal';

export interface LibraryPreviewItem {kind:string;id:string;name:string;updatedAt?:string}
export function useLibraryQuickPreview(root:RefObject<HTMLElement|null>, {vaultId,items,pages,entities,organization,onOpen}: {
  vaultId:string;items:LibraryPreviewItem[];pages:PageSummary[];entities:Entity[];organization?:Organization;onOpen:(item:LibraryPreviewItem)=>void;
}) {
  const [selected,setSelected]=useState<string|null>(null);
  const trigger=useRef<HTMLElement|null>(null);
  const eligible=items.filter(item=>item.kind==='page'||item.kind==='entity');
  const item=eligible.find(value=>value.kind+':'+value.id===selected);
  const identity=JSON.stringify([vaultId,item?.kind,item?.id,item?.updatedAt]);
  const [loaded,setLoaded]=useState<{identity:string;page?:PagePreview;linked?:string[];error?:string}|null>(null);
  const titleId=useId();
  function show(value:LibraryPreviewItem,element?:HTMLElement) {
    trigger.current=element??(document.activeElement instanceof HTMLElement?document.activeElement:null);
    setSelected(value.kind+':'+value.id);
  }
  function close() {
    setSelected(null);
    const element=trigger.current;
    requestAnimationFrame(()=>{if(element?.isConnected)element.focus({preventScroll:true});});
  }
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const preview=(event:Event)=>{
      const row=(event as CustomEvent<string>).detail;
      const value=eligible.find(item=>item.kind+':'+item.id===row);
      if(value){event.preventDefault();show(value);}
    };
    element.addEventListener('noema:library-preview',preview);
    return()=>element.removeEventListener('noema:library-preview',preview);
  });
  useEffect(()=>{setSelected(null);},[vaultId]);
  useEffect(()=>{
    if(!item||item.kind!=='page')return;
    const controller=new AbortController();setLoaded({identity});
    void api.pagePreview(vaultId,item.id,controller.signal).then(page=>{
      if(!controller.signal.aborted)setLoaded(current=>({...current,identity,page}));
    }).catch(()=>{if(!controller.signal.aborted)setLoaded({identity,error:'Preview unavailable. You can still open this page.'});});
    void api.pageEntityAssociations(vaultId,item.id).then(links=>{
      if(!controller.signal.aborted)setLoaded(current=>({...current,identity,linked:links.map(link=>link.entityId)}));
    }).catch(()=>{/* Inline links remain available when explicit associations cannot be read. */});
    return()=>controller.abort();
  },[identity]);
  const current=loaded?.identity===identity?loaded:undefined;
  const entity=item?.kind==='entity'?entities.find(value=>value.id===item.id):undefined;
  const linked=new Set([...(current?.linked??[]),...(current?.page?.blocks.flatMap(block=>block.content.flatMap(segment=>segment.entityId?[segment.entityId]:[]))??[])]);
  const location=organization?.locations.find(value=>value.kind===item?.kind&&value.item_id===item?.id);
  const collections=organization?.memberships.filter(value=>value.kind===item?.kind&&value.item_id===item?.id).map(value=>organization.collections.find(collection=>collection.id===value.collection_id)?.name).filter(Boolean)??[];
  const index=eligible.findIndex(value=>value===item);
  const content=item?<Modal titleId={titleId} className="library-quick-preview" onClose={close}>
    <ModalHeader titleId={titleId}>{item.name}</ModalHeader>
    <div className="library-preview-navigation"><button className="button" disabled={index<=0} onClick={()=>setSelected(eligible[index-1].kind+':'+eligible[index-1].id)}>Previous</button><span>{index+1} of {eligible.length}</span><button className="button" disabled={index>=eligible.length-1} onClick={()=>setSelected(eligible[index+1].kind+':'+eligible[index+1].id)}>Next</button></div>
    <dl className="library-preview-metadata"><dt>Type</dt><dd>{entity?.type??'Page'}</dd><dt>Modified</dt><dd>{item.updatedAt?new Date(item.updatedAt).toLocaleString():'Unavailable'}</dd>{organization&&<><dt>Location</dt><dd>{organization.folders.find(folder=>folder.id===location?.folder_id)?.name??'Unfiled'}</dd><dt>Collections</dt><dd>{collections.join(', ')||'None'}</dd></>}</dl>
    {item.kind==='page'&&!current?.page&&!current?.error&&<p role="status">Loading preview…</p>}
    {current?.error&&<p role="status">{current.error}</p>}
    {current?.page&&<div className="library-preview-text">{current.page.blocks.map(block=><p key={block.id}>{block.content.map(segment=>segment.entityId?entities.find(entity=>entity.id===segment.entityId)?.name??segment.mentionText??'Linked entity':segment.text??'').join('')}</p>)}{current.page.truncated&&<p>Opening text shown. Open the page to continue reading.</p>}</div>}
    {entity?.description&&<p className="library-preview-text">{entity.description}</p>}
    {item.kind==='page'&&<p>Linked entities: {entities.filter(entity=>linked.has(entity.id)&&!entity.archived_at).map(entity=>entity.name).join(', ')||'None in opening text or associations'}</p>}
    <button className="button" onClick={()=>{close();onOpen(item);}}>Open {item.kind==='page'?'page':'entity'}</button>
  </Modal>:null;
  return {showPreview:show,quickPreview:content};
}
