import {createHash} from 'node:crypto';
import {normalizeDoi} from '../../shared/bibliography.js';
import type {MetadataCandidate,MetadataRegistration} from '../../shared/source-metadata.js';
import type {SourceReprocessingRevision} from '../../shared/source-reprocessing.js';
import type {Store} from '../store.js';
import {editorialMetadataFields} from './generation-request.js';
import {SourceReprocessingCheckpoints} from './source-reprocessing-checkpoints.js';
import {planReprocessingChunks} from './source-reprocessing-planner.js';
import type {PlannedReprocessingChunk} from './source-reprocessing-planner.js';
import {now} from '../validation.js';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const metadataExtractionVersion='publication-labels-v1';
export interface MetadataFact {fieldKey:string;value:string;excerpt:string;start:number;end:number;validated:boolean;validationReason:string}
export interface MetadataExtraction {evidenceHash:string;facts:MetadataFact[];charactersExamined:number}
const extractionKey=(excerpt:string,title:string)=>digest(JSON.stringify([metadataExtractionVersion,title,excerpt]));
const titleKey=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu,' ').trim();
const labels:Record<string,string>={'publication title':'title',title:'title','publication year':'year','publication date':'date',publisher:'publisher',doi:'doi',isbn:'isbn',edition:'edition',language:'language',author:'author',authors:'author',editor:'editor',editors:'editor',translator:'translator',translators:'translator'};
function validIsbn(value:string){
 const digits=value.replace(/[-\s]/g,'').toUpperCase();
 if(/^\d{13}$/.test(digits))return [...digits].reduce((sum,n,index)=>sum+Number(n)*(index%2?3:1),0)%10===0;
 if(/^\d{9}[\dX]$/.test(digits))return [...digits].reduce((sum,n,index)=>sum+(n==='X'?10:Number(n))*(10-index),0)%11===0;
 return false;
}
/** Bounded title/imprint evidence only. A mention, confidence score or bare date is never a publication assertion. */
function selectMetadataRegion(text:string,publicationTitle:string) {
 const head=text.slice(0,12000),lines=[...head.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)].filter(match=>match[0]);
 const selected:{start:number;end:number;field:string;value:string}[]=[];
 let titleSeen=false,scopeStart=0,scopeEnd=0,prefixCharacters=0,matchedTitle=false;
 for(const line of lines){
  if(head.length<text.length&&line.index!+line[0].length===head.length&&!/[\r\n]$/.test(line[0]))break;
  const raw=line[0].replace(/[\r\n]+$/,''),trimmed=raw.trim(),start=line.index!;
  if(!trimmed||/^<!--\s*Page\s+\d+\s*-->$/i.test(trimmed))continue;
  if(/^#{0,6}\s*(references|bibliography|works cited|contents|abstract|introduction|foreword|preface)\b/i.test(trimmed))break;
  const labeled=/^(?:#{1,6}\s*)?([A-Za-z ]{2,30}):\s*(\S.*)$/.exec(trimmed),field=labeled?labels[labeled[1]!.toLowerCase()]:undefined;
  if(!titleSeen){
   if(prefixCharacters>200||start>3000)break;
   const candidateTitle=field==='title'?labeled![2]!:trimmed.replace(/^#{1,6}\s*/, '');
   if(field==='title'||publicationTitle.trim()&&titleKey(candidateTitle)===titleKey(publicationTitle)){
    if(candidateTitle.length>2000)break;
    titleSeen=true;matchedTitle=!!publicationTitle.trim()&&titleKey(candidateTitle)===titleKey(publicationTitle);scopeStart=start;scopeEnd=start+raw.length;
    selected.push({start,end:scopeEnd,field:'title',value:candidateTitle});continue;
   }
   prefixCharacters+=trimmed.length;continue;
  }
  // A second title or ordinary prose ends the imprint block; later cited works cannot supply fields.
  if(!field||field==='title')break;
  if(labeled![2]!.length>2000)break;
  scopeEnd=start+raw.length;selected.push({start,end:scopeEnd,field,value:labeled![2]!});
 }
 return {excerpt:text.slice(scopeStart,scopeEnd),start:scopeStart,end:scopeEnd,selected,matchedTitle,charactersExamined:head.length};
}
export function extractSourceMetadata(text:string,publicationTitle:string):MetadataExtraction {
 const {excerpt,start:scopeStart,end:scopeEnd,selected,matchedTitle,charactersExamined}=selectMetadataRegion(text,publicationTitle),seen=new Set<string>();
 const facts:MetadataFact[]=selected.map(item=>{
  let value=item.value,valid=true,reason='Explicit publication label in a title-matched initial imprint block.';
  if(item.field==='doi'){const doi=normalizeDoi(value);valid=doi!==undefined;if(doi)value=doi;}
  if(item.field==='isbn')valid=validIsbn(value);
  if(item.field==='year')valid=/^\d{4}$/.test(value)&&Number(value)>0;
  // Preserve printed dates exactly; no composition dates, incomplete dates or guessed precision.
  if(item.field==='date')valid=/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)&&Number(value.slice(0,4))>0&&!Number.isNaN(Date.parse(value))&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value).toISOString().slice(0,10)===value);
  if(!matchedTitle){valid=false;reason='The printed publication title does not match the established Source publication title; review its scope.';}
  else if(!valid)reason='The explicitly labeled value failed deterministic identifier/date validation; review required.';
  if(seen.has(item.field)){valid=false;reason='Repeated publication labels require a decision.';}seen.add(item.field);
  return {fieldKey:'bibliography:'+item.field,value,excerpt,start:scopeStart,end:scopeEnd,validated:valid,validationReason:reason};
 });
 // Repeated single-valued labels make every competing value review-only, including the first.
 for(const fact of facts)if(facts.filter(other=>other.fieldKey===fact.fieldKey).length>1){fact.validated=false;fact.validationReason='Repeated publication labels require a decision.';}
 return {evidenceHash:extractionKey(excerpt,publicationTitle),facts,charactersExamined};
}

