import {t as uiText} from '../i18n';
import {useEffect, useState, type RefObject} from 'react';
import {entityMentionName, entityLabels, type Entity} from '../../shared/domain';
import {Modal, ModalHeader} from '../components/Modal';
import {mentionMatches} from './mention-picker';
import {segmentHTML} from './segments';

/** Occurrence edits stay in the normal document history, including retag exclusions. */
export function EntityLinkActions({editor,entities,onCommit,onOpen}:{editor:RefObject<HTMLDivElement|null>;entities:Entity[];onCommit:()=>void;onOpen:(id:string)=>void}) {
  const [target,setTarget]=useState<HTMLElement|null>(null),[query,setQuery]=useState(''),[index,setIndex]=useState(0),[error,setError]=useState('');
  useEffect(()=>{
    function open(event:Event){const node=(event as CustomEvent<HTMLElement>).detail;if(!editor.current?.contains(node)||!node.closest('.block-content[contenteditable="true"]'))return;setTarget(node);setQuery('');setIndex(0);setError('');}
    document.addEventListener('noema:entity-link',open);
    return()=>document.removeEventListener('noema:entity-link',open);
  },[editor]);
  useEffect(()=>{document.querySelector<HTMLElement>('#correction-results [aria-selected=true]')?.scrollIntoView?.({block:'nearest'});},[index,query,target]);
  if(!target)return null;
  const entity=entities.find(item=>item.id===target.dataset.entity);
  const wording=target.dataset.mentionText ?? entityMentionName(entity) ?? target.textContent ?? '';
  const results=mentionMatches(entities,query||entity?.name||'',{limit:20});
  function close(){setTarget(null);requestAnimationFrame(()=>{if(target?.isConnected)target.focus();});}
  function replace(id?:string){
    if(!target?.isConnected||!editor.current?.contains(target)||!target.closest('.block-content[contenteditable="true"]')){setError('This link changed. Close this dialog and select it again.');return;}
    const wrapper=document.createElement('span');
    wrapper.innerHTML=segmentHTML([id?{entityId:id,mentionText:wording,skipAutoTag:true}:{text:wording,skipAutoTag:true}],entities);
    const replacement=wrapper.firstChild!;
    // Release modal focus before placing the caret in the editor.
    document.querySelector<HTMLDialogElement>('.entity-link-dialog')?.close();
    const host=target.closest<HTMLElement>('.block-content');target.replaceWith(replacement);
    const range=document.createRange();range.setStartAfter(replacement);range.collapse(true);host?.focus();getSelection()?.removeAllRanges();getSelection()?.addRange(range);
    onCommit();setTarget(null);
  }
  return <Modal className="entity-link-dialog" titleId="entity-link-title" onClose={close} initialFocus="input">
    <ModalHeader titleId="entity-link-title">{uiText("Link entity")}</ModalHeader>
    <p>“{wording}” · {entity?.name} · {entity ? uiText(entityLabels[entity.type]) : ''}</p>
    <p>{uiText("Change this occurrence or remove its link. Your wording stays the same.")}</p>
    {error&&<p role="alert">{error}</p>}
    <input aria-label={uiText("Change linked entity")} placeholder={uiText("Find an entity…")} value={query} onChange={e=>{setQuery(e.target.value);setIndex(0);}} onKeyDown={e=>{
      if(e.nativeEvent.isComposing)return;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setIndex(i=>(i+(e.key==='ArrowDown'?1:-1)+results.length)%Math.max(1,results.length));}
      if(e.key==='Enter'&&results[index]){e.preventDefault();replace(results[index]!.id);}
    }} role="combobox" aria-expanded="true" aria-controls="correction-results" aria-activedescendant={results[index]?'correction-'+results[index]!.id:undefined}/>
    <div className="selection-entity-results" id="correction-results" role="listbox">{results.map((item,i)=><button type="button" key={item.id} id={'correction-'+item.id} role="option" aria-selected={index===i} className={index===i?'highlight':''} onClick={()=>replace(item.id)}>{item.name}<small>{uiText(entityLabels[item.type])}{item.description?' · '+item.description:''}</small></button>)}</div>
    <footer className="dialog-actions"><button type="button" className="button" onClick={()=>replace()}>{uiText("Remove link")}</button><button type="button" className="button" onClick={()=>{setTarget(null);onOpen(target.dataset.entity!);}}>{uiText("Open entity details")}</button></footer>
  </Modal>;
}
