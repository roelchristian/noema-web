import {randomUUID} from 'node:crypto';
import type {ChatMessage,ChatScope,ChatThread} from '../../shared/chat.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import type {Vaults} from './vaults.js';
interface Row {id:string;vault_id:string;title:string;scope_json:string;created_at:string;updated_at:string}
const summary=(r:Row):ChatThread=>({id:r.id,vaultId:r.vault_id,title:r.title,scope:JSON.parse(r.scope_json) as ChatScope,createdAt:r.created_at,updatedAt:r.updated_at,messages:[]});
/** This service can mutate only conversation storage; no knowledge write APIs are reachable. */
export class ChatStorage {
 constructor(private store:Store,private vaults:Vaults){}
 list(vault:string) {this.vaults.requireOpen(vault);return this.store.all<Row>('SELECT * FROM chat_threads WHERE vault_id=? ORDER BY updated_at DESC,id LIMIT 100',vault).map(summary);}
 get(vault:string,id:string):ChatThread {
  this.vaults.requireOpen(vault);const row=this.store.get<Row>('SELECT * FROM chat_threads WHERE vault_id=? AND id=?',vault,id);
  if(!row)throw new HttpError(404,'Conversation is unavailable.');
  const thread=summary(row);
  thread.messages=this.store.all<{id:string;payload:string}>('SELECT id,payload FROM chat_messages WHERE thread_id=? ORDER BY sequence LIMIT 200',id).map(message=>{
   const item=JSON.parse(message.payload) as ChatMessage;
   const snapshots=this.store.all<{snapshot:string}>('SELECT snapshot FROM chat_evidence WHERE message_id=? ORDER BY evidence_id',message.id).map(row=>JSON.parse(row.snapshot));
   return {...item,...(snapshots.length?{evidence:snapshots}:{})};
  });return thread;
 }
 create(vault:string,scope:ChatScope,title='New conversation') {
  this.vaults.requireOpen(vault);const id=randomUUID(),now=new Date().toISOString();
  if(this.store.get<{n:number}>('SELECT count(*) n FROM chat_threads WHERE vault_id=?',vault)!.n>=1000)throw new HttpError(409,'Conversation history is full. Delete older conversations first.');
  this.store.run('INSERT INTO chat_threads (id,vault_id,title,scope_json,created_at,updated_at) VALUES (?,?,?,?,?,?)',id,vault,title.trim().slice(0,160)||'New conversation',JSON.stringify(scope),now,now);
  return this.get(vault,id);
 }
 rename(vault:string,id:string,title:unknown) {
  this.get(vault,id);if(typeof title!=='string'||!title.trim()||title.length>160)throw new HttpError(400,'Enter a title up to 160 characters.');
  this.store.run('UPDATE chat_threads SET title=?,updated_at=? WHERE vault_id=? AND id=?',title.trim(),new Date().toISOString(),vault,id);return this.get(vault,id);
 }
 remove(vault:string,id:string) {this.get(vault,id);this.store.run('DELETE FROM chat_threads WHERE vault_id=? AND id=?',vault,id);return {deleted:true};}
 append(vault:string,id:string,messages:ChatMessage[]) {
  const thread=this.get(vault,id);if(thread.messages.length+messages.length>200)throw new HttpError(409,'This conversation is full. Start a new conversation.');
  this.store.transaction(()=>{
   this.vaults.requireOpen(vault);
   for(const [index,message] of messages.entries()) {
    const {evidence,...payload}=message;
    this.store.run('INSERT INTO chat_messages (id,thread_id,sequence,payload) VALUES (?,?,?,?)',message.id,id,thread.messages.length+index,JSON.stringify(payload));
    for(const item of evidence??[])this.store.run('INSERT INTO chat_evidence (message_id,evidence_id,snapshot) VALUES (?,?,?)',message.id,item.id,JSON.stringify(item));
   }
   this.store.run('UPDATE chat_threads SET updated_at=? WHERE vault_id=? AND id=?',new Date().toISOString(),vault,id);
  });
 }
}
