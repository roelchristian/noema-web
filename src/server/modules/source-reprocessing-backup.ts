import {createHash} from 'node:crypto';
import {createSynthesisReviewInput,resolveReviewedSynthesis,synthesisReviewPromptVersion} from './source-reprocessing-synthesis-review.js';
import {createSynthesisInput,parseDocumentSynthesis,synthesisPromptVersion} from './source-reprocessing-context.js';
import {planReprocessingChunks} from './source-reprocessing-planner.js';
import type {SourceReprocessingSynthesisCheckpoint,SourceReprocessingRepairCheckpoint} from './source-reprocessing-checkpoints.js';
import {sourceReprocessingEvidenceRevisionBytes} from '../../shared/source-reprocessing.js';
import {validateReprocessingEvidenceSnapshot} from './source-reprocessing-evidence-validation.js';
import {utf16Boundary,wellFormedUnicode} from './source-reprocessing-patches.js';
import {sourceStructureKinds} from '../../shared/domain.js';
import type {SourceReprocessingConfiguration,SourceReprocessingChunk,SourceReprocessingPass,SourceReprocessingRevision} from '../../shared/source-reprocessing.js';
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

export function validateReprocessingConfiguration(value:unknown):SourceReprocessingConfiguration {
 const c=object(value),e=object(c.evidence);
 oneOf(c.depth,['light','balanced','deep']);oneOf(c.reviewPolicy,['verified','review_all']);
 for(const key of ['originalPages','ocr','allowExternalTransmission'])if(typeof e[key]!=='boolean')throw invalid();
 if(c.architectureVersion!==undefined&&c.architectureVersion!==1)throw invalid();
 return {...(c.architectureVersion===1?{architectureVersion:1 as const}:{}),depth:c.depth as SourceReprocessingConfiguration['depth'],reviewPolicy:c.reviewPolicy as SourceReprocessingConfiguration['reviewPolicy'],evidence:{originalPages:e.originalPages as boolean,ocr:e.ocr as boolean,allowExternalTransmission:e.allowExternalTransmission as boolean}};
}

