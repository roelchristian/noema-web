import type {Block,Segment,SourceFile,SourceReference} from '../../shared/domain.js';
import {sourcePreviewRank} from '../../shared/entity-evidence.js';
import type {EntityEvidence,EntitySourceEvidenceReason,EntitySourceEvidenceGroup,EntitySourcePassage} from '../../shared/entity-evidence.js';
import {sourcePageRange,sourceTextLines} from '../../shared/source-text.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Vaults} from './vaults.js';
import {mathSource,sourceTextHash} from './source-math-text.js';
import {SourcePassages,passageReference,type SourcePassage} from './source-passages.js';

const PAGE_CAP=400,CANDIDATE_CAP=500,NAME_CAP=32;
/** Literal Unicode-aware matching; aliases never become regular expressions or FTS operators. */
function nameMatcher(names:string[]) {
 const escaped=names.filter(Boolean).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+'));
 if(!escaped.length)return (_text:string)=>false;
 const pattern=new RegExp(`(?<![\\p{L}\\p{N}_])(?:${escaped.join('|')})(?![\\p{L}\\p{N}_])`,'iu');
 return (text:string)=>pattern.test(text.normalize('NFC'));
}
/** Evidence is deterministic and paid-model free. Citations require a mention in the same
 * content run (table cells are independent); page associations only admit reading anchors. */
