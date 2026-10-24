import {createHash} from 'node:crypto';
import {embeddingDimensions,embeddingModel} from '../../shared/embeddings.js';
import type {SemanticCollectionDefinition} from '../../shared/smart-collections.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {CachedVectorSearch} from '../vector-search.js';
import {Vaults} from './vaults.js';

export type SemanticEvaluationState='evaluated'|'missing'|'stale'|'error'|'ineligible';
export interface SemanticResult {
 item_id:string;title:string;matched:boolean;evidence:string[];state:SemanticEvaluationState;score?:number;fingerprint:string;
}
interface Candidate {
 id:string;title:string;revision:number;index_revision:number|null;projection_hash:string|null;body_characters:number|null;
 index_error:string|null;dirty:number;dirty_error:string|null;minimum:number;
}
interface Segment {
 id:string;revision:number;projection_hash:string;ordinal:number;text:string;heading:string;content_hash:string;
 start_offset:number;end_offset:number;token_count:number;vector:string|null;embedding_hash:string|null;updated_at:string|null;
}
const vectors=new CachedVectorSearch(4096);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const segmentLimit=512;

/** Overlapping passage windows count each position only once in coverage. */
function unionLength(ranges:readonly {start_offset:number;end_offset:number}[]):number {
 let length=0,end=-1;
 for(const range of [...ranges].sort((a,b)=>a.start_offset-b.start_offset||a.end_offset-b.end_offset)) {
  length+=Math.max(0,range.end_offset-Math.max(end,range.start_offset));end=Math.max(end,range.end_offset);
 }
 return length;
}

