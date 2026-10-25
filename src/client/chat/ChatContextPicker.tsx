import {useEffect,useRef} from 'react';
import type {Entity,Folder,PageSummary} from '../../shared/domain';
import {entityLabels} from '../../shared/domain';
import type {ChatMention,ChatScope} from '../../shared/chat';
import {Icon} from '../components/Icon';

export type ChatContextChoice={kind:'entity';key:string;name:string;description:string;entity:Entity}|{kind:'page'|'source'|'folder';key:string;name:string;description:string;scope:Exclude<ChatScope,{kind:'vault'}>};
function folderPath(byId:Map<string,Folder>,id:string):string {
 const names:string[]=[],seen=new Set<string>();let folder=byId.get(id);
 while(folder&&!seen.has(folder.id)){seen.add(folder.id);names.unshift(folder.name);folder=folder.parent_id?byId.get(folder.parent_id):undefined;}
 return names.join(' / ');
}
export function chatFolderPath(folders:Folder[],id:string):string {return folderPath(new Map(folders.map(folder=>[folder.id,folder])),id);}
export function chatContextChoices(vaultId:string,query:string,entities:Entity[],pages:PageSummary[],folders:Folder[],mentions:ChatMention[]):ChatContextChoice[] {
 const byId=new Map(folders.map(folder=>[folder.id,folder])),matches=(name:string)=>name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
 const notes:ChatContextChoice[]=pages.filter(page=>!page.archived_at&&matches(page.title)).slice(0,4).map(page=>({kind:'page',key:'page:'+page.id,name:page.title||'Untitled note',description:'Use only this note',scope:{kind:'page',id:page.id}}));
 const sources:ChatContextChoice[]=entities.filter(entity=>entity.vault_id===vaultId&&entity.type==='source'&&!entity.inactive&&!entity.archived_at&&matches(entity.name)).slice(0,4).map(entity=>({kind:'source',key:'source:'+entity.id,name:entity.name,description:'Use only this source',scope:{kind:'source',id:entity.id}}));
 const containers:ChatContextChoice[]=folders.map(folder=>({folder,path:folderPath(byId,folder.id)})).filter(item=>matches(item.path)).slice(0,4).map(({folder,path})=>({kind:'folder',key:'folder:'+folder.id,name:folder.name,description:path+' · includes subfolders',scope:{kind:'folder',id:folder.id}}));
 const references:ChatContextChoice[]=entities.filter(entity=>entity.vault_id===vaultId&&entity.type!=='source'&&!entity.inactive&&matches(entity.name)&&!mentions.some(mention=>mention.id===entity.id)).slice(0,8).map(entity=>({kind:'entity',key:'entity:'+entity.id,name:entity.name,description:(entityLabels[entity.type]??'Entity')+' · add a reference',entity}));
 return [...notes,...sources,...containers,...references];
}
export function ChatContextPicker({choices,selectedIndex,onChoose}:{choices:ChatContextChoice[];selectedIndex:number;onChoose:(choice:ChatContextChoice)=>void}) {
 const list=useRef<HTMLDivElement>(null);
 useEffect(()=>{list.current?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView?.({block:'nearest'});},[selectedIndex,choices]);
 const groups=[['page','Notes'],['source','Sources'],['folder','Folders'],['entity','Entities']] as const;
 return <div ref={list} id="chat-mention-list" className="chat-mention-list" role="listbox" aria-label="Choose context or a knowledge entity">
  {groups.map(([kind,label])=>{const items=choices.filter(choice=>choice.kind===kind);return items.length>0&&<section className="chat-mention-group" key={kind} role="group" aria-label={label}><h3>{label}</h3>{items.map(choice=>{const index=choices.indexOf(choice);return <button type="button" role="option" id={'chat-mention-'+index} aria-selected={index===selectedIndex} key={choice.key} data-context-kind={choice.kind} data-context-id={choice.kind==='entity'?choice.entity.id:choice.scope.id} onMouseDown={event=>event.preventDefault()} onClick={()=>onChoose(choice)}><Icon name={kind==='folder'?'folder':kind==='page'?'page':kind==='source'?'source':'knowledge'}/><span><strong>{choice.name}</strong><small>{choice.description}</small></span></button>;})}</section>;})}
 </div>;
}
