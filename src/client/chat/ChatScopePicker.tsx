import {useState} from 'react';
import type {Entity,Folder,PageSummary} from '../../shared/domain';
import type {ChatScope} from '../../shared/chat';
import {Modal,ModalHeader} from '../components/Modal';
import {Icon} from '../components/Icon';
import {chatScopeChoices} from './ChatContextPicker';

interface Props {vaultId:string;scope:ChatScope;entities:Entity[];pages:PageSummary[];folders:Folder[];onChoose:(scope:ChatScope)=>void;onClose:()=>void}
export function ChatScopePicker({vaultId,scope,entities,pages,folders,onChoose,onClose}:Props) {
 const [query,setQuery]=useState('');
 const choices=chatScopeChoices(vaultId,query,entities,pages,folders);
 const groups=[['page','Notes'],['source','Sources'],['folder','Folders']] as const;
 return <Modal className="chat-scope-dialog" titleId="chat-scope-title" onClose={onClose} dismissOnBackdrop initialFocus="input[type=search]">
  <ModalHeader titleId="chat-scope-title" closeLabel="Close search scope">Search within</ModalHeader>
  <div className="chat-scope-content">
   <p className="chat-muted">Choose where Meno may search. Mentions identify a subject and do not change this boundary.</p>
   <label className="chat-history-search"><Icon name="search"/><input type="search" aria-label="Find a note, source or folder" placeholder="Find a note, source or folder…" value={query} onChange={event=>setQuery(event.target.value)}/></label>
   <button className="chat-scope-option" type="button" aria-pressed={scope.kind==='vault'} onClick={()=>onChoose({kind:'vault'})}><Icon name="search"/><span><strong>Entire vault</strong><small>Search all available material in this vault</small></span></button>
   {groups.map(([kind,label])=>{const items=choices.filter(item=>item.kind===kind);return items.length>0&&<section className="chat-scope-group" aria-label={label} key={kind}><h3>{label}</h3>{items.map(item=>item.kind!=='entity'&&<button className="chat-scope-option" type="button" key={item.key} data-context-kind={item.kind} data-context-id={item.scope.id} aria-pressed={scope.kind!=='vault'&&scope.kind===item.scope.kind&&scope.id===item.scope.id} onClick={()=>onChoose(item.scope)}><Icon name={kind==='folder'?'folder':kind==='page'?'page':'source'}/><span><strong>{item.name}</strong><small>{item.description}</small></span></button>)}</section>;})}
   {!choices.length&&<p role="status" className="chat-muted">No matching notes, sources or folders.</p>}
  </div>
 </Modal>;
}
