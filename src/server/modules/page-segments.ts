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
 synchronize(vault:string) {for(const row of this.store.all<{page_id:string}>('SELECT page_id FROM page_index_dirty WHERE vault_id=? AND next_attempt_at<=?',vault,now()))this.process(row.page_id);}
 tick(){const row=this.store.get<{page_id:string}>('SELECT d.page_id FROM page_index_dirty d JOIN vaults v ON v.id=d.vault_id WHERE v.locked=0 AND d.next_attempt_at<=? LIMIT 1',now());if(row)this.process(row.page_id);}
 private process(id:string) {
  try {this.store.transaction(()=>{
   const page=this.store.get<{id:string;vault_id:string;title:string;blocks:string;revision:number;deleted_at:string|null}>('SELECT p.* FROM pages p JOIN vaults v ON v.id=p.vault_id WHERE p.id=? AND v.locked=0',id);
   if(!page)return;
   if(page.deleted_at){this.store.run('DELETE FROM page_segments WHERE page_id=?',id);this.store.run('DELETE FROM page_index_state WHERE page_id=?',id);this.store.run('DELETE FROM page_index_dirty WHERE page_id=?',id);return;}
   const names=new Map(this.store.all<{id:string;name:string;mention_case:string}>('SELECT id,name,mention_case FROM entities WHERE vault_id=?',page.vault_id).map(entity=>[entity.id,entityMentionName({name:entity.name,mentionCase:entity.mention_case as 'canonical'|'lowercase'})]));
   const projection=projectPageText(JSON.parse(page.blocks) as Block[],id=>names.get(id));
   const policy=pageIndexPolicy(this.store,page.vault_id),previous=this.store.get<{strategy:PageStrategy;projection_hash:string;policy_hash:string}>('SELECT strategy,projection_hash,policy_hash FROM page_index_state WHERE page_id=?',id);
   const projectionHash=hash(JSON.stringify([page.title,projection]));
   if(previous?.projection_hash===projectionHash&&previous.policy_hash===hash(JSON.stringify(policy))) {
    this.store.run('UPDATE page_segments SET revision=? WHERE page_id=?',page.revision,id);
    this.store.run('UPDATE page_index_state SET revision=?,updated_at=? WHERE page_id=?',page.revision,now(),id);
    this.store.run('DELETE FROM page_index_dirty WHERE page_id=?',id);return;
   }
   const result=segmentPage(projection,page.title,policy,previous?.strategy);
   const occurrences=new Map<string,number>();
   this.store.run('DELETE FROM page_segments WHERE page_id=?',id);
   for(const [ordinal,part] of result.segments.entries()) {
    const contentHash=hash(`page-segment-v1\n${part.input}`),occurrence=occurrences.get(contentHash)??0;occurrences.set(contentHash,occurrence+1);
    const segmentId=hash(`${id}:${contentHash}:${occurrence}`),blockIds=projection.blocks.filter(block=>block.end>part.start&&block.start<part.end).map(block=>block.id);
    this.store.run(`INSERT INTO page_segments(id,page_id,vault_id,revision,projection_hash,ordinal,heading,text,input,content_hash,block_ids,start_offset,end_offset,token_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,segmentId,id,page.vault_id,page.revision,projectionHash,ordinal,part.heading,part.text,part.input,contentHash,JSON.stringify(blockIds),part.start,part.end,part.tokens);
    // Adopt legacy short-Page vectors only when their exact input still matches.
    const legacy=this.store.get<{vector:string;tokens:number;updated_at:string}>('SELECT vector,tokens,updated_at FROM note_embeddings WHERE page_id=? AND model=? AND dimensions=? AND content_hash=?',id,embeddingModel,embeddingDimensions,hash(part.input));
    if(legacy)this.store.run('INSERT OR IGNORE INTO page_segment_cache VALUES (?,?,?,?,?,?,?)',id,contentHash,embeddingModel,embeddingDimensions,legacy.vector,legacy.tokens,legacy.updated_at);
   }
   this.store.run(`INSERT INTO page_segment_embeddings SELECT s.id,c.model,c.dimensions,c.content_hash,c.vector,c.tokens,c.updated_at FROM page_segments s JOIN page_segment_cache c ON c.page_id=s.page_id AND c.content_hash=s.content_hash WHERE s.page_id=?`,id);
   this.store.run(`INSERT INTO page_index_state(page_id,vault_id,revision,projection_hash,strategy,policy_hash,token_count,updated_at,error,body_characters) VALUES (?,?,?,?,?,?,?,?,NULL,?) ON CONFLICT(page_id) DO UPDATE SET vault_id=excluded.vault_id,revision=excluded.revision,projection_hash=excluded.projection_hash,strategy=excluded.strategy,policy_hash=excluded.policy_hash,token_count=excluded.token_count,updated_at=excluded.updated_at,error=NULL,body_characters=excluded.body_characters`,id,page.vault_id,page.revision,projectionHash,result.strategy,hash(JSON.stringify(policy)),result.tokenCount,now(),projection.text.trim().length);
   this.store.run(`UPDATE embedding_jobs SET status='skipped',finished_at=?,error='Page segment changed.'
    WHERE page_id=? AND status IN ('queued','running') AND NOT EXISTS (
     SELECT 1 FROM page_segments s WHERE s.id=embedding_jobs.segment_id AND s.page_id=embedding_jobs.page_id
      AND s.vault_id=embedding_jobs.vault_id AND s.content_hash=embedding_jobs.content_hash)`,now(),id);
   this.store.run('DELETE FROM page_index_dirty WHERE page_id=?',id);
  });}catch(error){this.store.run('UPDATE page_index_dirty SET error=?,next_attempt_at=? WHERE page_id=?',error instanceof Error?error.message:'Page indexing failed.',new Date(Date.now()+30000).toISOString(),id);}
 }
}