/** Archive checkpoints are validated against canonical revision coordinates, then ID-remapped. */
export function restoreReprocessingCheckpoints(revision:SourceReprocessingRevision,oldRevisionId:string,oldBaseHash:string,chunkValues:unknown[],passValues:unknown[]):{chunks:SourceReprocessingChunk[];passes:SourceReprocessingPass[]} {
 if(revision.pipelineVersion!==2){if(chunkValues.length||passValues.length)throw invalid();return {chunks:[],passes:[]};}
 const configuration=validateReprocessingConfiguration(revision.configuration);
 const chunks:SourceReprocessingChunk[]=[],passes:SourceReprocessingPass[]=[];
 let end=0,evidenceBytes=0;
 for(const [index,value] of array(chunkValues,128).entries()){
  const c=object(value);if(c.revisionId!==oldRevisionId||c.baseHash!==oldBaseHash||c.index!==index||integer(c.startOffset,0,revision.original.text.length)!==end)throw invalid();
  end=integer(c.endOffset,end+1,revision.original.text.length);if(!utf16Boundary(revision.original.text,c.startOffset as number)||!utf16Boundary(revision.original.text,end))throw invalid();
  if(!/^[a-f0-9]{64}$/.test(string(c.evidenceHash,64)))throw invalid();
  if(c.evidenceTrusted!==undefined&&typeof c.evidenceTrusted!=='boolean')throw invalid();
  if(c.evidence!==undefined){evidenceBytes+=Buffer.byteLength(JSON.stringify(c.evidence));if(evidenceBytes>sourceReprocessingEvidenceRevisionBytes)throw invalid();c.evidence=validateReprocessingEvidenceSnapshot(c.evidence,{text:revision.original.text,document:revision.original.document,start:c.startOffset as number,end:c.endOffset as number,configuration,evidenceHash:c.evidenceHash as string});}
  oneOf(c.difficulty,['ordinary','difficult']);if(c.difficultyReason!==null)string(c.difficultyReason,2000);
  const count=integer(c.requiredPassCount,1,3);if(configuration.depth==='light'&&count!==1||configuration.depth==='balanced'&&count!==2||configuration.depth==='deep'&&count<2||count===3&&!c.difficultyReason)throw invalid();
  oneOf(c.status,['pending','running','completed','failed','interrupted']);
  chunks.push({...structuredClone(c),revisionId:revision.id,baseHash:revision.baseHash,evidenceTrusted:false,status:c.status==='running'?'interrupted':c.status} as unknown as SourceReprocessingChunk);
 }
 if(chunks.length!==revision.report.chunksTotal||end!==revision.original.text.length)throw invalid();
 const seen=new Set<string>();
 for(const value of array(passValues,384)){
  const p=object(value),chunkIndex=integer(p.chunkIndex,0,chunks.length-1),index=integer(p.index,1,3),chunk=chunks[chunkIndex]!;
  if(p.revisionId!==oldRevisionId||index>chunk.requiredPassCount||seen.has(`${chunkIndex}:${index}`))throw invalid();seen.add(`${chunkIndex}:${index}`);
  oneOf(p.status,['running','completed','failed','interrupted']);oneOf(p.kind,['clean','reconstruct','verify','resolve']);
  if(p.kind!==(index===1?(configuration.depth==='light'?'clean':'reconstruct'):index===2?'verify':'resolve'))throw invalid();
  string(p.model,200);string(p.promptVersion,200);if(p.model!==revision.report.model||p.reasoningEffort!==revision.report.reasoningEffort||p.promptVersion!==revision.report.promptVersion)throw invalid();oneOf(p.reasoningEffort,['none','minimal','low','medium','high','xhigh','max']);
  if(JSON.stringify(validateReprocessingConfiguration(p.configuration))!==JSON.stringify(configuration)||!/^[a-f0-9]{64}$/.test(string(p.requestHash,64)))throw invalid();
  if(p.result!==null)string(p.result,256000);if(p.status==='completed'&&(p.result===null||p.finishedAt===null||p.outcomeUncertain!==false))throw invalid();
  for(const check of array(p.validation,100))string(check,2000);
  if(p.failureKind!==undefined)oneOf(p.failureKind,['transport','invalid_output','validation','evidence','admission']);
  timestamp(p.startedAt);if(p.finishedAt!==null)timestamp(p.finishedAt);if(p.error!==null)string(p.error,10000);if(typeof p.outcomeUncertain!=='boolean')throw invalid();
  for(const key of ['inputTokens','outputTokens','reasoningTokens','cachedInputTokens'])if(p[key]!==null)integer(p[key],0,Number.MAX_SAFE_INTEGER);
  const pass={...structuredClone(p),revisionId:revision.id} as unknown as SourceReprocessingPass;
  if(pass.status==='running'){pass.status='interrupted';pass.outcomeUncertain=true;pass.finishedAt=now();pass.error='Restored during a request; provider outcome is unknown.';}
  passes.push(pass);
 }
 const completedIndexes=new Set(revision.report.completedChunkIndexes??Array.from({length:revision.report.chunksCompleted},(_,index)=>index));
 if(revision.status==='completed'&&chunks.some(chunk=>chunk.status!=='completed'))throw invalid();
 for(const chunk of chunks)if((chunk.status==='completed')!==completedIndexes.has(chunk.index))throw invalid();
 for(const patch of revision.patches)if(patch.excerptIndex===undefined||!completedIndexes.has(patch.excerptIndex))throw invalid();
 for(const chunk of chunks){const successful=passes.filter(pass=>pass.chunkIndex===chunk.index&&pass.status==='completed').sort((a,b)=>a.index-b.index);if(chunk.status==='completed'&&(successful.length!==chunk.requiredPassCount||successful.some((pass,index)=>pass.index!==index+1)))throw invalid();}
 return {chunks,passes};
}

