import { numberedSourceText, sourceTextLines } from '../../shared/source-text.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Block,Page,SourceFile} from '../../shared/domain.js';
import {sourcePageBlockTypes,type SourcePageEvent,type SourcePageReview} from '../../shared/source-page.js';
import {Store} from '../store.js';
import {HttpError,now,text} from '../validation.js';
import {Knowledge} from './knowledge.js';
import {Pages} from './pages.js';

/** Only complete, validated records reach the browser or the persisted page. */
export class SourcePageDraft {
  private pending='';
  private size=0;
  private readonly sourceLines:string[];
  private evidenceBlocks=0;
  private recordCount=0;
  private quotedCharacters=0;
  title='';
  readonly blocks:Block[]=[];
  constructor(private emit:(event:SourcePageEvent)=>void,sourceText:string) {this.sourceLines=sourceTextLines(sourceText);}
  feed(delta:string) {
    this.size+=delta.length;
    if(this.size>60000)throw new HttpError(502,'The generated page exceeded the size limit. Try a narrower focus.');
    this.pending+=delta;
    let newline:number;
    while((newline=this.pending.indexOf('\n'))>=0){this.record(this.pending.slice(0,newline));this.pending=this.pending.slice(newline+1);}
  }
  finish() {
    if(this.pending.trim())this.record(this.pending);
    this.pending='';
    if(!this.title||!this.blocks.length)throw new HttpError(502,'AI did not return a complete page. Try again.');
    if(!this.evidenceBlocks)throw new HttpError(502,'AI did not ground the page in source evidence. Please retry.');
  }
  private record(line:string) {
    if(!line.trim())return;
    let value:unknown;try{value=JSON.parse(line.replace(/sk-[A-Za-z0-9_-]{16,}/g,'[redacted]'));}catch{throw new HttpError(502,'AI returned an invalid block. Please retry.');}
    if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(502,'AI returned an invalid page record.');
    const item=value as Record<string,unknown>;
    if(item.type==='title') {
      if(this.title||this.blocks.length||typeof item.title!=='string'||!item.title.trim()||item.title.trim()==='Untitled'||item.title.trim().length>200||/[\r\n]/.test(item.title))throw new HttpError(502,'AI returned an invalid page title.');
      this.title=item.title.trim();this.emit({type:'title',title:this.title});return;
    }
    if(item.type!=='block'||!this.title||!sourcePageBlockTypes.includes(item.blockType as typeof sourcePageBlockTypes[number])||typeof item.text!=='string'||!item.text.trim()||item.text.length>6000||this.recordCount>=100)throw new HttpError(502,'AI returned an invalid page block. Try a narrower focus.');
    if(!['source','context','inference'].includes(String(item.basis)))throw new HttpError(502,'AI did not distinguish source evidence from additional context. Please retry.');
    const citations=item.citations??[];
    if(!Array.isArray(citations)||citations.length>3)throw new HttpError(502,'AI returned invalid source citations. Please retry.');
    const heading=item.blockType==='heading1'||item.blockType==='heading2';
    if(!heading&&item.basis!=='context'&&!citations.length)throw new HttpError(502,'AI omitted source citations for a substantive block. Please retry.');
    const normalize=(value:string)=>value.replace(/\s+/g,' ').trim();
    const evidence=citations.map((citation:unknown)=>{
      if(!citation||typeof citation!=='object'||Array.isArray(citation))throw new HttpError(502,'AI returned an invalid citation.');
      const {startLine,endLine,quote}=citation as Record<string,unknown>;
      if(typeof startLine!=='number'||typeof endLine!=='number'||!Number.isInteger(startLine)||!Number.isInteger(endLine)||startLine<1||endLine<startLine||endLine>this.sourceLines.length||endLine-startLine>=30)throw new HttpError(502,'AI cited lines outside the supplied source. Please retry.');
      const passage=normalize(this.sourceLines.slice(startLine-1,endLine).join('\n'));
      if(!passage)throw new HttpError(502,'AI cited an empty source passage. Please retry.');
      if(quote!==undefined&&(typeof quote!=='string'||!normalize(quote)||quote.length>240||!passage.includes(normalize(quote))))throw new HttpError(502,'AI returned a quotation that does not match the cited source passage. Please retry.');
      if(typeof quote==='string')this.quotedCharacters+=quote.length;
      return {startLine,endLine,quote:typeof quote==='string'?quote:undefined,passage};
    });
    if(item.blockType==='quote') {
      if(item.basis!=='source'||item.text.length>240||!evidence.some(citation=>citation.passage.includes(normalize(item.text as string))))throw new HttpError(502,'AI returned a quote block that does not match the source. Please retry.');
      this.quotedCharacters+=item.text.length;
    }
    if(this.quotedCharacters>1200)throw new HttpError(502,'AI quoted too much of the source. Retry with a narrower focus.');
    if(item.basis==='source'&&!heading&&evidence.length)this.evidenceBlocks++;
    this.recordCount++;
    const block:Block={id:randomUUID(),type:item.blockType as typeof sourcePageBlockTypes[number],content:[],checked:false};
    const label=item.basis==='context'?'Additional context: ':'Interpretation: ';
    const literal=block.type==='code'||block.type==='math';
    if(item.basis!=='source'&&literal){
      const heading:Block={id:randomUUID(),type:'paragraph',content:[{text:label.trim(),bold:true}],checked:false};
      this.blocks.push(heading);this.emit({type:'block',block:heading});
    }else if(item.basis!=='source')block.content.push({text:label,bold:true});
    block.content.push({text:item.text});
    const references:Block['content']=[];
    for(const citation of evidence) {
      if(citation.quote&&item.blockType!=='quote')references.push({text:` “${citation.quote}”`,italic:true});
      const range=citation.startLine===citation.endLine?`L${citation.startLine}`:`L${citation.startLine}–L${citation.endLine}`;
      references.push({text:` [Source text ${range}]`,code:true});
    }
    if(literal&&references.length){
      this.blocks.push(block);this.emit({type:'block',block});
      const note:Block={id:randomUUID(),type:'paragraph',content:references,checked:false};
      this.blocks.push(note);this.emit({type:'block',block:note});return;
    }
    block.content.push(...references);
    this.blocks.push(block);this.emit({type:'block',block});
  }
}
export class SourcePages {
  constructor(private store:Store,private knowledge:Knowledge,private pages:Pages) {}
  prepare(vault:string,sourceId:string,body:Record<string,unknown>) {
    const source=this.knowledge.require(vault,sourceId);
    if(source.type!=='source')throw new HttpError(400,'Choose a Source entity.');
    const file=this.store.get<SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND entity_id=?',vault,sourceId);
    if(!file||source.inactive||file.status!=='ready'||file.admitted!==1||!file.text.trim())throw new HttpError(409,'Wait until the source finishes processing successfully before creating a page.');
    const focus=text(body.focus??'',2000).trim();
    const requestId=text(body.requestId,100);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw new HttpError(400,'Invalid generation request.');
    const fingerprint=createHash('sha256').update(JSON.stringify([sourceId,focus])).digest('hex');
    const previous=this.store.get<{page_id:string;fingerprint:string}>('SELECT page_id,fingerprint FROM source_page_creations WHERE request_id=? AND vault_id=?',requestId,vault);
    if(previous&&previous.fingerprint!==fingerprint)throw new HttpError(409,'This generation request has different focus text. Start a new request.');
    if(previous)return {requestId,fingerprint,file,sourceId,input:'',existing:this.pages.get(vault,previous.page_id),focus,review:undefined};
    const pending=this.store.get<DraftRow>('SELECT * FROM source_page_drafts WHERE request_id=? AND vault_id=?',requestId,vault);
    if(pending&&pending.fingerprint!==fingerprint)throw new HttpError(409,'This request has different focus text. Start a new generation.');
    if(pending?.status==='rejected')throw new HttpError(409,'This draft was rejected. Start a new generation.');
    if(pending?.status==='pending')return {requestId,fingerprint,file,sourceId,input:'',existing:undefined,focus,review:this.review(pending)};
    if(Buffer.byteLength(file.text)>160000)throw new HttpError(413,'This source is too long for page generation. Use a shorter source or split it into sections.');
    return {requestId,fingerprint,file,sourceId,input:JSON.stringify({user_focus:focus,untrusted_source:{name:source.name,url:file.source_url,filename:file.name,numbered_text:numberedSourceText(file.text)}}),existing:undefined,focus,review:undefined};
  }
  private review(row:DraftRow):SourcePageReview {return {id:row.request_id,title:row.title,blocks:JSON.parse(row.blocks) as Block[],focus:row.focus};}
  latest(vault:string,sourceId:string):SourcePageReview|null {
    this.knowledge.require(vault,sourceId);
    const row=this.store.get<DraftRow>("SELECT * FROM source_page_drafts WHERE vault_id=? AND source_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1",vault,sourceId);
    return row?this.review(row):null;
  }
  stage(vault:string,prepared:ReturnType<SourcePages['prepare']>,draft:SourcePageDraft,activityId:string):SourcePageReview {
    const current=this.store.get<SourceFile>('SELECT * FROM source_files WHERE id=? AND vault_id=? AND entity_id=?',prepared.file.id,vault,prepared.sourceId);
    if(!current||current.status!=='ready'||current.text!==prepared.file.text||this.knowledge.require(vault,prepared.sourceId).inactive)throw new HttpError(409,'The source changed during generation. Try again after it finishes processing.');
    const blocks=this.pages.validateBlocks(vault,draft.blocks);
    const recordedActivity=this.store.get('SELECT 1 FROM ai_activity WHERE id=?',activityId)?activityId:null;
    this.store.run(`INSERT INTO source_page_drafts (request_id,vault_id,source_id,fingerprint,source_hash,focus,title,blocks,status,activity_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,'pending',?,?)`,prepared.requestId,vault,prepared.sourceId,prepared.fingerprint,createHash('sha256').update(prepared.file.text).digest('hex'),prepared.focus,draft.title,JSON.stringify(blocks),recordedActivity,now());
    return {id:prepared.requestId,title:draft.title,blocks,focus:prepared.focus};
  }
  accept(vault:string,sourceId:string,value:unknown):{page:Page;created:boolean;activityId:string|null} {
    const requestId=text(value,100);
    return this.store.transaction(()=>{
      const previous=this.store.get<{page_id:string}>('SELECT page_id FROM source_page_creations WHERE request_id=? AND vault_id=? AND source_id=?',requestId,vault,sourceId);
      if(previous)return {page:this.pages.get(vault,previous.page_id),created:false,activityId:null};
      const row=this.store.get<DraftRow>('SELECT * FROM source_page_drafts WHERE request_id=? AND vault_id=? AND source_id=?',requestId,vault,sourceId);
      if(!row||row.status!=='pending')throw new HttpError(409,'This draft is no longer available for acceptance.');
      const file=this.store.get<SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND entity_id=?',vault,sourceId);
      if(!file||file.status!=='ready'||file.admitted!==1||this.knowledge.require(vault,sourceId).inactive||createHash('sha256').update(file.text).digest('hex')!==row.source_hash)throw new HttpError(409,'The source changed. Reject this draft and generate a new one from the ready source.');
      const blocks=this.pages.validateBlocks(vault,JSON.parse(row.blocks));
      const page=this.pages.create(vault,{title:row.title});
      this.store.run("UPDATE pages SET blocks=?,ai_status='ai_generated',summary_content_hash=NULL,revision=revision+1 WHERE id=? AND vault_id=?",JSON.stringify(blocks),page.id,vault);
      this.store.run('INSERT INTO page_sources (page_id,source_id) VALUES (?,?)',page.id,sourceId);
      this.store.run('INSERT INTO source_page_creations (request_id,vault_id,source_id,fingerprint,page_id,created_at) VALUES (?,?,?,?,?,?)',requestId,vault,sourceId,row.fingerprint,page.id,now());
      this.store.run("UPDATE source_page_drafts SET status='accepted',blocks='[]',focus='' WHERE request_id=?",requestId);
      if(row.notification_id)this.store.run('DELETE FROM ai_notifications WHERE id=?',row.notification_id);
      if(row.activity_id)this.store.run("UPDATE ai_activity SET object_kind='page',object_id=? WHERE id=?",page.id,row.activity_id);
      return {page:this.pages.get(vault,page.id),created:true,activityId:row.activity_id};
    });
  }
  reject(vault:string,sourceId:string,value:unknown) {
    const requestId=text(value,100);
    return this.store.transaction(()=>{
      if(this.store.get('SELECT 1 FROM source_page_creations WHERE request_id=? AND vault_id=? AND source_id=?',requestId,vault,sourceId))throw new HttpError(409,'This draft was already accepted. Accept again to recover and open the saved page.');
      const row=this.store.get<{notification_id:string|null}>('SELECT notification_id FROM source_page_drafts WHERE request_id=? AND vault_id=? AND source_id=?',requestId,vault,sourceId);
      this.store.run("UPDATE source_page_drafts SET status='rejected',blocks='[]',focus='' WHERE request_id=? AND vault_id=? AND source_id=? AND status='pending'",requestId,vault,sourceId);
      if(row?.notification_id)this.store.run('DELETE FROM ai_notifications WHERE id=?',row.notification_id);
      return {ok:true};
    });
  }
}
interface DraftRow {notification_id:string|null;request_id:string;vault_id:string;source_id:string;fingerprint:string;source_hash:string;focus:string;title:string;blocks:string;status:'pending'|'accepted'|'rejected';activity_id:string|null;created_at:string}
