import {createHash} from 'node:crypto';
import type {Block} from '../../shared/domain.js';
import {isAIExplanation} from '../../shared/semantic-blocks.js';
import type {ChatEvidence,ChatMention,ChatScope} from '../../shared/chat.js';
import type {PassageRetrievalResult} from '../../shared/passage-retrieval.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Vaults} from './vaults.js';
import {Embeddings} from './embeddings.js';
import {ChatKnowledge,chatFingerprint} from './chat-knowledge.js';
import {passageReference,type SourcePassage} from './source-passages.js';
import {pageSegmentReference,type PageSegment} from './page-segments.js';

const stopWords=new Set('a an the what which who whom whose how why when where do does did is are was were be been being have has had i me my mine we our you your can could should would will shall may might tell explain please about of in on at to from for with and or as this that these those it its say says written write compare comparison differ differences between across sources source notes note knowledge recorded library vault more thoroughly'.split(' '));
export function chatQueryTerms(question:string):string[]{
 return [...new Set((question.normalize('NFKC').match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)??[]).filter(term=>!stopWords.has(term.toLocaleLowerCase())))].slice(0,24);
}
const hashText=(text:string)=>createHash('sha256').update(text).digest('hex');
const sourceLocator=(reference:NonNullable<ChatEvidence['reference']>)=>reference.startPage?`Page ${reference.startPage}${reference.endPage!==reference.startPage?`–${reference.endPage}`:''}; lines ${reference.startLine}–${reference.endLine}`:`Lines ${reference.startLine}–${reference.endLine}`;
const pageLocator=(segment:PageSegment,origin:ChatEvidence['origin'])=>`${origin==='ai_generated'?'AI-generated secondary note':origin==='mixed'?'Note containing AI-generated secondary text':'Authored note'}; revision ${segment.revision}; blocks ${pageSegmentReference(segment).blockIds.join(', ')}; characters ${segment.start_offset}–${segment.end_offset}`;
function noteOrigin(page:{creation_method:string|null;ai_status:string;blocks:string;generation_metadata:string|null;ai_review_accepted:number},blockIds:string[]):'authored'|'ai_generated'|'mixed'{
 if(page.creation_method==='ai_generated'||page.ai_status==='ai_generated'||page.ai_status==='ai_generated_edited'||!!page.generation_metadata)return 'ai_generated';
 if(page.ai_status==='ai_assisted'||page.ai_review_accepted)return 'mixed';
 let blocks:Block[]=[];try{blocks=JSON.parse(page.blocks) as Block[];}catch{return 'mixed';}
 const selected=blocks.filter(block=>blockIds.includes(block.id)),generated=selected.filter(isAIExplanation);
 return generated.length?generated.length===selected.length?'ai_generated':'mixed':'authored';
}
/** Server controls every operation, bound and scope; models receive evidence only,
 * never SQL, retrieval tools or the ability to expand scope. */