/** Saved vectors only: selecting candidates first bounds both indexing work and content reads. */
export function evaluateSemanticBatch(store:Store,vault:string,config:SemanticCollectionDefinition,queryVector:number[],after:string,limit:number,itemIds?:string[],collectionId?:string):{items:SemanticResult[];hasMore:boolean} {
 new Vaults(store).requireOpen(vault);
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new HttpError(400,'Semantic batches must contain 1–100 pages.');
 if(typeof after!=='string'||(itemIds!==undefined&&(!Array.isArray(itemIds)||itemIds.length>100||itemIds.some(id=>typeof id!=='string'||!id))))throw new HttpError(400,'Invalid semantic candidate IDs.');
 if(!Number.isFinite(config.threshold)||config.threshold<0||config.threshold>1||!Number.isFinite(config.minCoverage)||config.minCoverage<=0||config.minCoverage>1)throw new HttpError(400,'Invalid semantic matching thresholds.');
 const queryHash=hash(JSON.stringify(queryVector));
 if(vectors.score(`${vault}:semantic-query:${queryHash}`,JSON.stringify(queryVector),queryVector,embeddingDimensions)===undefined)throw new HttpError(400,'The semantic description embedding is invalid. Evaluate the description again.');
 if(itemIds?.length===0)return {items:[],hasMore:false};
 const rows=store.all<Candidate>(`SELECT p.id,p.title,p.revision,i.revision AS index_revision,i.projection_hash,i.body_characters,i.error AS index_error,
  EXISTS(SELECT 1 FROM page_index_dirty d WHERE d.page_id=p.id AND d.vault_id=p.vault_id) AS dirty,
  (SELECT error FROM page_index_dirty d WHERE d.page_id=p.id AND d.vault_id=p.vault_id) AS dirty_error,
  coalesce((SELECT min_characters FROM embedding_settings WHERE vault_id=p.vault_id),20) AS minimum
  FROM pages p LEFT JOIN page_index_state i ON i.page_id=p.id AND i.vault_id=p.vault_id
  WHERE p.vault_id=? AND p.deleted_at IS NULL AND p.archived_at IS NULL AND p.id>? ${itemIds?`AND p.id IN (${itemIds.map(()=>'?').join(',')})`:''}
  ORDER BY p.id LIMIT ?`,vault,after,...(itemIds??[]),limit+1);
 const baseFingerprint=hash(JSON.stringify([embeddingModel,embeddingDimensions,queryHash,config]));
 const items=rows.slice(0,limit).map((page):SemanticResult=>{
  let fingerprint=hash(JSON.stringify([baseFingerprint,page.id,page.revision,page.index_revision,page.projection_hash,page.dirty,page.dirty_error,page.index_error,page.body_characters,page.minimum]));
  const result=(state:SemanticEvaluationState,evidence:string[]):SemanticResult=>({item_id:page.id,title:page.title,matched:false,state,evidence,fingerprint});
  if(page.index_error||page.dirty_error)return result('error',['Page indexing failed. Saved semantic membership has not been re-evaluated.']);
  if(page.dirty)return result('stale',['Page indexing is pending. Previous semantic evidence may be stale.']);
  if(page.index_revision===null)return result('missing',['This page has no current semantic index.']);
  if(page.index_revision!==page.revision)return result('stale',['The saved page index belongs to an earlier revision.']);
  if((page.body_characters??0)<page.minimum)return result('ineligible',['Page body is below the configured semantic indexing minimum.']);
  const segments=store.all<Segment>(`SELECT s.id,s.revision,s.projection_hash,s.ordinal,s.text,s.heading,s.content_hash,s.start_offset,s.end_offset,s.token_count,
   b.vector,b.content_hash AS embedding_hash,b.updated_at
   FROM page_segments s LEFT JOIN page_segment_embeddings b ON b.segment_id=s.id AND b.model=? AND b.dimensions=?
   WHERE s.vault_id=? AND s.page_id=? ORDER BY s.start_offset,s.end_offset,s.ordinal LIMIT ?`,embeddingModel,embeddingDimensions,vault,page.id,segmentLimit+1);
  fingerprint=hash(JSON.stringify([fingerprint,segments.map(s=>[s.id,s.revision,s.projection_hash,s.content_hash,s.embedding_hash,s.updated_at,s.start_offset,s.end_offset,s.token_count,s.vector===null?null:hash(s.vector)])]));
  if(segments.length>segmentLimit)return result('error',[`This page exceeds the ${segmentLimit}-passage semantic evaluation limit.`]);
  if(!segments.length)return result('missing',['This page has no semantic passages yet.']);
  if(segments.some(s=>s.revision!==page.revision||s.projection_hash!==page.projection_hash))return result('stale',['Some saved passages belong to an earlier page projection.']);
  if(segments.some(s=>!Number.isSafeInteger(s.start_offset)||!Number.isSafeInteger(s.end_offset)||s.start_offset<0||s.end_offset<=s.start_offset||!Number.isFinite(s.token_count)||s.token_count<=0))return result('error',['The saved passage boundaries are invalid.']);
  const incomplete=segments.filter(s=>s.vector===null||s.embedding_hash!==s.content_hash);
  if(incomplete.length)return result('missing',[`${segments.length-incomplete.length} of ${segments.length} passages have current saved embeddings. Membership remains unevaluated until indexing completes.`]);
  if(collectionId) {
   const previous=store.get<{matched:number;evidence_json:string;score:number|null;state:string;fingerprint:string}>('SELECT matched,evidence_json,score,state,fingerprint FROM smart_collection_cache WHERE vault_id=? AND collection_id=? AND item_id=?',vault,collectionId,page.id);
   if(previous?.fingerprint===fingerprint&&previous.state==='evaluated'&&previous.score!==null&&Number.isFinite(previous.score)) {
    try {
     const evidence:unknown=JSON.parse(previous.evidence_json);
     if(Array.isArray(evidence)&&evidence.every(item=>typeof item==='string'))return {item_id:page.id,title:page.title,matched:!!previous.matched,evidence,state:'evaluated',score:previous.score,fingerprint};
    }catch{/* Recalculate damaged derived cache evidence from authoritative saved vectors. */}
   }
  }
  const scored=segments.map(segment=>({segment,score:vectors.score(`${vault}:semantic-segment:${segment.id}`,segment.vector!,queryVector,embeddingDimensions)}));
  if(scored.some(s=>s.score===undefined))return result('error',['A saved passage embedding is invalid. Re-index this page before evaluating membership.']);
  const retained=!!collectionId&&!!store.get('SELECT 1 FROM smart_collection_cache WHERE vault_id=? AND collection_id=? AND item_id=? AND matched=1 AND score IS NOT NULL AND fingerprint<>\'\'',vault,collectionId,page.id);
  const threshold=Math.max(0,config.threshold-(retained?0.04:0));
  // Allocate each overlap position once; token-density weighting avoids long windows
  // overpowering short sections simply because they repeat neighbouring text.
  let coveredEnd=-1,weight=0,weightedScore=0;
  for(const {segment,score} of scored) {
   const uniqueLength=Math.max(0,segment.end_offset-Math.max(coveredEnd,segment.start_offset));
   const uniqueTokens=segment.token_count*uniqueLength/(segment.end_offset-segment.start_offset);
   weight+=uniqueTokens;weightedScore+=score!*uniqueTokens;coveredEnd=Math.max(coveredEnd,segment.end_offset);
  }
  if(!weight)return result('error',['The saved passages do not contain measurable content.']);
  const score=weightedScore/weight,totalLength=unionLength(segments);
  const supporting=scored.filter(s=>s.score!>=threshold);
  const coverage=unionLength(supporting.map(s=>s.segment))/totalLength;
  const enoughPassages=segments.length===1?supporting.length===1:supporting.length>=2;
  const matched=score>=threshold&&coverage>=config.minCoverage&&enoughPassages;
  const evidence=[`Semantic support in ${supporting.length} of ${segments.length} passages, covering ${Math.round(coverage*100)}% of unique page text.`,
   matched?'Whole-page relevance and coverage meet the saved matching criteria.':'Whole-page relevance or coverage does not meet the saved matching criteria.'];
  if(retained)evidence.push('Previously matched pages use a small relevance margin to avoid membership flicker.');
  if(matched)for(const {segment} of supporting.sort((a,b)=>b.score!-a.score!||a.segment.ordinal-b.segment.ordinal).slice(0,3)) {
   const excerpt=segment.text.replace(/\s+/g,' ').trim().slice(0,220);
   evidence.push(`${segment.heading?`${segment.heading.slice(0,80)}: `:''}${excerpt}${segment.text.trim().length>220?'…':''}`);
  }
  return {item_id:page.id,title:page.title,matched,evidence,state:'evaluated',score,fingerprint};
 });
 return {items,hasMore:rows.length>limit};
}
