import {createHash} from 'node:crypto';
import {embeddingDimensions,embeddingModel} from '../../shared/embeddings.js';
import {parseExampleCollection,type ExampleCollectionDefinition} from '../../shared/example-collections.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Vaults} from './vaults.js';
import {evaluateSemanticBatch,type SemanticResult} from './smart-semantic-scoring.js';
export {parseExampleCollection};
export type {ExampleCollectionDefinition};
export interface ExampleQuery {vector:number[];negativeVectors:number[][];fingerprint:string;evidence:string[]}
interface ExamplePage {id:string;title:string;revision:number;index_revision:number|null;projection_hash:string|null;body_characters:number|null;index_error:string|null;dirty:number;minimum:number}
interface ExampleSegment {id:string;revision:number;projection_hash:string;content_hash:string;start_offset:number;end_offset:number;token_count:number;vector:string|null;embedding_hash:string|null;updated_at:string|null}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const caches=new WeakMap<Store,Map<string,{vault:string;epoch:number;query:ExampleQuery}>>();
const cosine=(left:number[],right:number[])=>left.reduce((sum,value,index)=>sum+value*right[index]!,0);
function normalized(input:unknown):number[]|undefined {
 if(!Array.isArray(input)||input.length!==embeddingDimensions||Array.from(input).some(value=>typeof value!=='number'||!Number.isFinite(value)))return;
 const magnitude=Math.sqrt(input.reduce((sum,value)=>sum+value*value,0));if(!magnitude||!Number.isFinite(magnitude))return;
 return input.map(value=>value/magnitude);
}
function parsed(input:unknown):ExampleCollectionDefinition {try{return parseExampleCollection(input);}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid example collection');}}
/** Local bounded cache, isolated by Store, vault, lock session and saved input revision. */
export function clearExampleCache(store:Store,vault:string) {const cache=caches.get(store);if(cache)for(const [key,entry] of cache)if(entry.vault===vault)cache.delete(key);}
export function prepareExampleQuery(store:Store,vault:string,input:ExampleCollectionDefinition):ExampleQuery {
 const config=parsed(input),epoch=store.get<{epoch:number}>('SELECT epoch FROM smart_collection_vault_epochs WHERE vault_id=?',vault)?.epoch??0;
 let cache=caches.get(store);if(!cache){cache=new Map();caches.set(store,cache);}
 for(const [key,entry] of cache)if(entry.vault===vault&&entry.epoch!==epoch)cache.delete(key);
 new Vaults(store).requireOpen(vault);
 const revision=store.get<{revision:number}>('SELECT revision FROM smart_collection_revisions WHERE vault_id=?',vault)?.revision??0;
 const key=JSON.stringify([vault,epoch,revision,config]),cached=cache.get(key);if(cached)return structuredClone(cached.query);
 const documents=[...config.positivePageIds,...config.negativePageIds].map(id=>{
  const page=store.get<ExamplePage>(`SELECT p.id,p.title,p.revision,i.revision AS index_revision,i.projection_hash,i.body_characters,i.error AS index_error,
   EXISTS(SELECT 1 FROM page_index_dirty d WHERE d.page_id=p.id AND d.vault_id=p.vault_id) AS dirty,
   coalesce((SELECT min_characters FROM embedding_settings WHERE vault_id=p.vault_id),20) AS minimum
   FROM pages p LEFT JOIN page_index_state i ON i.page_id=p.id AND i.vault_id=p.vault_id WHERE p.id=? AND p.vault_id=? AND p.deleted_at IS NULL`,id,vault);
  if(!page)throw new HttpError(409,'An example page is unavailable in this vault. Choose an active page.');
  const unavailable=(reason:string):never=>{throw new HttpError(409,`Example “${page.title.slice(0,120)||'Untitled'}” ${reason}`);};
  if(page.index_error)return unavailable('has an indexing error. Re-index it before using examples.');
  if(page.dirty||page.index_revision!==page.revision||!page.projection_hash)return unavailable('does not have a current index yet.');
  if((page.body_characters??0)<page.minimum)return unavailable('is below the configured indexing minimum.');
  const segments=store.all<ExampleSegment>(`SELECT s.id,s.revision,s.projection_hash,s.content_hash,s.start_offset,s.end_offset,s.token_count,
   b.vector,b.content_hash AS embedding_hash,b.updated_at FROM page_segments s
   LEFT JOIN page_segment_embeddings b ON b.segment_id=s.id AND b.model=? AND b.dimensions=?
   WHERE s.page_id=? AND s.vault_id=? ORDER BY s.start_offset,s.end_offset,s.ordinal LIMIT 513`,embeddingModel,embeddingDimensions,id,vault);
  if(!segments.length||segments.length>512)return unavailable('needs 1–512 indexed passages to be used as an example.');
  let coveredEnd=-1,totalWeight=0;const vector=Array.from({length:embeddingDimensions},()=>0);
  for(const segment of segments) {
   if(segment.revision!==page.revision||segment.projection_hash!==page.projection_hash)return unavailable('contains stale indexed passages.');
   if(segment.vector===null||segment.embedding_hash!==segment.content_hash)return unavailable('is missing current passage embeddings.');
   if(!Number.isSafeInteger(segment.start_offset)||!Number.isSafeInteger(segment.end_offset)||segment.start_offset<0||segment.end_offset<=segment.start_offset||!Number.isFinite(segment.token_count)||segment.token_count<=0)return unavailable('contains invalid passage boundaries.');
   let stored:unknown;try{stored=JSON.parse(segment.vector);}catch{return unavailable('contains an invalid saved embedding.');}
   const unit=normalized(stored);if(!unit)return unavailable('contains an invalid saved embedding.');
   const uniqueLength=Math.max(0,segment.end_offset-Math.max(coveredEnd,segment.start_offset)),weight=segment.token_count*uniqueLength/(segment.end_offset-segment.start_offset);
   for(let index=0;index<vector.length;index++)vector[index]!+=unit[index]!*weight;
   totalWeight+=weight;coveredEnd=Math.max(coveredEnd,segment.end_offset);
  }
  const unit=normalized(vector);if(!totalWeight||!unit)return unavailable('does not have a coherent document vector.');
  return {id,title:page.title,vector:unit,fingerprint:hash(JSON.stringify([page.id,page.revision,page.projection_hash,segments.map(segment=>[segment.id,segment.content_hash,segment.embedding_hash,segment.updated_at,segment.start_offset,segment.end_offset,segment.token_count,hash(segment.vector!)])]))};
 });
 const positive=documents.slice(0,config.positivePageIds.length),negative=documents.slice(config.positivePageIds.length);
 for(let left=0;left<positive.length;left++)for(let right=left+1;right<positive.length;right++)if(cosine(positive[left]!.vector,positive[right]!.vector)<.25)throw new HttpError(409,'Positive examples describe unrelated material. Choose a more coherent set of representative pages.');
 const vector=normalized(Array.from({length:embeddingDimensions},(_,index)=>positive.reduce((sum,page)=>sum+page.vector[index]!,0)))!;
 if(negative.some(page=>cosine(vector,page.vector)>=.95))throw new HttpError(409,'Positive and negative examples are too similar to distinguish reliably. Choose a clearer contrast.');
 const query:ExampleQuery={vector,negativeVectors:negative.map(page=>page.vector),fingerprint:hash(JSON.stringify([embeddingModel,embeddingDimensions,config,documents.map(page=>page.fingerprint)])),evidence:[`Based on ${positive.length} coherent positive example pages${negative.length?` and ${negative.length} contrasting negative examples`:''}.`,`Positive examples: ${positive.map(page=>page.title.slice(0,120)||'Untitled').join('; ')}`,...(negative.length?[`Negative examples: ${negative.map(page=>page.title.slice(0,120)||'Untitled').join('; ')}`]:[])]};
 cache.set(key,{vault,epoch,query});
 const vaultKeys=[...cache].filter(([,entry])=>entry.vault===vault).map(([key])=>key);for(const oldKey of vaultKeys.slice(0,Math.max(0,vaultKeys.length-32)))cache.delete(oldKey);
 while(cache.size>128)cache.delete(cache.keys().next().value!);
 return structuredClone(query);
}
/** Same document-level coverage safeguards as semantic collections; no provider work. */
export function evaluateExampleBatch(store:Store,vault:string,input:ExampleCollectionDefinition,after:string,limit:number,itemIds?:string[],collectionId?:string):{items:SemanticResult[];hasMore:boolean} {
 const config=parsed(input),query=prepareExampleQuery(store,vault,config),criteria={version:1 as const,description:'Similarity to selected representative pages',threshold:config.threshold,minCoverage:config.minCoverage};
 const result=evaluateSemanticBatch(store,vault,criteria,query.vector,after,limit,itemIds,collectionId);
 const matchedIds=result.items.filter(item=>item.state==='evaluated'&&item.matched).map(item=>item.item_id),negativeScores=new Map<string,number>();
 for(const vector of query.negativeVectors)if(matchedIds.length)for(const item of evaluateSemanticBatch(store,vault,criteria,vector,after,limit,matchedIds).items) {
  if(item.state!=='evaluated'||item.score===undefined)continue;
  negativeScores.set(item.item_id,Math.max(negativeScores.get(item.item_id)??-1,item.score));
 }
 for(const item of result.items) {
  item.fingerprint=hash(JSON.stringify([query.fingerprint,item.fingerprint]));
  if(item.state!=='evaluated')continue;
  const negative=negativeScores.get(item.item_id);
  if(item.matched&&negative!==undefined&&item.score!==undefined) {
   const separated=item.score>=negative+config.negativeMargin;item.matched=separated;
   item.evidence.push(separated?'Closer to positive examples than negative examples by the required margin.':'Too similar to a negative example to satisfy the required contrast.');
  }
  item.evidence.unshift(...query.evidence);
 }
 return result;
}