export function entitySourceEvidence(store:Store,vault:string,entityId:string,options:{offset?:number;limit?:number;preview?:boolean}={}):EntityEvidence {
 new Vaults(store).requireOpen(vault);
 const entity=store.get<{name:string;aliases:string}>('SELECT name,aliases FROM entities WHERE id=? AND vault_id=?',entityId,vault);
 if(!entity)throw new HttpError(404,'Entity not found');
 const pageCap=options.preview?12:PAGE_CAP,candidateCap=options.preview?24:CANDIDATE_CAP;
 const allNames=[...new Set([entity.name,...JSON.parse(entity.aliases) as string[]].map(name=>name.trim().normalize('NFC')).filter(Boolean))];
 const names=allNames.slice(0,NAME_CAP),matches=nameMatcher(names);
 let truncated=allNames.length>NAME_CAP;
 const evidence=new Map<string,{sourceName:string;passage:EntitySourcePassage}>();
 const files=new Map<string,{file:SourceFile & {evidence_name:string;evidence_inactive:number};texts:Map<string,string>}|undefined>();
 const fileFor=(ref:SourceReference)=>{
  if(!files.has(ref.fileId)) {
   const file=store.get<SourceFile & {evidence_name:string;evidence_inactive:number}>(`SELECT f.*,e.name AS evidence_name,e.inactive AS evidence_inactive FROM source_files f JOIN entities e ON e.id=f.entity_id AND e.vault_id=f.vault_id
    WHERE f.id=? AND f.entity_id=? AND f.vault_id=? AND f.admitted=1 AND e.type='source'`,ref.fileId,ref.sourceId,vault);
   files.set(ref.fileId,file?{file,texts:new Map([file.text,mathSource(store,file).text].map(text=>[sourceTextHash(text),text]))}:undefined);
  }
  const result=files.get(ref.fileId);return result?.file.entity_id===ref.sourceId?result:undefined;
 };
 const add=(reference:SourceReference,reason:EntitySourceEvidenceReason,pageId?:string,heading?:string)=>{
  const source=fileFor(reference);if(!source)return;
  const text=source.texts.get(reference.sourceHash),lines=text===undefined?[]:sourceTextLines(text);
  const normalized=lines.join('\n'),start=reference.startOffset,end=reference.endOffset;
  const validLines=Number.isSafeInteger(reference.startLine)&&Number.isSafeInteger(reference.endLine)&&reference.startLine>=1&&reference.endLine>=reference.startLine&&reference.endLine<=lines.length;
  const candidates=text===undefined?[]:[text,normalized];
  const validRange=start===undefined&&end===undefined?validLines&&lines.slice(reference.startLine-1,reference.endLine).join('\n').includes(reference.excerpt):
   Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start!>=0&&end!>start!&&candidates.some(text=>end!<=text.length&&text.slice(start,end)===reference.excerpt&&sourceTextLines(text.slice(0,start)).length===reference.startLine&&reference.startLine+sourceTextLines(reference.excerpt).length-1===reference.endLine);
  const stale=!!reference.stale||source.file.status!=='ready'||!!source.file.evidence_inactive||text===undefined||!validLines||!validRange;
  let ref={...reference,stale};
  // The verified coordinate range owns navigation; a legacy node ID may name a different node.
  if(!stale)delete ref.nodeId;
  const key=JSON.stringify([ref.fileId,ref.sourceHash,ref.startOffset??ref.startLine,ref.endOffset??ref.endLine,ref.startOffset===undefined?ref.nodeId??null:null,ref.userLocator??null]),existing=evidence.get(key);
  if(existing){if(!existing.passage.reasons.includes(reason))existing.passage.reasons.push(reason);if(pageId&&!existing.passage.pageIds.includes(pageId))existing.passage.pageIds.push(pageId);return;}
  const excerptTruncated=ref.excerpt.length>6500;
  if(excerptTruncated){
   // A current preview remains an exact, independently navigable subrange. Historical
   // previews retain their original coordinates and are never offered a precise jump.
   let excerpt=ref.excerpt.slice(0,6500);
   if(/[\uD800-\uDBFF]$/.test(excerpt))excerpt=excerpt.slice(0,-1);
   if(!stale){
    const startOffset=ref.startOffset??normalized.indexOf(ref.excerpt,lines.slice(0,ref.startLine-1).join('\n').length);
    ref={...ref,excerpt,startOffset,endOffset:startOffset+excerpt.length,endLine:ref.startLine+excerpt.split('\n').length-1};
    delete ref.nodeId;
    if(source.file.format==='pdf'){
     const starts=JSON.parse(source.file.page_start_lines??'[]') as number[];
     Object.assign(ref,sourcePageRange(starts.length?starts:source.file.pages===1?[1]:[],ref.startLine,ref.endLine));
    }
   }else ref={...ref,excerpt};
  }
  evidence.set(key,{sourceName:source.file.evidence_name,passage:{id:key,reference:ref,reason,reasons:[reason],pageIds:pageId?[pageId]:[],...(excerptTruncated?{excerptTruncated:true}:{}),...(heading?{heading}:{}),stale}});
 };
 const pages=store.all<{id:string;blocks:string;associated:number}>(`SELECT p.id,p.blocks,EXISTS(SELECT 1 FROM entity_page_associations a WHERE a.page_id=p.id AND a.entity_id=?) AS associated
  FROM pages p WHERE p.vault_id=? AND p.deleted_at IS NULL AND p.archived_at IS NULL AND (EXISTS(SELECT 1 FROM entity_page_associations a WHERE a.page_id=p.id AND a.entity_id=?)
   OR EXISTS(SELECT 1 FROM json_tree(p.blocks) j WHERE j.key='entityId' AND j.value=?)) ORDER BY p.id LIMIT ?`,entityId,vault,entityId,entityId,pageCap+1);
 if(pages.length>pageCap)truncated=true;
 for(const page of pages.slice(0,pageCap)) {
  const blocks=JSON.parse(page.blocks) as Block[];let mentioned=false;
  const scan=(segments:Segment[])=>{
   if(!segments.some(segment=>segment.entityId===entityId))return;
   mentioned=true;for(const segment of segments)if(segment.sourceReference)add(segment.sourceReference,'citation',page.id);
  };
  for(const block of blocks){scan(block.content);for(const row of block.rows??[])for(const cell of row)scan(cell);}
  if(page.associated||mentioned){
   const anchor=store.get<{reference_json:string}>('SELECT reference_json FROM page_reading_notes WHERE page_id=? AND vault_id=?',page.id,vault);
   if(anchor)add(JSON.parse(anchor.reference_json) as SourceReference,'reading-note',page.id);
  }
 }
 const highlights=store.all<{reference_json:string;excerpt:string}>(`SELECT h.reference_json,h.excerpt FROM highlights h JOIN source_files f ON f.id=h.file_id AND f.entity_id=h.source_id
  JOIN entities e ON e.id=h.source_id AND e.vault_id=h.vault_id WHERE h.vault_id=? AND f.vault_id=? AND f.admitted=1 AND e.inactive=0 ORDER BY h.id LIMIT ?`,vault,vault,candidateCap+1);
 if(highlights.length>candidateCap)truncated=true;
 for(const highlight of highlights.slice(0,candidateCap))if(matches(highlight.excerpt))add(JSON.parse(highlight.reference_json) as SourceReference,'highlight');
 if(!options.preview)new SourcePassages(store).synchronize(vault);
 // Quotes are doubled inside FTS phrase literals. No raw alias can introduce an operator.
 const phrases=names.filter(name=>/[\p{L}\p{N}]/u.test(name)).map(name=>'"'+name.replaceAll('"','""')+'"');
 if(phrases.length) {
  const passages=store.all<SourcePassage>(`SELECT p.* FROM source_passages_fts JOIN source_passages p ON p.rowid=source_passages_fts.rowid
   JOIN source_files f ON f.id=p.file_id AND f.entity_id=p.source_id AND f.vault_id=p.vault_id JOIN entities e ON e.id=p.source_id AND e.vault_id=p.vault_id
   WHERE source_passages_fts MATCH ? AND p.vault_id=? AND f.admitted=1 AND f.status='ready' AND e.type='source' AND e.inactive=0 ORDER BY p.source_id,p.file_id,p.ordinal LIMIT ?`,phrases.join(' OR '),vault,candidateCap+1);
  if(passages.length>candidateCap)truncated=true;
  for(const passage of passages.slice(0,candidateCap))if(matches(passage.text))add(passageReference(passage),'source-mention',undefined,passage.heading??undefined);
 }
 const offset=Number.isSafeInteger(options.offset)?Math.max(0,options.offset!):0,limit=Number.isSafeInteger(options.limit)?Math.min(40,Math.max(1,options.limit!)):20;
 const ordered=[...evidence.values()].sort((a,b)=>a.passage.reference.sourceId.localeCompare(b.passage.reference.sourceId)||a.passage.reference.fileId.localeCompare(b.passage.reference.fileId)||a.passage.reference.startLine-b.passage.reference.startLine||a.passage.id.localeCompare(b.passage.id));
 const sourceIds=new Set<string>();
 const preview=options.preview ? [...ordered].sort((a,b)=>sourcePreviewRank(a.passage)-sourcePreviewRank(b.passage)||a.passage.reference.sourceId.localeCompare(b.passage.reference.sourceId)||a.passage.id.localeCompare(b.passage.id)).filter(item=>{const id=item.passage.reference.sourceId;if(sourceIds.has(id))return false;sourceIds.add(id);return true;}) : ordered;
 const selected=preview.slice(offset,offset+(options.preview?6:limit)),groups:EntitySourceEvidenceGroup[]=[];
 for(const {sourceName,passage} of selected){let group=groups.find(group=>group.sourceId===passage.reference.sourceId);if(!group){group={sourceId:passage.reference.sourceId,sourceName,passages:[]};groups.push(group);}group.passages.push(passage);}
 const hasMore=offset+selected.length<preview.length;
 return {groups,hasMore,...(hasMore?{nextOffset:offset+selected.length}:{}),truncated};
}
