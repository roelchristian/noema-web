import {createHash} from 'node:crypto';
import {normalizeDoi} from '../../shared/bibliography.js';
import type {MetadataCandidate,MetadataRegistration} from '../../shared/source-metadata.js';
import type {SourceReprocessingRevision} from '../../shared/source-reprocessing.js';
import type {Store} from '../store.js';
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

interface Registrar {registerCandidate(vault:string,sourceId:string,candidate:MetadataCandidate):MetadataRegistration}
/** No provider requests: bounded evidence extraction is cached and reconciliation remains the proposal owner's job. */
export class SourceMetadataExtraction {
 constructor(private store:Store,private metadata:Registrar){}
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
