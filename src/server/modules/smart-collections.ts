import {embeddingModel,embeddingDimensions} from '../../shared/embeddings.js';
import {SemanticCollections,semanticVector,type QueryEmbeddingProvider} from './semantic-collections.js';
import {evaluateSemanticBatch} from './smart-semantic-scoring.js';
import type {Collection,CollectionMembership,Organization} from '../../shared/domain.js';
import {parseSmartRule,type SmartRuleDefinition} from '../../shared/smart-collections.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Vaults} from './vaults.js';
import {evaluateSmartRule,validateRuleReferences} from './smart-rules.js';
type Definition={vault_id:string;collection_id:string;rule_json:string;revision:number;status:string;evaluated:number;matched:number;error:string|null;evaluated_revision:number;matching:'rules'|'semantic';semantic_json:string|null;query_vector:string|null;query_model:string|null;query_dimensions:number|null;unevaluated:number;errors:number};
export class SmartCollections {
 private running=new Set<string>();
 readonly semantic:SemanticCollections;
 constructor(private store:Store) {this.semantic=new SemanticCollections(store);}
 setQueryEmbeddingProvider(provider:QueryEmbeddingProvider){this.semantic.setProvider(provider);}
 evaluateDescription(vault:string,body:Record<string,unknown>){return this.semantic.evaluateDescription(vault,body);}
 semanticPreview(vault:string,body:Record<string,unknown>){return this.semantic.preview(vault,body);}
 private revision(vault:string){return this.store.get<{revision:number}>('SELECT revision FROM smart_collection_revisions WHERE vault_id=?',vault)?.revision??0;}
 private open(vault:string){new Vaults(this.store).requireOpen(vault);}
 definition(vault:string,id:string){return this.store.get<Definition>('SELECT * FROM smart_collection_definitions WHERE vault_id=? AND collection_id=?',vault,id);}
 parse(vault:string,input:unknown):SmartRuleDefinition {
  this.open(vault);let rule:SmartRuleDefinition;try{rule=parseSmartRule(input);}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid collection rule');}
  validateRuleReferences(this.store,vault,rule);return rule;
 }
 save(vault:string,id:string,input:unknown) {
  const rule=this.parse(vault,input);
  if(!this.store.get('SELECT id FROM collections WHERE vault_id=? AND id=?',vault,id))throw new HttpError(404,'Collection not found');
  this.store.run(`INSERT INTO smart_collection_definitions(vault_id,collection_id,rule_json) VALUES(?,?,?) ON CONFLICT(collection_id) DO UPDATE SET matching='rules',semantic_json=NULL,query_vector=NULL,query_model=NULL,query_dimensions=NULL,rule_json=excluded.rule_json,revision=revision+1,status='stale',error=NULL,evaluated_revision=-1`,vault,id,JSON.stringify(rule));
 }
 preview(vault:string,body:Record<string,unknown>) {
  const rule=this.parse(vault,body.rule),result=evaluateSmartRule(this.store,vault,rule,'',250);
  return {items:result.items.filter(item=>item.matched).slice(0,20),evaluated:result.items.length,matched:result.items.filter(item=>item.matched).length,hasMore:result.hasMore};
 }
 refresh(vault:string,id:string) {
  this.open(vault);if(!this.definition(vault,id))throw new HttpError(404,'Smart collection not found');
  this.schedule(vault,id,true);
 }
 private schedule(vault:string,id:string,force=false) {
  const key=`${vault}:${id}`,definition=this.definition(vault,id);if(!definition||this.running.has(key))return;
  if(!force&&definition.evaluated_revision===this.revision(vault)&&['ready','partial'].includes(definition.status))return;
  // A failed rule (for example a removed stable reference) requires an explicit retry
  // or a changed input revision, avoiding a hot error loop on every poll.
  if(!force&&definition.status==='error'&&definition.evaluated_revision===this.revision(vault))return;
  this.running.add(key);
  const inputRevision=this.revision(vault),ruleRevision=definition.revision;let after='',evaluated=0,matched=0,unevaluated=0,errors=0;
  const changes=this.store.all<{revision:number;item_id:string|null}>('SELECT revision,item_id FROM smart_collection_changes WHERE vault_id=? AND revision>? AND revision<=? ORDER BY revision',vault,definition.evaluated_revision,inputRevision);
  const incremental=!force&&definition.evaluated_revision>=0&&changes.length>0&&changes[0]!.revision===definition.evaluated_revision+1&&changes.every(c=>c.item_id!==null);
  const dirtyIds=incremental?[...new Set(changes.map(c=>c.item_id!))].sort():undefined;
  let dirtyOffset=0;
  if(incremental){evaluated=definition.evaluated;matched=definition.matched;unevaluated=definition.unevaluated;errors=definition.errors;}
  this.store.run("UPDATE smart_collection_definitions SET status='refreshing',error=NULL WHERE vault_id=? AND collection_id=?",vault,id);
  const finish=()=>this.running.delete(key);
  const batch=()=>{
   try {
    this.open(vault);const current=this.definition(vault,id);if(!current){finish();return;}
    if(current.revision!==ruleRevision){this.store.run("UPDATE smart_collection_definitions SET status='stale' WHERE vault_id=? AND collection_id=?",vault,id);finish();return;}
    const semantic=current.matching==='semantic',batchSize=semantic?8:100;
    const ids=dirtyIds?.slice(dirtyOffset,dirtyOffset+batchSize);
    if(semantic&&(current.query_model!==embeddingModel||current.query_dimensions!==embeddingDimensions))throw new HttpError(409,'Evaluate the semantic description again for the current embedding model');
    const result=semantic?evaluateSemanticBatch(this.store,vault,this.semantic.parse(JSON.parse(current.semantic_json!)),semanticVector(JSON.parse(current.query_vector!)),after,batchSize,ids,id):evaluateSmartRule(this.store,vault,this.parse(vault,JSON.parse(current.rule_json)),after,100,ids);
    if(dirtyIds){dirtyOffset+=batchSize;result.hasMore=dirtyOffset<dirtyIds.length;}
    this.store.transaction(()=>{
     type Cache={item_id:string;matched:number;evidence_json:string;state:string;score:number|null;fingerprint:string};
     const itemIds=ids??result.items.map(item=>item.item_id),placeholders=itemIds.map(()=>'?').join(',');
     const previous=itemIds.length?this.store.all<Cache>(`SELECT item_id,matched,evidence_json,state,score,fingerprint FROM smart_collection_cache WHERE vault_id=? AND collection_id=? AND item_id IN (${placeholders})`,vault,id,...itemIds):[];
     if(incremental) {
      evaluated-=previous.filter(item=>['evaluated','ineligible'].includes(item.state)).length;
      matched-=previous.filter(item=>item.matched).length;
      unevaluated-=previous.filter(item=>!['evaluated','ineligible'].includes(item.state)).length;
      errors-=previous.filter(item=>item.state==='error').length;
      if(itemIds.length)this.store.run(`DELETE FROM smart_collection_cache WHERE vault_id=? AND collection_id=? AND item_id IN (${placeholders})`,vault,id,...itemIds);
     }
     const oldById=new Map(previous.map(item=>[item.item_id,item]));
     for(const item of result.items) {
      const state='state' in item?item.state as string:'evaluated',gap=!['evaluated','ineligible'].includes(state),old=oldById.get(item.item_id);
      const itemMatched=gap?!!old?.matched:item.matched;
      const evidence=gap&&old?.matched?[...new Set([...JSON.parse(old.evidence_json) as string[],...item.evidence])]:item.evidence;
      const score=gap?old?.score??undefined:'score' in item?item.score as number|undefined:undefined;
      this.store.run(`INSERT INTO smart_collection_cache(vault_id,collection_id,item_id,matched,evidence_json,revision,state,score,fingerprint) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(vault_id,collection_id,item_id) DO UPDATE SET matched=excluded.matched,evidence_json=excluded.evidence_json,revision=excluded.revision,state=excluded.state,score=excluded.score,fingerprint=excluded.fingerprint`,vault,id,item.item_id,itemMatched?1:0,JSON.stringify(evidence.slice(0,8)),inputRevision,state,score??null,'fingerprint' in item?String(item.fingerprint):'');
      if(gap)unevaluated++;else evaluated++;
      if(state==='error')errors++;
      if(itemMatched)matched++;
     }
     this.store.run('UPDATE smart_collection_definitions SET evaluated=?,matched=?,unevaluated=?,errors=? WHERE vault_id=? AND collection_id=?',evaluated,matched,unevaluated,errors,vault,id);
     if(!result.hasMore){
      if(!incremental)this.store.run('DELETE FROM smart_collection_cache WHERE vault_id=? AND collection_id=? AND revision<>?',vault,id,inputRevision);
      this.store.run('UPDATE smart_collection_definitions SET status=?,evaluated_revision=?,evaluated=?,matched=?,unevaluated=?,errors=? WHERE vault_id=? AND collection_id=?',this.revision(vault)===inputRevision?(unevaluated?'partial':'ready'):'stale',inputRevision,evaluated,matched,unevaluated,errors,vault,id);
     }
    });
    if(result.hasMore){after=result.items.at(-1)?.item_id??after;setImmediate(batch);}else finish();
   } catch(error) {
    try{this.store.run("UPDATE smart_collection_definitions SET status=?,error=?,evaluated_revision=? WHERE vault_id=? AND collection_id=?",(error as {status?:number}).status===423?'stale':'error',(error as {status?:number}).status===423?null:error instanceof Error?error.message:'Evaluation failed',inputRevision,vault,id);}catch{}
    finish();
   }
  };
  if(definition.matching==='semantic'&&incremental&&!force)setTimeout(batch,300).unref();else setImmediate(batch);
 }
 decorate(vault:string,organization:Organization):Organization {
  this.open(vault);const revision=this.revision(vault);
  const definitions=this.store.all<Definition>('SELECT * FROM smart_collection_definitions WHERE vault_id=?',vault);
  if(!definitions.length)return organization;
  const byId=new Map(definitions.map(d=>[d.collection_id,d]));
  organization.collections=organization.collections.map(collection=>{
   const d=byId.get(collection.id);if(!d)return collection;
   let rule:SmartRuleDefinition|undefined,semantic:ReturnType<SemanticCollections['parse']>|undefined,definitionError:string|undefined;
   try{if(d.matching==='semantic')semantic=this.semantic.parse(JSON.parse(d.semantic_json!));else rule=parseSmartRule(JSON.parse(d.rule_json));}catch(error){definitionError=error instanceof Error?error.message:'Invalid saved collection definition';}
   const status=definitionError?'error':['ready','partial'].includes(d.status)&&d.evaluated_revision!==revision?'stale':d.status==='refreshing'&&!this.running.has(`${vault}:${d.collection_id}`)?'stale':d.status;
   return {...collection,kind:'smart',matching:d.matching,...(d.matching==='semantic'?{semantic}:{rule}),smart:{status,evaluated:d.evaluated,matched:d.matched,unevaluated:d.unevaluated,errors:d.errors,...((definitionError??d.error)?{error:definitionError??d.error}:{})}} as Collection;
  });
  const overrides=this.store.all<{kind:'page'|'entity';item_id:string;collection_id:string;decision:'include'|'exclude'}>(`SELECT o.kind,o.item_id,o.collection_id,o.decision FROM smart_collection_overrides o WHERE o.vault_id=? AND ((o.kind='page' AND EXISTS(SELECT 1 FROM pages p WHERE p.vault_id=o.vault_id AND p.id=o.item_id AND p.deleted_at IS NULL)) OR (o.kind='entity' AND EXISTS(SELECT 1 FROM entities e WHERE e.vault_id=o.vault_id AND e.id=o.item_id AND e.archived_at IS NULL AND e.inactive=0)))`,vault);
  const decision=new Map(overrides.map(o=>[`${o.collection_id}:${o.kind}:${o.item_id}`,o.decision]));
  // Existing manual memberships and folder links remain independent authoritative inputs.
  const memberships=organization.memberships.filter(m=>decision.get(`${m.collection_id}:${m.kind}:${m.item_id}`)!=='exclude').filter(m=>!byId.has(m.collection_id)||m.kind==='page'||!!this.store.get('SELECT id FROM entities WHERE vault_id=? AND id=? AND archived_at IS NULL AND inactive=0',vault,m.item_id)).map(m=>byId.has(m.collection_id)?{...m,provenance:decision.get(`${m.collection_id}:${m.kind}:${m.item_id}`)==='include'?'include' as const:'manual' as const,evidence:[decision.get(`${m.collection_id}:${m.kind}:${m.item_id}`)==='include'?'Always included by you':'Existing manual membership']}:m);
  const present=new Set(memberships.map(m=>`${m.collection_id}:${m.kind}:${m.item_id}`));
  for(const o of overrides)if(o.decision==='include'&&!present.has(`${o.collection_id}:${o.kind}:${o.item_id}`)){memberships.push({...o,provenance:'include',evidence:['Always included by you']} as CollectionMembership);present.add(`${o.collection_id}:${o.kind}:${o.item_id}`);}
  for(const row of this.store.all<{collection_id:string;item_id:string;evidence_json:string;revision:number;state:string}>(`SELECT c.collection_id,c.item_id,c.evidence_json,c.revision,c.state FROM smart_collection_cache c JOIN pages p ON p.id=c.item_id AND p.vault_id=c.vault_id WHERE c.vault_id=? AND c.matched=1 AND p.deleted_at IS NULL`,vault)) {
   const key=`${row.collection_id}:page:${row.item_id}`;if(present.has(key)||decision.get(key)==='exclude')continue;
   const d=byId.get(row.collection_id);if(!d)continue;
   memberships.push({kind:'page',item_id:row.item_id,collection_id:row.collection_id,automatic:true,provenance:d.matching==='semantic'?'semantic':'rule',evaluationState:row.state as CollectionMembership['evaluationState'],evidence:JSON.parse(row.evidence_json),stale:d.evaluated_revision!==revision||!['ready','partial'].includes(d.status)||!['evaluated','ineligible'].includes(row.state)} as CollectionMembership);
  }
  organization.memberships=memberships;organization.smartOverrides=overrides;
  for(const d of definitions)this.schedule(vault,d.collection_id);
  return organization;
 }
 override(vault:string,body:Record<string,unknown>,id:string,kind:'page'|'entity',item:string) {
  this.open(vault);if(body.reset!==undefined&&typeof body.reset!=='boolean')throw new HttpError(400,'Invalid reset flag');
  if(body.reset)this.store.run('DELETE FROM smart_collection_overrides WHERE vault_id=? AND collection_id=? AND kind=? AND item_id=?',vault,id,kind,item);
  else this.store.run(`INSERT INTO smart_collection_overrides VALUES(?,?,?,?,?) ON CONFLICT(vault_id,collection_id,kind,item_id) DO UPDATE SET decision=excluded.decision`,vault,id,kind,item,body.remove?'exclude':'include');
 }
}