/** Repairs are separately billed, immutable lineage records; imports never transmit them. */
export function restoreReprocessingRepairs(values:unknown[],revision:SourceReprocessingRevision,oldRevisionId:string,passes:SourceReprocessingPass[]):SourceReprocessingRepairCheckpoint[] {
 const seen=new Set<string>();
 return array(values,384).map(value=>{
  const data=object(value),chunkIndex=integer(data.chunkIndex,0,127),passIndex=integer(data.passIndex,1,3);
  const parent=passes.find(pass=>pass.chunkIndex===chunkIndex&&pass.index===passIndex);
  const repairId=string(data.repairId,100);if(!repairId||seen.has(repairId)||!parent||data.revisionId!==oldRevisionId||data.kind!=='repair')throw invalid();seen.add(repairId);
  if(data.originalRequestHash!==parent.requestHash||typeof parent.result!=='string'||data.originalResultHash!==createHash('sha256').update(parent.result).digest('hex'))throw invalid();
  if(data.model!==parent.model||data.reasoningEffort!==parent.reasoningEffort||data.promptVersion!==parent.promptVersion||JSON.stringify(validateReprocessingConfiguration(data.configuration))!==JSON.stringify(revision.configuration))throw invalid();
  if(!/^[a-f0-9]{64}$/.test(string(data.requestHash,64)))throw invalid();
  oneOf(data.status,['running','completed','failed','interrupted']);timestamp(data.startedAt);if(data.finishedAt!==null)timestamp(data.finishedAt);if(data.error!==null)string(data.error,10000);
  if(typeof data.outcomeUncertain!=='boolean')throw invalid();
  if(data.result!==null)string(data.result,256000);
  if(data.status==='completed'&&(data.result===null||data.finishedAt===null||data.outcomeUncertain!==false))throw invalid();
  for(const check of array(data.validation,100))string(check,2000);
  if(data.failureKind!==undefined)oneOf(data.failureKind,['transport','invalid_output','validation','evidence','admission']);
  for(const key of ['inputTokens','outputTokens','reasoningTokens','cachedInputTokens'])if(data[key]!==null)integer(data[key],0,Number.MAX_SAFE_INTEGER);
  const repair={...structuredClone(data),revisionId:revision.id} as unknown as SourceReprocessingRepairCheckpoint;
  if(repair.status==='running'){repair.status='interrupted';repair.outcomeUncertain=true;repair.finishedAt=now();repair.error='Restored during an explicit repair; provider outcome is unknown.';}
  return repair;
 });
}

