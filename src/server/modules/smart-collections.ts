import type {Collection,CollectionMembership,Organization} from '../../shared/domain.js';
import {parseSmartRule,type SmartRuleDefinition} from '../../shared/smart-collections.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Vaults} from './vaults.js';
import {evaluateSmartRule,validateRuleReferences} from './smart-rules.js';
type Definition={vault_id:string;collection_id:string;rule_json:string;revision:number;status:string;evaluated:number;matched:number;error:string|null;evaluated_revision:number};
export class SmartCollections {
 private running=new Set<string>();
 constructor(private store:Store) {}
 private revision(vault:string){return this.store.get<{revision:number}>('SELECT revision FROM smart_collection_revisions WHERE vault_id=?',vault)?.revision??0;}
 private open(vault:string){new Vaults(this.store).requireOpen(vault);}
 definition(vault:string,id:string){return this.store.get<Definition>('SELECT * FROM smart_collection_definitions WHERE vault_id=? AND collection_id=?',vault,id);}
 parse(vault:string,input:unknown):SmartRuleDefinition {
  this.open(vault);let rule:SmartRuleDefinition;try{rule=parseSmartRule(input);}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid collection rule');}
  validateRuleReferences(this.store,vault,rule);return rule;
 }
 save(vault:string,id:string,input:unknown) {
  const rule=this.parse(vault,input);
  this.store.run(`INSERT INTO smart_collection_definitions(vault_id,collection_id,rule_json) VALUES(?,?,?) ON CONFLICT(collection_id) DO UPDATE SET rule_json=excluded.rule_json,revision=revision+1,status='stale',error=NULL,evaluated_revision=-1`,vault,id,JSON.stringify(rule));
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
  if(!force&&definition.evaluated_revision===this.revision(vault)&&definition.status==='ready')return;
  // A failed rule (for example a removed stable reference) requires an explicit retry
  // or a changed input revision, avoiding a hot error loop on every poll.
  if(!force&&definition.status==='error'&&definition.evaluated_revision===this.revision(vault))return;
  this.running.add(key);
  const inputRevision=this.revision(vault),ruleRevision=definition.revision;let after='',evaluated=0,matched=0;
  const changes=this.store.all<{revision:number;item_id:string|null}>('SELECT revision,item_id FROM smart_collection_changes WHERE vault_id=? AND revision>? AND revision<=? ORDER BY revision',vault,definition.evaluated_revision,inputRevision);
  const incremental=!force&&definition.evaluated_revision>=0&&changes.length>0&&changes[0]!.revision===definition.evaluated_revision+1&&changes.every(c=>c.item_id!==null);
  const dirtyIds=incremental?[...new Set(changes.map(c=>c.item_id!))].sort():undefined;
  let dirtyOffset=0;
  if(incremental){evaluated=definition.evaluated;matched=definition.matched;}
  this.store.run("UPDATE smart_collection_definitions SET status='refreshing',error=NULL WHERE vault_id=? AND collection_id=?",vault,id);
  const finish=()=>this.running.delete(key);
  const batch=()=>{
   try {
    this.open(vault);const current=this.definition(vault,id);if(!current){finish();return;}
    if(current.revision!==ruleRevision){this.store.run("UPDATE smart_collection_definitions SET status='stale' WHERE vault_id=? AND collection_id=?",vault,id);finish();return;}
    const rule=this.parse(vault,JSON.parse(current.rule_json));
    const ids=dirtyIds?.slice(dirtyOffset,dirtyOffset+100);
    const result=evaluateSmartRule(this.store,vault,rule,after,100,ids);
    if(dirtyIds){dirtyOffset+=100;result.hasMore=dirtyOffset<dirtyIds.length;}
    this.store.transaction(()=>{
     if(ids?.length) {
      const placeholders=ids.map(()=>'?').join(',');
      const previous=this.store.get<{evaluated:number;matched:number}>(`SELECT COUNT(*) AS evaluated,COALESCE(SUM(matched),0) AS matched FROM smart_collection_cache WHERE vault_id=? AND collection_id=? AND item_id IN (${placeholders})`,vault,id,...ids)!;
      evaluated-=previous.evaluated;matched-=previous.matched;
      this.store.run(`DELETE FROM smart_collection_cache WHERE vault_id=? AND collection_id=? AND item_id IN (${placeholders})`,vault,id,...ids);
     }
     for(const item of result.items)this.store.run(`INSERT INTO smart_collection_cache VALUES(?,?,?,?,?,?) ON CONFLICT(vault_id,collection_id,item_id) DO UPDATE SET matched=excluded.matched,evidence_json=excluded.evidence_json,revision=excluded.revision`,vault,id,item.item_id,item.matched?1:0,JSON.stringify(item.evidence),inputRevision);
     evaluated+=result.items.length;matched+=result.items.filter(item=>item.matched).length;
     this.store.run('UPDATE smart_collection_definitions SET evaluated=?,matched=? WHERE vault_id=? AND collection_id=?',evaluated,matched,vault,id);
     if(!result.hasMore){
      if(!incremental)this.store.run('DELETE FROM smart_collection_cache WHERE vault_id=? AND collection_id=? AND revision<>?',vault,id,inputRevision);
      this.store.run('UPDATE smart_collection_definitions SET status=?,evaluated_revision=?,evaluated=?,matched=? WHERE vault_id=? AND collection_id=?',this.revision(vault)===inputRevision?'ready':'stale',inputRevision,evaluated,matched,vault,id);
     }
    });
    if(result.hasMore){after=result.items.at(-1)?.item_id??after;setImmediate(batch);}else finish();
   } catch(error) {
    try{this.store.run("UPDATE smart_collection_definitions SET status=?,error=?,evaluated_revision=? WHERE vault_id=? AND collection_id=?",(error as {status?:number}).status===423?'stale':'error',(error as {status?:number}).status===423?null:error instanceof Error?error.message:'Evaluation failed',inputRevision,vault,id);}catch{}
    finish();
   }
  };
  setImmediate(batch);
 }
 decorate(vault:string,organization:Organization):Organization {
  this.open(vault);const revision=this.revision(vault);
  const definitions=this.store.all<Definition>('SELECT * FROM smart_collection_definitions WHERE vault_id=?',vault);
  if(!definitions.length)return organization;
  const byId=new Map(definitions.map(d=>[d.collection_id,d]));
  organization.collections=organization.collections.map(collection=>{
   const d=byId.get(collection.id);if(!d)return collection;
   let rule:SmartRuleDefinition|undefined;try{rule=parseSmartRule(JSON.parse(d.rule_json));}catch{}
   const status=d.status==='ready'&&d.evaluated_revision!==revision?'stale':d.status==='refreshing'&&!this.running.has(`${vault}:${d.collection_id}`)?'stale':d.status;
   return {...collection,kind:'smart',rule,smart:{status,evaluated:d.evaluated,matched:d.matched,...(d.error?{error:d.error}:{})}} as Collection;
  });
  const overrides=this.store.all<{kind:'page'|'entity';item_id:string;collection_id:string;decision:'include'|'exclude'}>(`SELECT o.kind,o.item_id,o.collection_id,o.decision FROM smart_collection_overrides o WHERE o.vault_id=? AND ((o.kind='page' AND EXISTS(SELECT 1 FROM pages p WHERE p.vault_id=o.vault_id AND p.id=o.item_id AND p.deleted_at IS NULL)) OR (o.kind='entity' AND EXISTS(SELECT 1 FROM entities e WHERE e.vault_id=o.vault_id AND e.id=o.item_id AND e.archived_at IS NULL AND e.inactive=0)))`,vault);
  const decision=new Map(overrides.map(o=>[`${o.collection_id}:${o.kind}:${o.item_id}`,o.decision]));
  // Existing manual memberships and folder links remain independent authoritative inputs.
  const memberships=organization.memberships.filter(m=>decision.get(`${m.collection_id}:${m.kind}:${m.item_id}`)!=='exclude').filter(m=>!byId.has(m.collection_id)||m.kind==='page'||!!this.store.get('SELECT id FROM entities WHERE vault_id=? AND id=? AND archived_at IS NULL AND inactive=0',vault,m.item_id)).map(m=>byId.has(m.collection_id)?{...m,provenance:decision.get(`${m.collection_id}:${m.kind}:${m.item_id}`)==='include'?'include' as const:'manual' as const,evidence:[decision.get(`${m.collection_id}:${m.kind}:${m.item_id}`)==='include'?'Always included by you':'Existing manual membership']}:m);
  const present=new Set(memberships.map(m=>`${m.collection_id}:${m.kind}:${m.item_id}`));
  for(const o of overrides)if(o.decision==='include'&&!present.has(`${o.collection_id}:${o.kind}:${o.item_id}`)){memberships.push({...o,provenance:'include',evidence:['Always included by you']} as CollectionMembership);present.add(`${o.collection_id}:${o.kind}:${o.item_id}`);}
  for(const row of this.store.all<{collection_id:string;item_id:string;evidence_json:string;revision:number}>(`SELECT c.collection_id,c.item_id,c.evidence_json,c.revision FROM smart_collection_cache c JOIN pages p ON p.id=c.item_id AND p.vault_id=c.vault_id WHERE c.vault_id=? AND c.matched=1 AND p.deleted_at IS NULL`,vault)) {
   const key=`${row.collection_id}:page:${row.item_id}`;if(present.has(key)||decision.get(key)==='exclude')continue;
   const d=byId.get(row.collection_id);if(!d)continue;
   memberships.push({kind:'page',item_id:row.item_id,collection_id:row.collection_id,automatic:true,provenance:'rule',evidence:JSON.parse(row.evidence_json),stale:d.evaluated_revision!==revision||d.status!=='ready'} as CollectionMembership);
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
