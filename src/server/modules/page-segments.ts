import {createHash} from 'node:crypto';
import {projectPageText,type PageProjection} from '../../shared/page-text.js';
import {defaultPageIndexPolicy,isPageIndexPolicy,embeddingModel,embeddingDimensions,embeddingMaxBytes,type PageIndexPolicy,type PageReference} from '../../shared/embeddings.js';
import {entityMentionName,type Block} from '../../shared/domain.js';
import {passageTokenCount} from '../passage-tokenizer.js';
import {Store} from '../store.js';
import {now} from '../validation.js';

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export type PageStrategy='whole'|'sections'|'passages';
export interface PageSegment {id:string;page_id:string;vault_id:string;revision:number;projection_hash:string;ordinal:number;heading:string;text:string;input:string;content_hash:string;block_ids:string;start_offset:number;end_offset:number;token_count:number}
export function pageSegmentReference(segment:PageSegment):PageReference {
 return {pageId:segment.page_id,segmentId:segment.id,revision:segment.revision,projectionHash:segment.projection_hash,blockIds:JSON.parse(segment.block_ids) as string[],startOffset:segment.start_offset,endOffset:segment.end_offset,excerpt:segment.text};
}
export function pageIndexPolicy(store:Store,vault:string):PageIndexPolicy {
 const saved=store.get<{page_policy:string|null}>('SELECT page_policy FROM embedding_settings WHERE vault_id=?',vault)?.page_policy;
 try{const value=saved?JSON.parse(saved):null;return isPageIndexPolicy(value)?value:{...defaultPageIndexPolicy};}catch{return {...defaultPageIndexPolicy};}
}
function bounded(text:string,bytes:number) {let output='',used=0;for(const point of text){const size=Buffer.byteLength(point);if(used+size>bytes)break;used+=size;output+=point;}return output;}
function chooseStrategy(tokens:number,policy:PageIndexPolicy,previous?:PageStrategy):PageStrategy {
 const h=policy.hysteresisTokens;
 if(previous==='whole'&&tokens<=policy.smallTokens+h)return 'whole';
 if(previous==='sections'&&tokens>policy.smallTokens-h&&tokens<=policy.mediumTokens+h)return 'sections';
 if(previous==='passages'&&tokens>policy.mediumTokens-h)return 'passages';
 return tokens<=policy.smallTokens?'whole':tokens<=policy.mediumTokens?'sections':'passages';
}
/** Token budgets and overlap use the same tokenizer as source passages. */
export function segmentPage(projection:PageProjection,title:string,policy:PageIndexPolicy,previous?:PageStrategy) {
 const tokenCount=passageTokenCount(`${title}\n\n${projection.text}`);
 let strategy=chooseStrategy(tokenCount,policy,previous);
 const wholeInput=`${title.trim()}\n\n${projection.text.trim()}`;
 if(strategy==='whole'&&Buffer.byteLength(wholeInput)>embeddingMaxBytes)strategy='passages';
 const ranges:{start:number;end:number;heading:string}[]=[];
 if(strategy==='whole')ranges.push({start:0,end:projection.text.length,heading:''});
 else {
  let start=0,heading='';
  for(const block of projection.blocks)if(block.type==='heading1'||block.type==='heading2') {
   if(block.start>start)ranges.push({start,end:block.start,heading});
   start=block.start;heading=block.heading.join(' > ');
  }
  if(start<projection.text.length)ranges.push({start,end:projection.text.length,heading});
 }
 const segments:{start:number;end:number;heading:string;text:string;input:string;tokens:number}[]=[];
 for(const range of ranges) {
  const context=bounded([title.trim(),range.heading].filter(Boolean).join('\n'),1000);
  const prefix=context?context+'\n\n':'',bodyBudget=embeddingMaxBytes-Buffer.byteLength(prefix);
  const full=projection.text.slice(range.start,range.end);
  if(strategy==='whole'||strategy==='sections'&&Buffer.byteLength(full)<=bodyBudget&&passageTokenCount(full)<=policy.mediumTokens) {
   if(full.trim())segments.push({...range,text:full,input:strategy==='whole'?wholeInput:prefix+full,tokens:passageTokenCount(full)});
   continue;
  }
  let start=range.start;
  while(start<range.end) {
   while(start<range.end&&/\s/u.test(projection.text[start]!))start++;
   if(start>=range.end)break;
   let low=start+1,high=Math.min(range.end,start+bodyBudget),end=start;
   // Find a codepoint-safe bounded window; no whole-Page byte exclusion.
   while(low<=high) {
    let middle=(low+high)>>>1;
    if(middle<range.end&&/[\uDC00-\uDFFF]/.test(projection.text[middle]!))middle--;
    if(middle<=start){low=Math.max(low+1,start+2);continue;}
    const value=projection.text.slice(start,middle);
    if(Buffer.byteLength(value)<=bodyBudget&&passageTokenCount(value)<=policy.targetTokens){end=middle;low=Math.max(low+1,middle+1);}else high=middle-1;
   }
   if(end<=start)end=Math.min(range.end,start+(projection.text.codePointAt(start)!>0xffff?2:1));
   if(end<range.end) {
    const boundary=projection.blocks.filter(block=>block.end>start&&block.end<=end&&block.end>start+(end-start)/2).at(-1)?.end;
    if(boundary)end=boundary;
    else {const candidate=projection.text.slice(start,end),space=candidate.search(/\s+\S*$/u);if(space>candidate.length/2)end=start+space;}
   }
   const text=projection.text.slice(start,end);
   segments.push({start,end,heading:range.heading,text,input:prefix+text,tokens:passageTokenCount(text)});
   if(end>=range.end)break;
   // Bound overlap without crossing section boundaries or losing forward progress.
   let next=end;
   if(policy.overlapTokens>0) {
    let lo=Math.max(start+1,end-policy.overlapTokens*8),hi=end;
    while(lo<hi){const mid=(lo+hi)>>>1;if(passageTokenCount(projection.text.slice(mid,end))<=policy.overlapTokens)hi=mid;else lo=mid+1;}
    next=lo;
    if(/[\uDC00-\uDFFF]/.test(projection.text[next]??''))next++;
   }
   start=next>start?next:end;
  }
 }
 return {strategy,tokenCount,segments};
}