export class ChatRetrieval {
 private knowledge:ChatKnowledge;
 constructor(private store:Store,private embeddings:Embeddings,private vaults:Vaults){this.knowledge=new ChatKnowledge(store);}
 validateScope(vault:string,input:unknown):ChatScope {
  this.vaults.requireOpen(vault);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'Choose a Chat scope.');
  const item=input as Record<string,unknown>;
  if(item.kind==='vault'&&Object.keys(item).every(key=>key==='kind'))return {kind:'vault'};
  if(!['page','source','entity'].includes(String(item.kind))||typeof item.id!=='string'||!item.id||item.id.length>200||Object.keys(item).some(key=>key!=='kind'&&key!=='id'))throw new HttpError(400,'Choose a valid Chat scope.');
  const scope={kind:item.kind,id:item.id} as Exclude<ChatScope,{kind:'vault'}>;
  const exists=scope.kind==='page'?this.store.get('SELECT 1 FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL',scope.id,vault):this.store.get(`SELECT 1 FROM entities WHERE id=? AND vault_id=? AND inactive=0 ${scope.kind==='source'?"AND type='source'":''}`,scope.id,vault);
  if(!exists)throw new HttpError(404,'The selected Chat scope is unavailable in this vault.');
  return scope;
 }
 async retrieve(vault:string,requestedScope:ChatScope,question:string,options:{deep?:boolean;mentions?:ChatMention[];signal?:AbortSignal}={}):Promise<{evidence:ChatEvidence[];passes:number;depth:'standard'|'deep'}>{
  const scope=this.validateScope(vault,requestedScope);
  if(typeof question!=='string'||!question.trim()||question.length>4000||Buffer.byteLength(question)>12000)throw new HttpError(400,'Ask a question up to 4,000 characters.');
  if(options.mentions!==undefined&&(!Array.isArray(options.mentions)||options.mentions.length>8))throw new HttpError(400,'Choose up to eight entity mentions.');
  const check=()=>{this.vaults.requireOpen(vault);this.validateScope(vault,scope);if(options.signal?.aborted)throw new HttpError(409,'Chat retrieval was cancelled.');};
  check();
  const resolved=this.knowledge.resolveEntities(vault,question,options.mentions??[]);
  const roots=scope.kind==='entity'?[scope.id]:scope.kind==='source'?[scope.id]:scope.kind==='vault'?resolved.map(entity=>entity.id):[];
  const context=this.knowledge.get(vault,roots);
  const passageScope=scope.kind==='vault'?undefined:scope.kind==='page'?{pageIds:[scope.id],sourceIds:[]}:scope.kind==='source'?{pageIds:[],sourceIds:[scope.id]}:{pageIds:context.pageIds,sourceIds:context.sourceIds};
  const deep=options.deep===true||/\b(compar\w*|disagree\w*|conflict\w*|tension\w*|synthesi\w*|across|differ\w*|connections)\b/i.test(question);
  const terms=chatQueryTerms(question),primary=(terms.length?terms:question.match(/[\p{L}\p{N}]+/gu)??[]).slice(0,24).join(' ').slice(0,1800);
  const queries=[primary];
  if(deep){
   // At most three deterministic passes. Entity-specific passes balance competing
   // subjects; no generated plans or model-directed tool loop exists.
   for(const entity of resolved.slice(0,2)){
    const extra=[entity.name,...terms.filter(term=>!entity.name.toLocaleLowerCase().includes(term.toLocaleLowerCase())).slice(0,5)].join(' ').slice(0,1800);
    if(!queries.includes(extra))queries.push(extra);
   }
   if(queries.length===1&&terms.length>3){queries.push(terms.slice(0,Math.ceil(terms.length/2)).join(' '),terms.slice(Math.ceil(terms.length/2)).join(' '));}
  }
  const found=new Map<string,{item:ChatEvidence;score:number}>();
  let passes=0;
  for(const query of queries.slice(0,deep?3:1)){
   if(!query)continue;
   check();
   const result=await this.embeddings.retrievePassages(vault,{query,limit:80,passageScope,matchAny:true,private:true,signal:options.signal});
   check();passes++;
   for(const row of result.results){
    // Defense in depth: a buggy retrieval adapter cannot cross the server scope.
    if(passageScope&&!((row.pageReference&&passageScope.pageIds.includes(row.pageReference.pageId))||(row.reference&&passageScope.sourceIds.includes(row.reference.sourceId))))continue;
    const item=this.passage(vault,row);
    if(!item||item.status!=='current')continue;
    const key=`${item.kind}:${row.passageId}`,previous=found.get(key);
    if(!previous||row.score>previous.score)found.set(key,{item,score:row.score});
   }
  }
  check();
  const ranked=[...found.values()].sort((a,b)=>b.score-a.score||a.item.objectId.localeCompare(b.item.objectId)||a.item.locator.localeCompare(b.item.locator));
  // Round robin per object keeps a long book from crowding out conflicting notes
  // or other sources. Fact provenance has a separate small guaranteed budget.
  const groups=new Map<string,ChatEvidence[]>();
  for(const {item} of ranked){const rows=groups.get(item.objectId)??[];rows.push(item);groups.set(item.objectId,rows);}
  const diverse:ChatEvidence[]=[];
  for(let index=0;index<(deep?5:3);index++)for(const rows of groups.values())if(rows[index])diverse.push(rows[index]!);
  const selected:ChatEvidence[]=[],seen=new Set<string>();let bytes=0;
  const facts=context.evidence;
  // Pick a few facts from each entity before additional facts from the same root.
  const factOrder:ChatEvidence[]=[];
  for(let i=0;i<24;i++)for(const id of roots){const item=facts.filter(fact=>fact.objectId===id)[i];if(item)factOrder.push(item);}
  const candidates=[...factOrder.slice(0,deep?8:6),...diverse,...factOrder.slice(deep?8:6)];
  for(const item of candidates){
   const key=`${item.kind}:${item.objectId}:${item.fingerprint}`;
   if(seen.has(key)||selected.length>=(deep?20:12))continue;
   const size=Buffer.byteLength(item.excerpt);
   if(bytes+size>48000)continue;
   seen.add(key);bytes+=size;selected.push({...item,id:`E${selected.length+1}`});
  }
  return {evidence:this.validate(vault,selected).filter(item=>item.status==='current'),passes,depth:deep?'deep':'standard'};
 }
 private passage(vault:string,row:PassageRetrievalResult):ChatEvidence|null {
  if(row.reference){
   const passage=this.store.get<SourcePassage & {name:string}>(`SELECT p.*,e.name FROM source_passages p JOIN entities e ON e.id=p.source_id AND e.vault_id=p.vault_id WHERE p.id=? AND p.vault_id=? AND e.inactive=0`,row.passageId,vault);
   if(!passage)return null;
   const reference=passageReference(passage),item:ChatEvidence={id:'',kind:'source',objectId:passage.source_id,title:passage.name,excerpt:passage.text,reference,locator:sourceLocator(reference),fingerprint:chatFingerprint(reference),status:'current'};
   return {...item,status:this.status(vault,item)};
  }
  if(row.pageReference){
   const segment=this.store.get<PageSegment & {title:string;creation_method:string|null;ai_status:string;blocks:string;generation_metadata:string|null;ai_review_accepted:number}>(`SELECT s.*,p.title,p.creation_method,p.ai_status,p.blocks,p.generation_metadata,p.ai_review_accepted FROM page_segments s JOIN pages p ON p.id=s.page_id AND p.vault_id=s.vault_id WHERE s.id=? AND s.vault_id=? AND p.deleted_at IS NULL`,row.passageId,vault);
   if(!segment)return null;
   const pageReference=pageSegmentReference(segment),origin=noteOrigin(segment,pageReference.blockIds),item:ChatEvidence={id:'',kind:'own_note',origin,objectId:segment.page_id,title:segment.title,excerpt:segment.text,pageReference,revision:segment.revision,locator:pageLocator(segment,origin),fingerprint:chatFingerprint([pageReference,origin]),status:'current'};
   return {...item,status:this.status(vault,item)};
  }
  return null;
 }
 validate(vault:string,evidence:ChatEvidence[]):ChatEvidence[]{
  this.vaults.requireOpen(vault);
  return evidence.map(original=>{
   const item=structuredClone(original),status=this.status(vault,item);
   return {...item,status:item.status==='deleted'?'deleted':item.status==='stale'&&status==='current'?'stale':status};
  });
 }
 private status(vault:string,item:ChatEvidence):ChatEvidence['status']{
  if(item.kind==='entity_fact'||item.kind==='entity_overview')return this.knowledge.validate(vault,item);
  if(item.kind==='own_note'){
   const ref=item.pageReference;
   if(!ref||ref.pageId!==item.objectId)return 'deleted';
   const page=this.store.get<{title:string;revision:number;deleted_at:string|null;creation_method:string|null;ai_status:string;blocks:string;generation_metadata:string|null;ai_review_accepted:number}>('SELECT title,revision,deleted_at,creation_method,ai_status,blocks,generation_metadata,ai_review_accepted FROM pages WHERE id=? AND vault_id=?',item.objectId,vault);
   if(!page||page.deleted_at)return 'deleted';
   if(page.revision!==ref.revision)return 'stale';
   const segment=this.store.get<PageSegment>('SELECT * FROM page_segments WHERE id=? AND page_id=? AND vault_id=?',ref.segmentId,item.objectId,vault);
   if(!segment)return 'stale';
   if(item.reference!==undefined||item.factId!==undefined||item.title!==page.title||item.locator!==pageLocator(segment,item.origin)||item.revision!==segment.revision||chatFingerprint([ref,item.origin])!==item.fingerprint)return 'stale';
   return item.fingerprint===chatFingerprint([pageSegmentReference(segment),noteOrigin(page,ref.blockIds)])&&item.origin===noteOrigin(page,ref.blockIds)&&item.excerpt===segment.text&&!this.store.get('SELECT 1 FROM page_index_dirty WHERE page_id=?',item.objectId)?'current':'stale';
  }
  const ref=item.reference;
  if(!ref||ref.sourceId!==item.objectId)return 'deleted';
  const file=this.store.get<{text:string;status:string;admitted:number;inactive:number;name:string;active_generation_id:string|null}>(`SELECT f.text,f.status,f.admitted,e.inactive,e.name,s.active_generation_id FROM source_files f JOIN entities e ON e.id=f.entity_id AND e.vault_id=f.vault_id LEFT JOIN source_passage_state s ON s.file_id=f.id WHERE f.id=? AND f.entity_id=? AND f.vault_id=?`,ref.fileId,item.objectId,vault);
  if(!file||!file.admitted||file.inactive)return 'deleted';
  if(item.pageReference!==undefined||item.factId!==undefined||item.origin!==undefined||item.revision!==undefined||item.title!==file.name||item.locator!==sourceLocator(ref)||chatFingerprint(ref)!==item.fingerprint)return 'stale';
  if(file.status!=='ready'||hashText(file.text)!==ref.sourceHash||file.active_generation_id!==ref.generationId||this.store.get('SELECT 1 FROM source_passage_dirty WHERE file_id=?',ref.fileId))return 'stale';
  const passage=this.store.get<SourcePassage>('SELECT * FROM source_passages WHERE file_id=? AND vault_id=? AND generation_id=? AND (stable_id=? OR id=?)',ref.fileId,vault,ref.generationId??'',ref.passageId??'',ref.id);
  return passage&&chatFingerprint(passageReference(passage))===item.fingerprint&&passage.text===item.excerpt?'current':'stale';
 }
}
