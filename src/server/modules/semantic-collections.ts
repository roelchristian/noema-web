import {parseSmartRule} from '../../shared/smart-collections.js';
import {validateRuleReferences} from './smart-rules.js';
import {evaluateHybridBatch} from './hybrid-collections.js';
import {createHash,randomUUID} from 'node:crypto';
import {embeddingModel,embeddingDimensions} from '../../shared/embeddings.js';
import {parseSemanticCollection,type SemanticCollectionDefinition} from '../../shared/smart-collections.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Vaults} from './vaults.js';
import {evaluateSemanticBatch,type SemanticResult} from './smart-semantic-scoring.js';
export type QueryEmbeddingProvider=(vault:string,description:string)=>Promise<{embedding:number[];tokens:number}>;
export const descriptionHash=(description:string)=>createHash('sha256').update(description.trim()).digest('hex');
export function semanticVector(input:unknown):number[] {
 if(!Array.isArray(input)||input.length!==embeddingDimensions||Array.from(input).some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new HttpError(400,'Invalid semantic description vector');
 const magnitude=Math.sqrt(input.reduce((sum,value)=>sum+value*value,0));if(!magnitude||!Number.isFinite(magnitude))throw new HttpError(400,'Invalid semantic description vector');
 return input;
}
type SemanticPreview={items:SemanticResult[];evaluated:number;matched:number;hasMore:boolean;unevaluated:number;errors:number};
export class SemanticCollections {
 private previewCache=new Map<string,{vault:string;epoch:number;result:SemanticPreview}>();
 clearVaultCache(vault:string){for(const [key,entry] of this.previewCache)if(entry.vault===vault)this.previewCache.delete(key);}
 private provider?:QueryEmbeddingProvider;
 private pending=new Map<string,Promise<{embedding:number[];tokens:number}>>();
 constructor(private store:Store) {}
 setProvider(provider:QueryEmbeddingProvider){this.provider=provider;}
 parse(input:unknown):SemanticCollectionDefinition {try{return parseSemanticCollection(input);}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid semantic description');}}
 private open(vault:string){
  const epoch=this.store.get<{epoch:number}>('SELECT epoch FROM smart_collection_vault_epochs WHERE vault_id=?',vault)?.epoch??0;
  for(const [key,entry] of this.previewCache)if(entry.vault===vault&&entry.epoch!==epoch)this.previewCache.delete(key);
  new Vaults(this.store).requireOpen(vault);
 }
 vector(vault:string,config:SemanticCollectionDefinition,body:Record<string,unknown>,existingId?:string):number[] {
  this.open(vault);
  if(body.evaluationToken!==undefined) {
   if(typeof body.evaluationToken!=='string')throw new HttpError(400,'Invalid description evaluation token');
   const row=this.store.get<{vector:string;model:string;dimensions:number}>('SELECT vector,model,dimensions FROM smart_collection_queries WHERE token=? AND vault_id=? AND description_hash=? AND expires_at>?',body.evaluationToken,vault,descriptionHash(config.description),Date.now());
   if(!row||row.model!==embeddingModel||row.dimensions!==embeddingDimensions)throw new HttpError(409,'Evaluate this description again before saving or previewing');
   return semanticVector(JSON.parse(row.vector));
  }
  if(existingId) {
   const row=this.store.get<{semantic_json:string;query_vector:string;query_model:string;query_dimensions:number}>("SELECT semantic_json,query_vector,query_model,query_dimensions FROM smart_collection_definitions WHERE vault_id=? AND collection_id=? AND matching IN ('semantic','hybrid')",vault,existingId);
   if(row&&row.query_model===embeddingModel&&row.query_dimensions===embeddingDimensions&&this.parse(JSON.parse(row.semantic_json)).description===config.description)return semanticVector(JSON.parse(row.query_vector));
  }
  throw new HttpError(409,'Evaluate this description before saving or previewing');
 }
 async evaluateDescription(vault:string,body:Record<string,unknown>) {
  this.open(vault);if(body.rule!==undefined){let rule;try{rule=parseSmartRule(body.rule);}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid rule');}validateRuleReferences(this.store,vault,rule);}
  const config=this.parse(body.semantic),hash=descriptionHash(config.description);
  const epoch=this.store.get<{epoch:number}>('SELECT epoch FROM smart_collection_vault_epochs WHERE vault_id=?',vault)?.epoch??0,key=`${vault}:${hash}:${epoch}`;
  this.store.run('DELETE FROM smart_collection_queries WHERE vault_id=? AND expires_at<=?',vault,Date.now());
  const cached=this.store.get<{token:string}>(`SELECT token FROM smart_collection_queries WHERE vault_id=? AND description_hash=? AND model=? AND dimensions=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1`,vault,hash,embeddingModel,embeddingDimensions,Date.now());
  if(cached)return {evaluationToken:cached.token,preview:this.preview(vault,{semantic:config,evaluationToken:cached.token,...(body.rule?{rule:body.rule}:{})}),model:embeddingModel};
  const saved=this.store.get<{query_vector:string}>(`SELECT query_vector FROM smart_collection_definitions WHERE vault_id=? AND matching IN ('semantic','hybrid') AND json_valid(semantic_json) AND json_extract(semantic_json,'$.description')=? AND query_model=? AND query_dimensions=? LIMIT 1`,vault,config.description,embeddingModel,embeddingDimensions);
  if(saved) {
   const vector=semanticVector(JSON.parse(saved.query_vector)),token=randomUUID();
   this.store.run('INSERT INTO smart_collection_queries VALUES(?,?,?,?,?,?,?)',token,vault,hash,JSON.stringify(vector),embeddingModel,embeddingDimensions,Date.now()+30*60_000);
   this.store.run('DELETE FROM smart_collection_queries WHERE vault_id=? AND token NOT IN(SELECT token FROM smart_collection_queries WHERE vault_id=? ORDER BY expires_at DESC LIMIT 32)',vault,vault);
   return {evaluationToken:token,preview:this.preview(vault,{semantic:config,evaluationToken:token,...(body.rule?{rule:body.rule}:{})}),model:embeddingModel};
  }
  if(!this.provider)throw new HttpError(409,'Semantic description evaluation is unavailable. Configure Intelligence first.');
  let work=this.pending.get(key);if(!work){work=this.provider(vault,config.description);this.pending.set(key,work);}
  let vector:number[];
  try{vector=semanticVector((await work).embedding);}finally{if(this.pending.get(key)===work)this.pending.delete(key);}
  this.open(vault);
  if((this.store.get<{epoch:number}>('SELECT epoch FROM smart_collection_vault_epochs WHERE vault_id=?',vault)?.epoch??0)!==epoch)throw new HttpError(409,'Vault locking interrupted this evaluation. Evaluate the description again.');
  const token=randomUUID();
  // Bounded, ephemeral drafts never enter vault backups. Saved definitions retain
  // their verified vector, so refresh remains local after this draft expires.
  this.store.run('INSERT INTO smart_collection_queries VALUES(?,?,?,?,?,?,?)',token,vault,hash,JSON.stringify(vector),embeddingModel,embeddingDimensions,Date.now()+30*60_000);
  this.store.run('DELETE FROM smart_collection_queries WHERE vault_id=? AND token NOT IN(SELECT token FROM smart_collection_queries WHERE vault_id=? ORDER BY expires_at DESC LIMIT 32)',vault,vault);
  return {evaluationToken:token,preview:this.preview(vault,{semantic:config,evaluationToken:token,...(body.rule?{rule:body.rule}:{})}),model:embeddingModel};
 }
 preview(vault:string,body:Record<string,unknown>) {
  this.open(vault);const config=this.parse(body.semantic),vector=this.vector(vault,config,body,typeof body.collection_id==='string'?body.collection_id:undefined);
  const epoch=this.store.get<{epoch:number}>('SELECT epoch FROM smart_collection_vault_epochs WHERE vault_id=?',vault)?.epoch??0;
  const revision=this.store.get<{revision:number}>('SELECT revision FROM smart_collection_revisions WHERE vault_id=?',vault)?.revision??0;
  const collection=typeof body.collection_id==='string'?body.collection_id:undefined;
  const definition=collection?this.store.get('SELECT revision,evaluated_revision,status,evaluated,matched FROM smart_collection_definitions WHERE vault_id=? AND collection_id=?',vault,collection):undefined;
  let rule;try{rule=body.rule!==undefined?parseSmartRule(body.rule):undefined;}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid rule');}if(rule)validateRuleReferences(this.store,vault,rule);
  const key=JSON.stringify([vault,epoch,revision,config,rule,descriptionHash(JSON.stringify(vector)),collection,definition]);
  const cached=this.previewCache.get(key);if(cached)return structuredClone(cached.result);
  // Even a cold preview is a small sample; the persisted collection refresh yields
  // after eight pages so long documents cannot monopolise the editor's server.
  const result=rule?evaluateHybridBatch(this.store,vault,rule,config,vector,'',8,undefined,collection):evaluateSemanticBatch(this.store,vault,config,vector,'',8,undefined,collection);
  const preview:SemanticPreview={items:result.items.filter(item=>item.matched&&item.state==='evaluated').slice(0,20),evaluated:result.items.filter(item=>item.state==='evaluated'||item.state==='ineligible').length,matched:result.items.filter(item=>item.matched&&item.state==='evaluated').length,hasMore:result.hasMore,unevaluated:result.items.filter(item=>!['evaluated','ineligible'].includes(item.state)).length,errors:result.items.filter(item=>item.state==='error').length};
  this.previewCache.set(key,{vault,epoch,result:preview});
  const vaultKeys=[...this.previewCache].filter(([,entry])=>entry.vault===vault).map(([key])=>key);
  for(const oldKey of vaultKeys.slice(0,Math.max(0,vaultKeys.length-32)))this.previewCache.delete(oldKey);
  while(this.previewCache.size>128)this.previewCache.delete(this.previewCache.keys().next().value!);
  return structuredClone(preview);
 }
 save(vault:string,id:string,config:SemanticCollectionDefinition,vector:number[]) {
  this.open(vault);config=this.parse(config);
  if(!this.store.get('SELECT id FROM collections WHERE vault_id=? AND id=?',vault,id))throw new HttpError(404,'Collection not found');
  this.store.run(`INSERT INTO smart_collection_definitions(vault_id,collection_id,rule_json,matching,semantic_json,query_vector,query_model,query_dimensions) VALUES(?,?,'{}','semantic',?,?,?,?) ON CONFLICT(collection_id) DO UPDATE SET matching='semantic',rule_json='{}',examples_json=NULL,semantic_json=excluded.semantic_json,query_vector=excluded.query_vector,query_model=excluded.query_model,query_dimensions=excluded.query_dimensions,revision=revision+1,status='stale',error=NULL,evaluated_revision=-1`,vault,id,JSON.stringify(config),JSON.stringify(semanticVector(vector)),embeddingModel,embeddingDimensions);
  this.store.run('UPDATE smart_collection_cache SET score=NULL WHERE vault_id=? AND collection_id=?',vault,id);
 }
}