/** Preserve actual synthesis requests/results in archives without granting resumed paid work. */
export function restoreReprocessingSynthesis(value:unknown,revision:SourceReprocessingRevision,oldRevisionId:string,oldBaseHash:string,passes:SourceReprocessingPass[],repairs:SourceReprocessingRepairCheckpoint[]=[]):SourceReprocessingSynthesisCheckpoint {
 const data=object(value),configuration=validateReprocessingConfiguration(data.configuration);
 if(revision.pipelineVersion!==2||data.revisionId!==oldRevisionId||configuration.depth==='light'||JSON.stringify(configuration)!==JSON.stringify(revision.configuration))throw invalid();
 oneOf(data.status,['running','completed','failed','interrupted']);
 if(data.model!==revision.report.model||data.reasoningEffort!==revision.report.reasoningEffort)throw invalid();
 if(data.promptVersion!==synthesisPromptVersion)throw invalid();if(!/^[a-f0-9]{64}$/.test(string(data.requestHash,64)))throw invalid();
 timestamp(data.startedAt);if(data.finishedAt!==null)timestamp(data.finishedAt);if(data.error!==null)string(data.error,10000);
 if(typeof data.outcomeUncertain!=='boolean')throw invalid();
 for(const key of ['inputTokens','outputTokens','reasoningTokens','cachedInputTokens'])if(data[key]!==null)integer(data[key],0,Number.MAX_SAFE_INTEGER);
 if(data.result!==null)string(data.result,128000);
 if(data.failureKind!==undefined)oneOf(data.failureKind,['transport','invalid_output','validation','evidence','admission']);
 if(data.validation!==undefined)for(const check of array(data.validation,100))string(check,2000);
 if(data.status==='completed'&&(data.result===null||data.finishedAt===null||data.outcomeUncertain!==false))throw invalid();
 if(data.review!==undefined){
  const review=object(data.review);oneOf(review.status,['running','completed','failed','interrupted']);
  if(review.promptVersion!==synthesisReviewPromptVersion||!/^[a-f0-9]{64}$/.test(string(review.requestHash,64))||typeof review.outcomeUncertain!=='boolean')throw invalid();
  timestamp(review.startedAt);if(review.finishedAt!==null)timestamp(review.finishedAt);if(review.error!==null)string(review.error,10000);if(review.result!==null)string(review.result,128000);
  for(const key of ['inputTokens','outputTokens','reasoningTokens','cachedInputTokens'])if(review[key]!==null)integer(review[key],0,Number.MAX_SAFE_INTEGER);
  if(review.status==='completed'&&(review.result===null||review.finishedAt===null||review.outcomeUncertain!==false))throw invalid();
  if(data.status!=='completed'||typeof data.result!=='string')throw invalid();
  const chunks=planReprocessingChunks(revision.original.text,revision.original.document,8000,configuration.architectureVersion===1);
  const frozenIndexes=data.register?array(object(data.register).constituentHashes,128).map(item=>object(item).chunkIndex):null;
  const firstPasses=passes.filter(pass=>pass.index===1&&pass.status==='completed'&&pass.validation.includes('complete-canonical-block-mapping')&&(!frozenIndexes||frozenIndexes.includes(pass.chunkIndex))).map(pass=>{const repair=repairs.filter(item=>item.chunkIndex===pass.chunkIndex&&item.passIndex===1&&item.status==='completed'&&!item.outcomeUncertain&&item.validation.includes('complete-canonical-block-mapping')).at(-1);return {chunkIndex:pass.chunkIndex,result:repair?.result??pass.result!,requestHash:repair?.requestHash??pass.requestHash};});
  const input=createSynthesisInput({revisionId:oldRevisionId,baseHash:oldBaseHash,text:revision.original.text,title:revision.original.document.source.title,chunks,firstPasses});
  if(createHash('sha256').update(input.request).digest('hex')!==data.requestHash||createSynthesisReviewInput(input,data.result).requestHash!==review.requestHash)throw invalid();
 }
 if(data.register!==null){
  const chunks=planReprocessingChunks(revision.original.text,revision.original.document,8000,configuration.architectureVersion===1);
  const register=object(data.register);if(revision.report.contextHash!==undefined&&revision.report.contextHash!==register.hash)throw invalid();const constituents=array(register.constituentHashes,128).map(object);
  const firstPasses=constituents.map(item=>{const pass=passes.find(pass=>pass.index===1&&pass.chunkIndex===item.chunkIndex&&pass.requestHash===item.requestHash)??repairs.find(repair=>repair.passIndex===1&&repair.chunkIndex===item.chunkIndex&&repair.requestHash===item.requestHash&&repair.validation.includes('complete-canonical-block-mapping'));if(!pass)throw invalid();return pass;});
  if(firstPasses.some(pass=>pass.status!=='completed'||!pass.result)||firstPasses.length!==constituents.length)throw invalid();
  const input=createSynthesisInput({revisionId:oldRevisionId,baseHash:oldBaseHash,text:revision.original.text,title:revision.original.document.source.title,chunks,firstPasses:firstPasses.map(pass=>({chunkIndex:pass.chunkIndex,result:pass.result!,requestHash:pass.requestHash}))});
  if(createHash('sha256').update(input.request).digest('hex')!==data.requestHash||JSON.stringify(register.evidenceReview?resolveReviewedSynthesis(input,data.result as string,string(object(data.review).result,128000)):parseDocumentSynthesis(input,data.result as string,{isolateInvalidObservations:register.validationPolicy==='isolate-invalid-observations-v1'}))!==JSON.stringify(register))throw invalid();
 }
 const restored={...structuredClone(data),revisionId:revision.id} as unknown as SourceReprocessingSynthesisCheckpoint;
 if(restored.review?.status==='running'){restored.review.status='interrupted';restored.review.outcomeUncertain=true;restored.review.finishedAt=now();restored.review.error='Restored during summary evidence review; provider outcome is unknown.';}
 if(restored.status==='running'){restored.status='interrupted';restored.outcomeUncertain=true;restored.finishedAt=now();restored.error='Restored during synthesis; provider outcome is unknown.';}
 return restored;
}

