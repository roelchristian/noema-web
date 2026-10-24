import {sourceStructureKinds} from '../../shared/domain.js';
import type {SourceReprocessingRevision} from '../../shared/source-reprocessing.js';
import {HttpError,now} from '../validation.js';
import {materializeSourceRevision,sourceRevisionBaseHash} from './source-reprocessing.js';

type RecordValue=Record<string,unknown>;
const invalid=()=>new HttpError(400,'This backup contains an invalid source editorial revision.');
const object=(value:unknown):RecordValue=>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as RecordValue;};
const string=(value:unknown,max:number)=>{if(typeof value!=='string'||value.length>max)throw invalid();return value;};
const integer=(value:unknown,min:number,max:number)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw invalid();return value;};
const array=(value:unknown,max:number)=>{if(!Array.isArray(value)||value.length>max)throw invalid();return value as unknown[];};
const timestamp=(value:unknown)=>{const result=string(value,100);if(!Number.isFinite(Date.parse(result)))throw invalid();return result;};
const hash=(value:unknown)=>sourceRevisionBaseHash(value as SourceReprocessingRevision['original']);
const oneOf=(value:unknown,values:readonly string[])=>{if(typeof value!=='string'||!values.includes(value))throw invalid();return value;};

/** Imported derivatives are rebuilt from validated evidence; archive data never starts paid jobs. */
export function restoreSourceRevision(payload:unknown,oldId:string,oldFileId:string,newId:string,newFileId:string):SourceReprocessingRevision {
 const r=object(payload),original=object(r.original),text=string(original.text,512000),document=object(original.document);
 if(r.id!==oldId||r.fileId!==oldFileId||document.schemaVersion!==1||r.baseHash!==hash(original))throw invalid();
 timestamp(r.createdAt);timestamp(r.updatedAt);string(r.instructions,4000);
 oneOf(r.status,['queued','running','completed','failed','interrupted']);
 if(typeof r.stale!=='boolean')throw invalid();
 const source=object(document.source);
 if(source.fileId!==oldFileId)throw invalid();
 for(const key of ['name','title'])string(source[key],10000);
 string(source.format,30);if(source.language!==null)string(source.language,100);if(source.url!==null)string(source.url,4096);
 const coordinates=object(document.coordinates);
 if(coordinates.offsets!=='zero-based UTF-16, end-exclusive'||coordinates.lines!=='one-based extracted text'||coordinates.pages!=='one-based physical page order, not printed labels')throw invalid();
 const starts=[0];for(let i=0;i<text.length;i++)if(text[i]==='\r'){if(text[i+1]==='\n')i++;starts.push(i+1);}else if(text[i]==='\n')starts.push(i+1);
 const lineAt=(offset:number)=>{let low=0,high=starts.length;while(low<high){const middle=(low+high)>>>1;if(starts[middle]!<=offset)low=middle+1;else high=middle;}return Math.max(1,low);};
 const physical=object(document.physical),pages=array(physical.pages,1000);
 const pageCount=physical.pageCount===null?null:integer(physical.pageCount,0,1000);
 let physicalReady=false;const pageRanges:{start:number;end:number;number:number}[]=[];
 const pageAt=(offset:number)=>pageRanges.reduce<number|null>((last,page)=>page.start<=offset?page.number:last,null);
 const range=(value:unknown)=>{
  const v=object(value),start=integer(v.startOffset,0,text.length),end=integer(v.endOffset,start,text.length);
  if(v.startLine!==lineAt(start)||v.endLine!==lineAt(Math.max(start,end-1)))throw invalid();
  for(const key of ['startPage','endPage'])if(v[key]!==null)integer(v[key],1,pageCount??1000);
  if(v.startPage!==null&&v.endPage!==null&&(v.startPage as number)>(v.endPage as number))throw invalid();
  if(physicalReady&&(v.startPage!==pageAt(start)||v.endPage!==pageAt(Math.max(start,end-1))))throw invalid();
  return {start,end};
 };
 let priorEnd=0;
 for(const [index,value] of pages.entries()){
  const page=object(value),bounds=range(page.range);
  if(page.number!==index+1||bounds.start!==priorEnd||bounds.end===bounds.start&&index!==pages.length-1||pageCount!==null&&pages.length>pageCount)throw invalid();
  if(object(page.range).startPage!==index+1||object(page.range).endPage!==index+1)throw invalid();
  pageRanges.push({...bounds,number:index+1});priorEnd=bounds.end;
 }
 if(pages.length&&priorEnd!==text.length)throw invalid();
 physicalReady=true;
 const semantic=object(document.semantic);if(semantic.kind!=='document')throw invalid();
 const ids=new Set<string>(),nodeBounds=new Map<string,{start:number;end:number}>();let count=0;
 const nodes=(values:unknown,depth:number,parent?:{start:number;end:number})=>{
  if(depth>100)throw invalid();
  for(const value of array(values,100000)){
   if(++count>100000)throw invalid();
   const node=object(value),id=string(node.id,200),bounds=range(node.range);
   if(!id||ids.has(id)||parent&&(bounds.start<parent.start||bounds.end>parent.end))throw invalid();ids.add(id);nodeBounds.set(id,bounds);
   oneOf(node.kind,[...sourceStructureKinds,'paragraph','code','equation','list','table','blockquote','footnote']);
   if(node.title!==undefined)string(node.title,512000);
   if(node.text!==undefined){
    const stored=string(node.text,512000),raw=text.slice(bounds.start,bounds.end),normalized=raw.replace(/\r\n?/g,'\n');
    const expected=node.kind==='code'?normalized.trimEnd():node.kind==='paragraph'?normalized.trim().replace(/\s*\n\s*/g,' '):normalized.trim();
    if(stored!==raw&&stored!==expected)throw invalid();
   }
   if(node.appNumber!==undefined)string(node.appNumber,400);if(node.level!==undefined)integer(node.level,0,6);
   if(node.extent!==undefined)oneOf(node.extent,['explicit','inferred']);
   if(node.children!==undefined)nodes(node.children,depth+1,bounds);
  }
 };
 nodes(semantic.children,0);
 const processing=object(document.processing);
 oneOf(processing.text,['stored extraction','LaTeX cleaned extraction']);
 if(processing.structure!=='stored markers plus local rules'||processing.aiScope!=='bounded excerpts for long sources'||processing.inferredExtents!==true)throw invalid();
 string(processing.aiEnrichmentStatus,30);
 if(processing.math!==undefined){const math=object(processing.math);if(math.format!=='LaTeX'||!/^[a-f0-9]{64}$/.test(string(math.originalTextHash,64)))throw invalid();for(const value of array(math.uncertain,100000)){const issue=object(value);integer(issue.line,1,starts.length);string(issue.text,1000);}}
 const patches=array(r.patches,6400),patchIds=new Set<string>();
 const ordered=patches.map(value=>{
  const patch=object(value),id=string(patch.id,100),bounds=range(patch.range);
  if(!id||patchIds.has(id)||bounds.end<=bounds.start||string(patch.original,16000)!==text.slice(bounds.start,bounds.end))throw invalid();patchIds.add(id);
  if(pageRanges.some(page=>page.start>bounds.start&&page.start<bounds.end))throw invalid();
  if(patch.riskReasons!==undefined)for(const reason of array(patch.riskReasons,20))string(reason,2000);
  string(patch.replacement,16000);string(patch.reason,2000);if(patch.userReplacement!==undefined)string(patch.userReplacement,16000);
  oneOf(patch.category,['ocr','line_breaks','footnote','apparatus','metadata','citation','math','formatting']);oneOf(patch.decision,['pending','accepted','rejected']);
  if(typeof patch.confidence!=='number'||!Number.isFinite(patch.confidence)||patch.confidence<0||patch.confidence>1)throw invalid();
  const links=array(patch.nodeIds,100000);if(new Set(links).size!==links.length)throw invalid();
  for(const value of links){const target=nodeBounds.get(string(value,200));if(!target||target.start>=bounds.end||target.end<=bounds.start)throw invalid();}
  const markers=(value:string)=>value.match(/<!--\s*Page\s+\d+\s*-->/gi)??[];
  if(JSON.stringify(markers(patch.original as string))!==JSON.stringify(markers(patch.replacement as string))||patch.userReplacement!==undefined&&JSON.stringify(markers(patch.original as string))!==JSON.stringify(markers(patch.userReplacement as string)))throw invalid();
  return bounds;
 }).sort((a,b)=>a.start-b.start);
 if(ordered.some((bounds,index)=>index>0&&bounds.start<ordered[index-1]!.end))throw invalid();
 const report=object(r.report);string(report.promptVersion,200);string(report.model,200);
 oneOf(report.reasoningEffort,['none','minimal','low','medium','high','xhigh','max']);
 if(r.acceptanceMode!==undefined)oneOf(r.acceptanceMode,['review_all','safe_formatting']);
 if(r.acceptanceThreshold!==undefined&&(typeof r.acceptanceThreshold!=='number'||!Number.isFinite(r.acceptanceThreshold)||r.acceptanceThreshold<0||r.acceptanceThreshold>1))throw invalid();
 for(const key of ['startedAt','finishedAt'])if(report[key]!==null)timestamp(report[key]);
 for(const key of ['durationMs','inputTokens','outputTokens','reasoningTokens','cachedInputTokens'])if(report[key]!==null)integer(report[key],0,Number.MAX_SAFE_INTEGER);
 const chunks=integer(report.chunksTotal,0,128);integer(report.chunksCompleted,0,chunks);
 if(report.concurrency!==undefined)integer(report.concurrency,1,2);
 if(report.completedChunkIndexes!==undefined){
  const indexes=array(report.completedChunkIndexes,128).map(value=>integer(value,0,chunks-1));
  if(new Set(indexes).size!==indexes.length||indexes.length!==report.chunksCompleted||indexes.some((value,index)=>index>0&&value<=indexes[index-1]!))throw invalid();
 }

 if(report.charactersTotal!==text.length)throw invalid();integer(report.charactersReviewed,0,text.length);
 if(report.error!==null)string(report.error,10000);
 for(const diagnostic of array(report.diagnostics,11000))string(diagnostic,10000);
 if(report.validationDiagnostics!==undefined)for(const diagnostic of array(report.validationDiagnostics,5000))string(diagnostic,10000);
 // Keep the validated original's key order for the evidence hash. The derived variant and
 // supplied node links are intentionally discarded and deterministically reconstructed.
 const revision=structuredClone({id:r.id,fileId:r.fileId,createdAt:r.createdAt,updatedAt:r.updatedAt,status:r.status,acceptanceMode:r.acceptanceMode??'review_all',acceptanceThreshold:r.acceptanceThreshold,instructions:r.instructions,baseHash:r.baseHash,stale:r.stale,original,reprocessed:original,patches,report}) as unknown as SourceReprocessingRevision;
 revision.id=newId;revision.fileId=newFileId;revision.original.document.source.fileId=newFileId;
 revision.baseHash=hash(revision.original);revision.stale=false;
 if(revision.status==='queued'||revision.status==='running'){
  revision.status='interrupted';revision.report.finishedAt=now();revision.report.error='Restored from backup. Start a new pass to continue editorial processing.';
  revision.report.diagnostics.push('Pending AI work was not restarted during backup restoration.');
 }
 materializeSourceRevision(revision);
 return revision;
}