export class PageSegments {
 constructor(private store:Store) {}
 /** A foreground page operation can synchronize just its own projection. */
 synchronize(vault:string,pageId?:string) {
  const namesByVault=new Map<string,Map<string,string|undefined>>();
  for(const row of this.store.all<{page_id:string}>(`SELECT d.page_id FROM page_index_dirty d JOIN vaults v ON v.id=d.vault_id WHERE d.vault_id=? AND v.locked=0 AND d.next_attempt_at<=? ${pageId?'AND d.page_id=?':''} ORDER BY d.next_attempt_at,d.page_id LIMIT 16`,vault,now(),...(pageId?[pageId]:[])))this.process(row.page_id,namesByVault);
 }
 tick(){const row=this.store.get<{page_id:string}>('SELECT d.page_id FROM page_index_dirty d JOIN vaults v ON v.id=d.vault_id WHERE v.locked=0 AND d.next_attempt_at<=? ORDER BY d.next_attempt_at,d.page_id LIMIT 1',now());if(row)this.process(row.page_id,new Map());}
 private process(id:string,namesByVault:Map<string,Map<string,string|undefined>>) {
  try {this.store.transaction(()=>{
   const page=this.store.get<{id:string;vault_id:string;title:string;blocks:string;revision:number;deleted_at:string|null}>('SELECT p.* FROM pages p JOIN vaults v ON v.id=p.vault_id WHERE p.id=? AND v.locked=0',id);
   if(!page)return;
   if(page.deleted_at){this.store.run('DELETE FROM page_segments WHERE page_id=?',id);this.store.run('DELETE FROM page_index_state WHERE page_id=?',id);this.store.run('DELETE FROM page_index_dirty WHERE page_id=?',id);return;}
   let names=namesByVault.get(page.vault_id);
   if(!names){
    names=new Map(this.store.all<{id:string;name:string;mention_case:string}>('SELECT id,name,mention_case FROM entities WHERE vault_id=?',page.vault_id).map(entity=>[entity.id,entityMentionName({name:entity.name,mentionCase:entity.mention_case as 'canonical'|'lowercase'})]));
    namesByVault.set(page.vault_id,names);
   }
   const projection=projectPageText(JSON.parse(page.blocks) as Block[],entityId=>names.get(entityId));
   const policy=pageIndexPolicy(this.store,page.vault_id),previous=this.store.get<{strategy:PageStrategy;projection_hash:string;policy_hash:string}>('SELECT strategy,projection_hash,policy_hash FROM page_index_state WHERE page_id=?',id);
   const projectionHash=hash(JSON.stringify([page.title,projection]));
   if(previous?.projection_hash===projectionHash&&previous.policy_hash===hash(JSON.stringify(policy))) {
    this.store.run('UPDATE page_segments SET revision=?,vault_id=? WHERE page_id=? AND (revision<>? OR vault_id<>?)',page.revision,page.vault_id,id,page.revision,page.vault_id);
    this.store.run('UPDATE page_index_state SET revision=?,updated_at=? WHERE page_id=?',page.revision,now(),id);
    this.store.run('DELETE FROM page_index_dirty WHERE page_id=?',id);return;
   }
   const result=segmentPage(projection,page.title,policy,previous?.strategy);
   const existing=this.store.all<PageSegment>('SELECT * FROM page_segments WHERE page_id=? ORDER BY ordinal',id);
   const available=new Map(existing.map(segment=>[segment.id,segment]));
   const byAnchor=new Map<string,PageSegment[]>(),byContent=new Map<string,PageSegment[]>();
   for(const segment of [...existing].reverse()) {
    const anchor=segment.content_hash+segment.block_ids;
    if(!byAnchor.has(anchor))byAnchor.set(anchor,[]);byAnchor.get(anchor)!.push(segment);
    if(!byContent.has(segment.content_hash))byContent.set(segment.content_hash,[]);byContent.get(segment.content_hash)!.push(segment);
   }
   const take=(candidates:PageSegment[]|undefined)=>{
    while(candidates?.length){const segment=candidates.pop()!;if(available.delete(segment.id))return segment;}
   };
   const desired=result.segments.map((part,ordinal)=>({part,ordinal,contentHash:hash(`page-segment-v1\n${part.input}`),blockIds:JSON.stringify(projection.blocks.filter(block=>block.end>part.start&&block.start<part.end).map(block=>block.id)),previous:undefined as PageSegment|undefined,id:''}));
   // Match anchors first so removing one of two identical sections preserves the
   // surviving section's identity. Content-equivalent moves can then reuse rows.
   for(const row of desired) {
    row.previous=take(byAnchor.get(row.contentHash+row.blockIds));
   }
   for(const row of desired)if(!row.previous) {
    row.previous=take(byContent.get(row.contentHash));
   }
   const used=new Set(desired.flatMap(row=>row.previous?[row.previous.id]:[]));
   for(const row of desired) {
    if(row.previous){row.id=row.previous.id;continue;}
    let occurrence=0;
    do {row.id=hash(`${id}:${row.contentHash}:${occurrence++}`);}while(used.has(row.id));
    used.add(row.id);
   }
   for(const segment of available.values())this.store.run('DELETE FROM page_segments WHERE id=?',segment.id);
   // The ordinal uniqueness constraint is immediate. Move only reordered rows
   // to a temporary negative slot before assigning their final positions.
   for(const row of desired)if(row.previous&&row.previous.ordinal!==row.ordinal)this.store.run('UPDATE page_segments SET ordinal=? WHERE id=?',-row.previous.ordinal-1,row.id);
   for(const {part,ordinal,contentHash,blockIds,previous:before,id:segmentId} of desired) {
    if(before) {
     // The provider input is bounded/trimmed, so equal hashes can still have
     // changed display text or heading metadata. Refresh FTS only in that case.
     if(before.heading!==part.heading||before.text!==part.text||before.input!==part.input||before.token_count!==part.tokens)
      this.store.run('UPDATE page_segments SET heading=?,text=?,input=?,token_count=? WHERE id=?',part.heading,part.text,part.input,part.tokens,segmentId);
     if(before.revision!==page.revision||before.vault_id!==page.vault_id||before.projection_hash!==projectionHash||before.ordinal!==ordinal||before.block_ids!==blockIds||before.start_offset!==part.start||before.end_offset!==part.end)
      this.store.run('UPDATE page_segments SET vault_id=?,revision=?,projection_hash=?,ordinal=?,block_ids=?,start_offset=?,end_offset=? WHERE id=?',page.vault_id,page.revision,projectionHash,ordinal,blockIds,part.start,part.end,segmentId);
     continue;
    }
    this.store.run(`INSERT INTO page_segments(id,page_id,vault_id,revision,projection_hash,ordinal,heading,text,input,content_hash,block_ids,start_offset,end_offset,token_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,segmentId,id,page.vault_id,page.revision,projectionHash,ordinal,part.heading,part.text,part.input,contentHash,blockIds,part.start,part.end,part.tokens);
    // Adopt legacy short-Page vectors only when their exact input still matches.
    const legacy=this.store.get<{vector:string;tokens:number;updated_at:string}>('SELECT vector,tokens,updated_at FROM note_embeddings WHERE page_id=? AND model=? AND dimensions=? AND content_hash=?',id,embeddingModel,embeddingDimensions,hash(part.input));
    if(legacy)this.store.run('INSERT OR IGNORE INTO page_segment_cache VALUES (?,?,?,?,?,?,?)',id,contentHash,embeddingModel,embeddingDimensions,legacy.vector,legacy.tokens,legacy.updated_at);
   }
   // Existing attachments are deliberately untouched, including their rowids.
   this.store.run(`INSERT INTO page_segment_embeddings SELECT s.id,c.model,c.dimensions,c.content_hash,c.vector,c.tokens,c.updated_at FROM page_segments s JOIN page_segment_cache c ON c.page_id=s.page_id AND c.content_hash=s.content_hash WHERE s.page_id=? AND NOT EXISTS (SELECT 1 FROM page_segment_embeddings b WHERE b.segment_id=s.id AND b.model=c.model AND b.dimensions=c.dimensions)`,id);
   this.store.run(`INSERT INTO page_index_state(page_id,vault_id,revision,projection_hash,strategy,policy_hash,token_count,updated_at,error,body_characters) VALUES (?,?,?,?,?,?,?,?,NULL,?) ON CONFLICT(page_id) DO UPDATE SET vault_id=excluded.vault_id,revision=excluded.revision,projection_hash=excluded.projection_hash,strategy=excluded.strategy,policy_hash=excluded.policy_hash,token_count=excluded.token_count,updated_at=excluded.updated_at,error=NULL,body_characters=excluded.body_characters`,id,page.vault_id,page.revision,projectionHash,result.strategy,hash(JSON.stringify(policy)),result.tokenCount,now(),projection.text.trim().length);
   this.store.run(`UPDATE embedding_jobs SET status='skipped',finished_at=?,error='Page segment changed.'
    WHERE page_id=? AND status IN ('queued','running') AND NOT EXISTS (
     SELECT 1 FROM page_segments s WHERE s.id=embedding_jobs.segment_id AND s.page_id=embedding_jobs.page_id
      AND s.vault_id=embedding_jobs.vault_id AND s.content_hash=embedding_jobs.content_hash)`,now(),id);
   this.store.run('DELETE FROM page_index_dirty WHERE page_id=?',id);
  });}catch(error){this.store.run('UPDATE page_index_dirty SET error=?,next_attempt_at=? WHERE page_id=?',error instanceof Error?error.message:'Page indexing failed.',new Date(Date.now()+30000).toISOString(),id);}
 }
}