/** Imported derivatives are rebuilt from validated evidence; archive data never starts paid jobs. */
export function restoreSourceRevision(payload:unknown,oldId:string,oldFileId:string,newId:string,newFileId:string):SourceReprocessingRevision {
 const r=object(payload);if(r.pipelineVersion!==undefined&&r.pipelineVersion!==1&&r.pipelineVersion!==2)throw invalid();if(r.pipelineVersion===2)validateReprocessingConfiguration(r.configuration);else if(r.configuration!==undefined)throw invalid();
 const original=object(r.original),text=string(original.text,512000),document=object(original.document);
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
 if(r.furniture!==undefined){
  const seenFurniture=new Set<string>();for(const value of array(r.furniture,2000)){const f=object(value),id=string(f.id,100),start=integer(f.startOffset,0,text.length),end=integer(f.endOffset,start+1,text.length),page=integer(f.page,1,pageCount??1000);if(!id||seenFurniture.has(id)||!utf16Boundary(text,start)||!utf16Boundary(text,end)||string(f.text,16000)!==text.slice(start,end)||pageAt(start)!==page||pageAt(end-1)!==page||typeof f.hidden!=='boolean')throw invalid();seenFurniture.add(id);string(f.reason,2000);}
 }
 const patches=array(r.patches,6400),patchIds=new Set<string>();
 const ordered=patches.map(value=>{
  const patch=object(value),id=string(patch.id,100),bounds=range(patch.range);
  if(patch.patchGroupId!==undefined)string(patch.patchGroupId,100);if(patch.presentation!==undefined){const presentation=object(patch.presentation);if(presentation.kind!=='page_furniture'||typeof presentation.hidden!=='boolean')throw invalid();}
  if(patch.baseHash!==undefined&&patch.baseHash!==r.baseHash)throw invalid();
  if(patch.excerptIndex!==undefined)integer(patch.excerptIndex,0,127);
  if(!utf16Boundary(text,bounds.start)||!utf16Boundary(text,bounds.end)||!wellFormedUnicode(string(patch.userReplacement??patch.replacement,16000)))throw invalid();
  if(!id||patchIds.has(id)||bounds.end<=bounds.start||string(patch.original,16000)!==text.slice(bounds.start,bounds.end))throw invalid();patchIds.add(id);
  if(pageRanges.some(page=>page.start>bounds.start&&page.start<bounds.end))throw invalid();
  if(patch.riskReasons!==undefined)for(const reason of array(patch.riskReasons,20))string(reason,2000);
  if(patch.autoAcceptance!==undefined){const evidence=object(patch.autoAcceptance);oneOf(evidence.policy,['safe_formatting','balanced','minimal_review','verified']);string(evidence.validator,100);timestamp(evidence.appliedAt);for(const check of array(evidence.checks,30))string(check,200);}
  if(patch.decisionHistory!==undefined)for(const value of array(patch.decisionHistory,100000)){const event=object(value);timestamp(event.at);oneOf(event.actor,['automatic','user']);oneOf(event.from,['pending','accepted','rejected']);oneOf(event.to,['pending','accepted','rejected']);if(event.previousReplacement!==undefined)string(event.previousReplacement,16000);if(event.replacement!==undefined)string(event.replacement,16000);}
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
 if(r.acceptanceMode!==undefined)oneOf(r.acceptanceMode,['review_all','safe_formatting','balanced','minimal_review']);
 if(r.acceptanceThreshold!==undefined&&(typeof r.acceptanceThreshold!=='number'||!Number.isFinite(r.acceptanceThreshold)||r.acceptanceThreshold<0||r.acceptanceThreshold>1))throw invalid();
 for(const key of ['startedAt','finishedAt'])if(report[key]!==null)timestamp(report[key]);
 for(const key of ['durationMs','inputTokens','outputTokens','reasoningTokens','cachedInputTokens'])if(report[key]!==null)integer(report[key],0,Number.MAX_SAFE_INTEGER);
 if(report.metadata!==undefined){
  const metadata=object(report.metadata);for(const key of ['candidateCount','added','corroborated','requiresReview'])integer(metadata[key],0,1000);
  if(typeof metadata.cacheHit!=='boolean'||!/^[a-f0-9]{64}$/.test(string(metadata.evidenceHash,64)))throw invalid();
 }
 const chunks=integer(report.chunksTotal,0,128);integer(report.chunksCompleted,0,chunks);
 if(report.stage!==undefined)oneOf(report.stage,['reconstructing','understanding','verifying','auditing']);
 if(report.stageProgress!==undefined){const progress=object(report.stageProgress);const total=integer(progress.total,0,128);integer(progress.completed,0,total);}
 if(report.contextHash!==undefined&&!/^[a-f0-9]{64}$/.test(string(report.contextHash,64)))throw invalid();
 if(report.documentAudit!==undefined){const audit=object(report.documentAudit);if(audit.version!==1||!/^[a-f0-9]{64}$/.test(string(audit.candidateHash,64)))throw invalid();if(audit.contextHash!==undefined&&audit.contextHash!==report.contextHash)throw invalid();for(const finding of array(audit.findings,1000))string(finding,10000);}
 if(report.coverage!==undefined){const coverage=object(report.coverage);if(coverage.totalChunks!==chunks)throw invalid();const completed=integer(coverage.firstPassCompleted,0,chunks),missing=array(coverage.incompleteChunkIndexes,128).map(value=>integer(value,0,chunks-1));if(new Set(missing).size!==missing.length||missing.length!==chunks-completed)throw invalid();}

 if(report.summaryValidation!==undefined){const summary=object(report.summaryValidation);if(summary.contextPreserved!==undefined&&typeof summary.contextPreserved!=='boolean')throw invalid();oneOf(summary.state,['reviewing','completed','unavailable']);const issues=integer(summary.issues,0,128),accepted=integer(summary.accepted,0,issues),unresolved=integer(summary.unresolved,0,issues);if(accepted+unresolved!==issues)throw invalid();for(const message of array(summary.diagnostics,129))string(message,10000);}
 if(report.concurrency!==undefined)integer(report.concurrency,1,2);
 if(report.evidencePreparation!==undefined){const preparation=object(report.evidencePreparation);oneOf(preparation.state,['collecting','completed']);if(integer(preparation.totalChunks,0,128)!==chunks)throw invalid();integer(preparation.preparedChunks,0,chunks);if(preparation.state==='completed'&&preparation.preparedChunks!==chunks)throw invalid();}
 if(report.completedChunkIndexes!==undefined){
  const indexes=array(report.completedChunkIndexes,128).map(value=>integer(value,0,chunks-1));
  if(new Set(indexes).size!==indexes.length||indexes.length!==report.chunksCompleted||indexes.some((value,index)=>index>0&&value<=indexes[index-1]!))throw invalid();
 }


 if(report.usageIncomplete!==undefined&&typeof report.usageIncomplete!=='boolean')throw invalid();
 if(report.sessionStartedAt!==undefined)timestamp(report.sessionStartedAt);
 if(report.errorCode!==undefined)string(report.errorCode,100);
 if(report.sessionCompletedIndexes!==undefined){const indexes=array(report.sessionCompletedIndexes,128).map(v=>integer(v,0,chunks-1));if(new Set(indexes).size!==indexes.length)throw invalid();}
 if(report.excerpts!==undefined){
  const excerpts=array(report.excerpts,128);if(excerpts.length!==chunks)throw invalid();
  let end=0;
  for(const [index,value] of excerpts.entries()){
   const excerpt=object(value);if(excerpt.index!==index||integer(excerpt.startOffset,0,text.length)!==end)throw invalid();end=integer(excerpt.endOffset,end+1,text.length);
   for(const key of ['startPage','endPage'])if(excerpt[key]!==null)integer(excerpt[key],1,pageCount??1000);
   if(excerpt.passesCompleted!==undefined)integer(excerpt.passesCompleted,0,3);if(excerpt.requiredPassCount!==undefined)integer(excerpt.requiredPassCount,1,3);if(excerpt.activePass!==undefined)integer(excerpt.activePass,1,3);if(excerpt.difficultyReason!==undefined)string(excerpt.difficultyReason,2000);
   oneOf(excerpt.status,['pending','running','completed','failed','interrupted']);integer(excerpt.attempts,0,Number.MAX_SAFE_INTEGER);integer(excerpt.durationMs,0,Number.MAX_SAFE_INTEGER);
   for(const key of ['inputTokens','outputTokens','reasoningTokens','cachedInputTokens'])if(excerpt[key]!==null)integer(excerpt[key],0,Number.MAX_SAFE_INTEGER);
   if(excerpt.lastAttemptAt!==undefined)timestamp(excerpt.lastAttemptAt);
   if(excerpt.errorCode!==undefined)string(excerpt.errorCode,100);if(excerpt.error!==undefined)string(excerpt.error,10000);if(excerpt.outcomeUncertain!==undefined&&typeof excerpt.outcomeUncertain!=='boolean')throw invalid();
   if(excerpt.history!==undefined)for(const value of array(excerpt.history,20)){
    const attempt=object(value);if(attempt.model!==undefined)string(attempt.model,200);if(attempt.reasoningEffort!==undefined)oneOf(attempt.reasoningEffort,['none','minimal','low','medium','high','xhigh','max']);timestamp(attempt.startedAt);integer(attempt.durationMs,0,Number.MAX_SAFE_INTEGER);
    for(const key of ['inputTokens','outputTokens','reasoningTokens','cachedInputTokens'])if(attempt[key]!==null)integer(attempt[key],0,Number.MAX_SAFE_INTEGER);
    if(attempt.errorCode!==undefined)string(attempt.errorCode,100);if(attempt.error!==undefined)string(attempt.error,10000);if(attempt.outcomeUncertain!==undefined&&typeof attempt.outcomeUncertain!=='boolean')throw invalid();
   }
   const completed=report.completedChunkIndexes===undefined?index<(report.chunksCompleted as number):(report.completedChunkIndexes as number[]).includes(index);
   if((excerpt.status==='completed')!==completed)throw invalid();
  }
  if(end!==text.length)throw invalid();
 }

 for(const value of patches){const patch=object(value);if(patch.excerptIndex!==undefined){const excerpt=report.excerpts===undefined?undefined:object((report.excerpts as unknown[])[patch.excerptIndex as number]);const bounds=object(patch.range);if(!excerpt||(bounds.startOffset as number)<(excerpt.startOffset as number)||(bounds.endOffset as number)>(excerpt.endOffset as number))throw invalid();}}
 if(report.charactersTotal!==text.length)throw invalid();integer(report.charactersReviewed,0,text.length);
 if(report.error!==null)string(report.error,10000);
 for(const diagnostic of array(report.diagnostics,11000))string(diagnostic,10000);
 if(report.validationDiagnostics!==undefined)for(const diagnostic of array(report.validationDiagnostics,5000))string(diagnostic,10000);
 // Keep the validated original's key order for the evidence hash. The derived variant and
 // supplied node links are intentionally discarded and deterministically reconstructed.
 const revision=structuredClone({id:r.id,fileId:r.fileId,createdAt:r.createdAt,updatedAt:r.updatedAt,status:r.status,pipelineVersion:r.pipelineVersion,configuration:r.pipelineVersion===2?validateReprocessingConfiguration(r.configuration):undefined,furniture:r.furniture,acceptanceMode:r.acceptanceMode??'review_all',acceptanceThreshold:r.acceptanceThreshold,instructions:r.instructions,baseHash:r.baseHash,stale:r.stale,original,reprocessed:original,patches,report}) as unknown as SourceReprocessingRevision;
 revision.id=newId;revision.fileId=newFileId;revision.original.document.source.fileId=newFileId;
 revision.baseHash=hash(revision.original);revision.stale=false;
 for(const patch of revision.patches)if(patch.baseHash!==undefined)patch.baseHash=revision.baseHash;
 if(revision.status==='queued'||revision.status==='running'){
  for(const excerpt of revision.report.excerpts??[])if(excerpt.status==='running'){excerpt.status='interrupted';excerpt.outcomeUncertain=true;excerpt.errorCode='provider_outcome_uncertain';excerpt.error='Restored during a request; provider outcome is unknown.';}
  revision.status='interrupted';revision.report.finishedAt=now();revision.report.error='Restored from backup. Start a new pass to continue editorial processing.';
  revision.report.diagnostics.push('Pending AI work was not restarted during backup restoration.');
 }
 materializeSourceRevision(revision);
 return revision;
}