/** Model interpretations remain proposals. Exact source support and scope are checked
 * locally; model agreement does not promote them to independently validated facts. */
export function extractEditorialMetadata(result:string,chunk:PlannedReprocessingChunk,canonical:string):{facts:MetadataFact[];diagnostics:string[]} {
 let data:any;try{data=JSON.parse(result.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{return {facts:[],diagnostics:['Metadata candidates could not be read from the editorial response.']};}
 return extractModelMetadataCandidates(data.metadata,chunk.blocks,canonical,{limit:32,interpretation:'Editorial metadata interpretation'});
}

export interface MetadataEvidenceBlock {id:string;text:string;start:number;end:number;page?:number}
/** Shared by editorial reconstruction and direct PDF enrichment. Values may be
 * normalized; exact quotations, block identity and publication scope own evidence. */
export function extractModelMetadataCandidates(candidates:unknown,blocks:MetadataEvidenceBlock[],canonical:string,options:{limit?:number;interpretation?:string}={}):{facts:MetadataFact[];diagnostics:string[]} {
 const facts:MetadataFact[]=[],diagnostics:string[]=[];
 if(candidates===undefined)return {facts,diagnostics};
 if(!Array.isArray(candidates)||candidates.length>(options.limit??128))return {facts,diagnostics:['Metadata candidates exceeded the supported response shape.']};
 for(const item of candidates){
  const block=blocks.find(block=>block.id===item?.blockId),field=item?.field==='decision_date'?'date':item?.field;
  if(!item||!editorialMetadataFields.includes(field)||typeof item.value!=='string'||!item.value.trim()||item.value.length>2000||typeof item.quote!=='string'||!item.quote.trim()||item.quote.length>4000||typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>1000||!block||!block.text.includes(item.quote)||item.page!==undefined&&item.page!==block.page){
   diagnostics.push('A metadata candidate was excluded because its field, value, role or exact canonical quotation was invalid.');continue;
  }
  const start=canonical.indexOf(item.quote);
  if(start<block.start||start+item.quote.length>block.end||canonical.indexOf(item.quote,start+1)!==-1){diagnostics.push('A metadata candidate was excluded because its supporting quotation was ambiguous.');continue;}
  // Bibliography/body citations must not become this document's publication facts.
  const preceding=canonical.slice(0,start);
  if(/^(?:#{1,6}\s*)?(?:references|bibliography|works cited)\s*$/im.test(preceding)){
   diagnostics.push('A metadata candidate in the reference section was excluded.');continue;
  }
  facts.push({fieldKey:'bibliography:'+field,value:item.value.trim(),excerpt:item.quote,start,end:start+item.quote.length,validated:false,validationReason:(options.interpretation??'Provider metadata interpretation')+'; review the quoted document evidence and publication role. '+item.reason});
 }
 return {facts,diagnostics};
}

interface Registrar {registerCandidate(vault:string,sourceId:string,candidate:MetadataCandidate):MetadataRegistration}
/** No provider requests: bounded evidence extraction is cached and reconciliation remains the proposal owner's job. */
export class SourceMetadataExtraction {
 constructor(private store:Store,private metadata:Registrar){}
 processModelCandidates(vault:string,sourceId:string,revision:SourceReprocessingRevision){
  if(!['source-reconstruction-v2-7','source-reconstruction-v2-8','source-reconstruction-v2-9','source-reconstruction-v2-10','source-reconstruction-v2-11'].includes(revision.report.promptVersion))return;
  const checkpoints=new SourceReprocessingCheckpoints(this.store),chunks=planReprocessingChunks(revision.original.text,revision.original.document,8000,revision.configuration?.architectureVersion===1);
  const completed=new Set(revision.report.completedChunkIndexes??[]),outputs=chunks.filter(chunk=>completed.has(chunk.index)).flatMap(chunk=>{
   const pass=checkpoints.passes(revision.id,chunk.index).filter(pass=>pass.status==='completed'&&!pass.outcomeUncertain).sort((a,b)=>b.index-a.index)[0];
   if(!pass)return [];
   const repair=checkpoints.repairs(revision.id,chunk.index,pass.index).filter(value=>value.status==='completed'&&!value.outcomeUncertain&&value.validation.includes('complete-canonical-block-mapping')&&value.originalRequestHash===pass.requestHash&&value.originalResultHash===digest(pass.result??'')).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.repairId.localeCompare(b.repairId)).at(-1);
   if(!repair&&!pass.validation.includes('complete-canonical-block-mapping'))return [];
   return [{chunk,result:repair?.result??pass.result!}];
  });
  const modelEvidenceHash=digest(JSON.stringify(outputs));
  if(revision.report.metadata?.modelEvidenceHash===modelEvidenceHash)return;
  const summary=revision.report.metadata??{candidateCount:0,added:0,corroborated:0,requiresReview:0,cacheHit:false,evidenceHash:''};
  for(const {chunk,result} of outputs){
   const extraction=extractEditorialMetadata(result,chunk,revision.original.text);
   for(const message of extraction.diagnostics)if(!revision.report.diagnostics.includes(message))revision.report.diagnostics.push(message);
   const seen=new Set<string>();
   for(const fact of extraction.facts){
    const key=JSON.stringify([fact.fieldKey,fact.value,fact.excerpt]);if(seen.has(key))continue;seen.add(key);
    const outcome=this.metadata.registerCandidate(vault,sourceId,{...fact,fileId:revision.fileId,runId:revision.id,version:'canonical',revision:digest(revision.original.text),evidenceHash:digest(fact.excerpt)});
    summary.candidateCount++;
    if(outcome.registrationOutcome==='changed')summary.added++;
    else if(outcome.registrationOutcome==='satisfied')summary.corroborated++;
    else if(outcome.registrationOutcome==='pending')summary.requiresReview++;
   }
  }
  revision.report.metadata={...summary,modelEvidenceHash};
 }
 process(vault:string,sourceId:string,revision:SourceReprocessingRevision,version:'canonical'|'editorial'='canonical'){
  // Canonical evidence addresses the immutable raw extraction, including when the reader uses cleaned LaTeX.
  const canonical=this.store.get<{text:string}>('SELECT text FROM source_files WHERE id=? AND vault_id=? AND entity_id=?',revision.fileId,vault,sourceId)?.text??revision.original.text;
  const text=version==='editorial'?revision.reprocessed.text:canonical;
  const record=this.store.get<{fields_json:string}>('SELECT fields_json FROM bibliographic_records WHERE vault_id=? AND source_id=?',vault,sourceId);
  const publicationTitle=(record?JSON.parse(record.fields_json).title:undefined)??revision.original.document.source.title;
  const region=selectMetadataRegion(text,publicationTitle),evidenceHash=extractionKey(region.excerpt,publicationTitle);
  if(version==='editorial'&&revision.report.metadata?.evidenceHash===evidenceHash)return {candidateCount:0,added:0,corroborated:0,requiresReview:0,cacheHit:true,evidenceHash};
  const cached=this.store.get<{payload:string}>('SELECT payload FROM source_metadata_extraction_cache WHERE vault_id=? AND file_id=? AND evidence_hash=?',vault,revision.fileId,evidenceHash);
  const extraction=cached?JSON.parse(cached.payload) as MetadataExtraction:extractSourceMetadata(text,publicationTitle);
  if(!cached)this.store.run('INSERT OR IGNORE INTO source_metadata_extraction_cache(vault_id,file_id,evidence_hash,payload,created_at) VALUES(?,?,?,?,?)',vault,revision.fileId,evidenceHash,JSON.stringify(extraction),now());
  const summary={candidateCount:extraction.facts.length,added:0,corroborated:0,requiresReview:0,cacheHit:!!cached,evidenceHash};
  for(const fact of extraction.facts){
   const proposal=this.metadata.registerCandidate(vault,sourceId,{...fact,start:region.start,end:region.end,fileId:revision.fileId,runId:revision.id,version,revision:digest(text),evidenceHash:digest(fact.excerpt)});
   if(proposal.registrationOutcome==='changed')summary.added++;
   else if(proposal.registrationOutcome==='satisfied'&&['accepted','corroborated'].includes(proposal.status))summary.corroborated++;
   else if(proposal.registrationOutcome==='pending')summary.requiresReview++;
  }
  return summary;
 }
}
