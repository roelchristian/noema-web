import {createHash,randomUUID} from 'node:crypto';
import {entityMentionName,type Block} from '../../shared/domain.js';
import type {EntityDiscovery,EntityDiscoveryEvidence,EntityDiscoverySuggestion} from '../../shared/entity-discovery.js';
import {projectPageText} from '../../shared/page-text.js';
import type {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
import {Knowledge} from './knowledge.js';
import {Vaults} from './vaults.js';
import type {Intelligence} from './intelligence.js';
import type {AIActivityLog} from './ai-activity.js';
import {AINotifications} from './ai-notifications.js';
import {entitySourceEvidence} from './entity-source-evidence.js';

type Saved={id:string;fingerprint:string;payload:string};
type PageInput={id:string;title:string;revision:number;blocks:string;updated_at:string};
type Context=ReturnType<EntityDiscoveryService['context']>;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function bounded(value:unknown,max:number) {if(typeof value!=='string'||!value.trim()||value.length>max)throw new HttpError(502,'AI discovery returned invalid text.');return value.trim();}
/** Generated drafts are durable but never authoritative until explicitly reviewed. */
export class EntityDiscoveryService {
  constructor(private store:Store,private knowledge:Knowledge,private intelligence:Pick<Intelligence,'generate'|'selection'>,private activity:AIActivityLog) {}
  private require(vault:string,id:string) {
    new Vaults(this.store).requireOpen(vault);
    const entity=this.knowledge.require(vault,id);
    if(entity.type==='source'||entity.archived_at||entity.inactive)throw new HttpError(409,'Discovery needs an active entity homepage.');
    return entity;
  }
  /** Conservative bounded snapshot: modifications outside the selected evidence cannot silently
   * change the target catalogue while an old proposal is being accepted. Locked pages are excluded. */
  private fingerprint(vault:string,id:string) {
    this.require(vault,id);
    return hash({entities:this.store.all('SELECT id,name,type,description,aliases,updated_at,archived_at,inactive FROM entities WHERE vault_id=? ORDER BY id',vault),
      pages:this.store.all(`SELECT p.id,p.revision,p.updated_at,p.deleted_at,EXISTS(SELECT 1 FROM page_edit_locks l WHERE l.page_id=p.id) AS locked FROM pages p WHERE p.vault_id=? ORDER BY p.id`,vault),
      overview:this.store.get('SELECT content,revision FROM entity_overviews WHERE entity_id=?',id),
      associations:this.store.all('SELECT page_id,pinned,annotation FROM entity_page_associations WHERE entity_id=? ORDER BY page_id',id),
      relationships:this.store.all('SELECT id,source_id,label,target_id FROM relationships WHERE source_id=? OR target_id=? ORDER BY id',id,id),
      readingAnchors:this.store.all('SELECT page_id,reference_json FROM page_reading_notes WHERE vault_id=? ORDER BY page_id',vault),
      highlights:this.store.all('SELECT id,reference_json FROM highlights WHERE vault_id=? ORDER BY id',vault),
      cleanedSources:this.store.all('SELECT file_id,raw_hash,algorithm_version,cleaned_text,updated_at FROM source_math_documents WHERE file_id IN (SELECT id FROM source_files WHERE vault_id=?) ORDER BY file_id',vault),
      files:this.store.all('SELECT id,status,entity_id,admitted,name,text,page_start_lines,structural_nodes FROM source_files WHERE vault_id=? ORDER BY id',vault)});
  }
  context(vault:string,id:string) {
    const entity=this.require(vault,id),detail=this.knowledge.detail(vault,id);
    const names=new Map(this.knowledge.list(vault).map(e=>[e.id,entityMentionName(e)]));
    const eligible=this.store.all<{id:string;name:string;type:string;description:string}>("SELECT id,name,type,description FROM entities WHERE vault_id=? AND id<>? AND archived_at IS NULL AND inactive=0 ORDER BY name COLLATE NOCASE,id LIMIT 80",vault,id);
    const linked=new Set((detail.linkedPages??[]).map(page=>page.id));
    const pages=this.store.all<PageInput>(`SELECT p.id,p.title,p.revision,p.blocks,p.updated_at FROM pages p WHERE p.vault_id=? AND p.deleted_at IS NULL AND p.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM page_edit_locks l WHERE l.page_id=p.id)
      ORDER BY EXISTS(SELECT 1 FROM entity_page_associations a WHERE a.entity_id=? AND a.page_id=p.id) DESC,
      EXISTS(SELECT 1 FROM page_mentioned_entities m WHERE m.entity_id=? AND m.page_id=p.id) DESC,p.updated_at DESC,p.id LIMIT 24`,vault,id,id);
    const evidence:EntityDiscoveryEvidence[]=pages.flatMap(page=>{
      const text=projectPageText(JSON.parse(page.blocks) as Block[],key=>names.get(key)).text.trim();
      return text?[{id:`page:${page.id}`,kind:'page' as const,pageId:page.id,title:page.title,excerpt:text.slice(0,1600)}]:[];
    });
    const sources=entitySourceEvidence(this.store,vault,id,{limit:12});
    for(const group of sources.groups)for(const passage of group.passages)if(!passage.stale&&!this.knowledge.find(vault,group.sourceId)?.archived_at)evidence.push({id:`source:${hash(passage.id).slice(0,24)}`,kind:'source',title:group.sourceName,excerpt:passage.reference.excerpt.slice(0,2000),reference:passage.reference});
    const pageCandidates=pages.filter(page=>!linked.has(page.id)&&evidence.some(item=>item.pageId===page.id)).map(page=>({id:page.id,title:page.title}));
    return {entity:{id:entity.id,name:entity.name,type:entity.type,description:entity.description.slice(0,2000),overview:(detail.overview?.content??'').slice(0,12000)},overviewRevision:detail.overview?.revision??0,
      targets:eligible.map(target=>({...target,description:target.description.slice(0,250)})),existingRelationships:detail.relationships.slice(0,200),
      pageCandidates,evidence};
  }
  private decode(vault:string,entityId:string,row:Saved):EntityDiscovery {
    const data=JSON.parse(row.payload) as EntityDiscovery;
    return {...data,stale:row.fingerprint!==this.fingerprint(vault,entityId)};
  }
  latest(vault:string,id:string):EntityDiscovery|null {
    this.require(vault,id);
    const row=this.store.get<Saved>('SELECT id,fingerprint,payload FROM entity_discoveries WHERE entity_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',id);
    return row?this.decode(vault,id,row):null;
  }
  private parse(output:string,context:Context):EntityDiscoverySuggestion[] {
    let parsed:unknown;try{parsed=JSON.parse(output);}catch{throw new HttpError(502,'AI discovery returned invalid JSON.');}
    if(!plain(parsed)||Object.keys(parsed).some(key=>key!=='suggestions')||!Array.isArray(parsed.suggestions)||parsed.suggestions.length>12)throw new HttpError(502,'AI discovery returned invalid suggestions.');
    const seen=new Set<string>();
    return parsed.suggestions.map((input:unknown)=>{
      if(!plain(input)||!['synthesis','relationship','page'].includes(String(input.kind)))throw new HttpError(502,'AI discovery returned an unsupported suggestion.');
      const allowed=input.kind==='synthesis'?['kind','content','rationale','evidenceIds']:input.kind==='relationship'?['kind','targetId','label','rationale','evidenceIds']:['kind','pageId','rationale','evidenceIds'];
      if(Object.keys(input).some(key=>!allowed.includes(key)))throw new HttpError(502,'AI discovery returned unsupported fields.');
      if(!Array.isArray(input.evidenceIds)||!input.evidenceIds.length||input.evidenceIds.length>12||input.evidenceIds.some(value=>typeof value!=='string'||!context.evidence.some(e=>e.id===value)))throw new HttpError(502,'AI discovery cited unknown evidence.');
      const common={id:randomUUID(),status:'pending' as const,rationale:bounded(input.rationale,1000),evidenceIds:[...new Set(input.evidenceIds as string[])]};
      if(input.kind==='synthesis') {
        if(seen.has('synthesis'))throw new HttpError(502,'AI discovery returned duplicate synthesis.');seen.add('synthesis');
        return {...common,kind:'synthesis',content:bounded(input.content,12000)};
      }
      if(input.kind==='relationship') {
        const target=context.targets.find(t=>t.id===input.targetId);if(!target)throw new HttpError(502,'AI discovery proposed an unknown target.');
        const label=bounded(input.label,120),key=`link:${target.id}:${label.toLowerCase()}`;
        if(seen.has(key)||context.existingRelationships.some(link=>link.source_id===context.entity.id&&link.target_id===target.id&&link.label.toLowerCase()===label.toLowerCase()))throw new HttpError(502,'AI discovery proposed a duplicate relationship.');seen.add(key);
        return {...common,kind:'relationship',targetId:target.id,targetName:target.name,label};
      }
      const page=context.pageCandidates.find(page=>page.id===input.pageId);
      if(!page||!common.evidenceIds.some(id=>context.evidence.some(e=>e.id===id&&e.pageId===page.id)))throw new HttpError(502,'AI discovery proposed a page without its evidence.');
      if(seen.has(`page:${page.id}`))throw new HttpError(502,'AI discovery proposed a duplicate page.');seen.add(`page:${page.id}`);
      return {...common,kind:'page',pageId:page.id,pageTitle:page.title};
    });
  }
  async generate(vault:string,id:string,signal:AbortSignal):Promise<EntityDiscovery> {
    signal.throwIfAborted();
    const context=this.context(vault,id),fingerprint=this.fingerprint(vault,id);
    if(!context.evidence.length)throw new HttpError(409,'Add saved page or source evidence before requesting discovery.');
    const selection=this.intelligence.selection(),activityId=this.activity.start('entity_discovery',selection,vault,id,'entity');
    try {
      const output=await this.intelligence.generate({kind:'entityDiscovery',input:JSON.stringify({...context,evidence:context.evidence.map(({reference:_reference,...item})=>item)}),signal,onRequest:bytes=>this.activity.request(activityId,bytes,context.overviewRevision)});
      signal.throwIfAborted();
      this.require(vault,id);
      if(fingerprint!==this.fingerprint(vault,id))throw new HttpError(409,'Vault evidence changed during discovery. Generate a fresh draft.');
      const result:EntityDiscovery={id:randomUUID(),entityId:id,createdAt:now(),overviewRevision:context.overviewRevision,...selection,stale:false,evidence:context.evidence,suggestions:this.parse(output,context)};
      this.store.run('INSERT INTO entity_discoveries (id,entity_id,created_at,fingerprint,payload) VALUES (?,?,?,?,?)',result.id,id,result.createdAt,fingerprint,JSON.stringify(result));
      // Keep a small durable review history; no background generation or credentials are stored.
      this.store.run('DELETE FROM entity_discoveries WHERE entity_id=? AND id NOT IN (SELECT id FROM entity_discoveries WHERE entity_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10)',id,id);
      this.activity.finish(activityId,'completed',200);new AINotifications(this.store).recordEntity(vault,id,'completed');return result;
    }catch(error){this.activity.finish(activityId,signal.aborted?'interrupted':'failed',error instanceof HttpError?error.status:500);throw error;}
  }
  review(vault:string,id:string,discoveryId:string,body:Record<string,unknown>):EntityDiscovery {
    this.require(vault,id);
    if(typeof body.suggestionId!=='string'||!['accepted','rejected'].includes(String(body.decision)))throw new HttpError(400,'Choose a suggestion and review decision.');
    return this.store.transaction(()=>{
      const row=this.store.get<Saved>('SELECT id,fingerprint,payload FROM entity_discoveries WHERE id=? AND entity_id=?',discoveryId,id);
      if(!row)throw new HttpError(404,'Discovery draft not found.');
      const draft=this.decode(vault,id,row),suggestion=draft.suggestions.find(s=>s.id===body.suggestionId);
      if(!suggestion)throw new HttpError(404,'Discovery suggestion not found.');
      if(suggestion.status===body.decision)return draft;
      if(suggestion.status!=='pending')throw new HttpError(409,'This suggestion was already reviewed.');
      if(body.decision==='accepted') {
        if(draft.stale)throw new HttpError(409,'Evidence changed. Generate a fresh discovery draft before accepting.');
        if(suggestion.kind==='synthesis') {
          if(body.expectedOverviewRevision!==draft.overviewRevision)throw new HttpError(409,'Reload the overview before using this draft.');
          const current=this.store.get<{revision:number}>('SELECT revision FROM entity_overviews WHERE entity_id=?',id)?.revision??0;
          if(current!==body.expectedOverviewRevision)throw new HttpError(409,'The overview changed. Reload it before using this draft.');
          draft.overviewRevision=current+1;
          this.store.run('INSERT INTO entity_overviews (entity_id,content,revision) VALUES (?,?,?) ON CONFLICT(entity_id) DO UPDATE SET content=excluded.content,revision=excluded.revision',id,suggestion.content,draft.overviewRevision);
        }else if(suggestion.kind==='page') {
          if(this.store.get('SELECT 1 FROM page_edit_locks WHERE page_id=?',suggestion.pageId))throw new HttpError(423,'This page is locked.');
          if(!this.store.get('SELECT 1 FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL AND archived_at IS NULL',suggestion.pageId,vault))throw new HttpError(404,'Page not found.');
          this.store.run("INSERT OR IGNORE INTO entity_page_associations (entity_id,page_id,pinned,annotation,created_at) VALUES (?,?,0,'',?)",id,suggestion.pageId,now());
        }else {
          const target=this.knowledge.require(vault,suggestion.targetId);
          if(target.archived_at||target.inactive)throw new HttpError(409,'The target entity is no longer active.');
          if(target.id===id)throw new HttpError(400,'An entity cannot link to itself.');
          const exists=this.store.get('SELECT 1 FROM relationships WHERE source_id=? AND target_id=? AND lower(label)=lower(?)',id,target.id,suggestion.label);
          if(!exists)this.knowledge.relationship(vault,id,{target_id:target.id,label:suggestion.label});
        }
      }
      if(body.decision==='accepted'){
        const previous=this.knowledge.require(vault,id).updated_at;
        this.store.run('UPDATE entities SET updated_at=? WHERE id=?',new Date(Math.max(Date.now(),Date.parse(previous)+1)).toISOString(),id);
      }
      suggestion.status=body.decision as 'accepted'|'rejected';
      // Our own accepted edits advance this draft, while unrelated external edits remain stale.
      const fingerprint=body.decision==='accepted'?this.fingerprint(vault,id):row.fingerprint;
      draft.stale=fingerprint!==this.fingerprint(vault,id);
      this.store.run('UPDATE entity_discoveries SET fingerprint=?,payload=? WHERE id=?',fingerprint,JSON.stringify(draft),discoveryId);
      return draft;
    });
  }
}
