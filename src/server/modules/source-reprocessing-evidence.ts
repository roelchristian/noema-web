import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {sourceDocumentEntries} from '../../shared/source-document.js';
import type {SourceDocument} from '../../shared/source-document.js';
import type {SourceReprocessingConfiguration} from '../../shared/source-reprocessing.js';

export type ReconstructionEvidence=SourceReprocessingEvidenceSnapshot;
/** Current renderer supplies viewing assets only. Never imply OCR or image capability, nor
 * send original assets merely because a source is admitted for local reading. */
export function gatherReprocessingEvidence(input:{text:string;document:SourceDocument;start:number;end:number;options?:SourceReprocessingConfiguration['evidence']}):ReconstructionEvidence{
 const {text,document,start,end,options}=input;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>text.length)throw new Error('Invalid evidence coordinates.');
 const canonicalText=text.slice(start,end),pageNumbers=document.physical.pages.filter(page=>page.range.startOffset<end&&page.range.endOffset>start).map(page=>page.number);
 const originalPages={available:false as const,reason:options?.originalPages?'Original-page model evidence adapter is unavailable; local viewing does not grant transmission consent.':'Original-page evidence was not requested.'};
 const ocr={available:false as const,reason:options?.ocr?'No independent OCR evidence adapter is available. Stored extraction is not independent OCR corroboration.':'Independent OCR evidence was not requested.'};
 const diagnostics=[originalPages.reason,ocr.reason];
 if(options?.allowExternalTransmission)diagnostics.push('External original-asset transmission is unavailable in this pipeline; no assets were transmitted.');
 return snapshot({version:1,canonicalText,pageNumbers,originalPages,ocr,independentlyVerified:false,externalTransmissionAllowed:false,diagnostics});
}

import type {SourceFiles} from './source-files.js';
import type {SourcePageImages} from './source-page-images.js';
import {HttpError} from '../validation.js';
import {NativeReprocessingOCR,validateOCRResult,type ReprocessingOCRBackend} from './source-reprocessing-native-evidence.js';
import type {SourceReprocessingEvidenceSnapshot} from '../../shared/source-reprocessing.js';

/** Capability-backed adapter. The image renderer reads admitted assets only; the binding
 * verifies preserved original and admitted checksums before and after every collection. */
export class SourceReprocessingEvidence {
 private pendingLayout=new Set<string>();private layoutCache=new Map<string,Promise<{text:string;bounds:number[]}[]>>();
 private closed=false;private pendingOCR=new Set<string>();private ocrCache=new Map<string,Promise<ReturnType<typeof validateOCRResult>>>();
 constructor(private files:Pick<SourceFiles,'require'|'reprocessingEvidenceBinding'>,private images:Pick<SourcePageImages,'get'>&Partial<Pick<SourcePageImages,'layout'>>,private backend:ReprocessingOCRBackend=new NativeReprocessingOCR(),private imagesAvailable=process.platform==='darwin'&&existsSync('/usr/bin/swiftc')&&existsSync('/usr/bin/sandbox-exec')){}
 capabilities(vault?:string,id?:string){
  let reason=this.imagesAvailable?'Original-page rendering and separate on-device raster OCR are supported.':'Original-page rendering and local OCR currently require macOS.',supported=this.imagesAvailable;
  if(vault&&id)try{const file=this.files.require(vault,id),binding=this.files.reprocessingEvidenceBinding(vault,id),normalization=binding.manifest.normalization as {text?:unknown;offsetMap?:unknown;provenanceAvailable?:unknown}|undefined;if(file.format!=='pdf'||file.status!=='ready'||file.admitted!==1||!file.pages||normalization?.text!==file.text||normalization.provenanceAvailable===false||!Array.isArray(normalization.offsetMap))throw new Error('Source evidence requires an admitted PDF with exact canonical provenance.');}catch(error){supported=false;reason=error instanceof Error?error.message:'Source evidence provenance is unavailable.';}
  return {originalPages:supported,ocr:supported&&this.backend.available,externalImages:supported,reason};
 }
 async collect(vault:string,id:string,input:{text:string;document:SourceDocument;start:number;end:number;options?:SourceReprocessingConfiguration['evidence']},signal:AbortSignal):Promise<SourceReprocessingEvidenceSnapshot>{
  if(this.closed)throw new HttpError(503,'Evidence collection is closed.');
  const baseline=gatherReprocessingEvidence(input),options=input.options;
  if(!options?.originalPages&&!options?.ocr){const {hash:_,...rest}=baseline;return snapshot(rest);}
  const capability=this.capabilities(vault,id);if(options.originalPages&&!capability.originalPages||options.ocr&&!capability.ocr)throw new HttpError(501,capability.reason);
  if(options.originalPages&&!options.allowExternalTransmission)throw new HttpError(400,'Sending original-page images requires explicit transmission consent.');
  if(signal.aborted)throw new HttpError(409,'Evidence collection cancelled.');
  const binding=this.files.reprocessingEvidenceBinding(vault,id),file=this.files.require(vault,id);
  if(input.text!==file.text||input.document.source.fileId!==id)throw new HttpError(409,'Canonical evidence snapshot no longer matches the source.');
  const normalization=binding.manifest.normalization as {text?:unknown;provenanceAvailable?:unknown;offsetMap?:unknown}|undefined;
  if(normalization?.text!==input.text||normalization.provenanceAvailable===false||!Array.isArray(normalization.offsetMap))throw new HttpError(409,'Canonical extraction provenance mapping is unavailable.');
  if(!baseline.pageNumbers.length||baseline.pageNumbers.length>2)throw new HttpError(409,'Evidence requires at most two exact physical pages per chunk.');
  const pages:NonNullable<SourceReprocessingEvidenceSnapshot['pages']>=[],images:NonNullable<SourceReprocessingEvidenceSnapshot['images']>=[];
  const raw=binding.manifest.rawExtraction as {pageEvidence?:{page:number;method:string;coordinateSystem?:string}[]}|undefined;
  for(const page of baseline.pageNumbers){
   if(signal.aborted)throw new HttpError(409,'Evidence collection cancelled.');
   const canonicalPage=input.document.physical.pages.find(value=>value.number===page);
   const spans=(normalization.offsetMap as Record<string,unknown>[]).filter(span=>span.pageNumber===page&&typeof span.normalizedStart==='number'&&typeof span.normalizedEnd==='number'&&span.normalizedStart<input.end&&span.normalizedEnd>input.start);
   if(!canonicalPage||!spans.length)throw new HttpError(409,'Exact page-to-canonical provenance mapping is unavailable.');
   const bytes=await abortable(this.images.get(vault,id,page),signal);if(signal.aborted)throw new HttpError(409,'Evidence collection cancelled.');
   if(bytes.length>2*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new HttpError(502,'Invalid bounded source page image.');
   const imageHash=createHash('sha256').update(bytes).digest('hex'),provenance:NonNullable<SourceReprocessingEvidenceSnapshot['pages']>[number]={page,originalHash:binding.originalHash,admittedHash:binding.admittedHash,imageHash,canonicalRanges:spans.map(span=>({startOffset:Math.max(input.start,canonicalPage.range.startOffset,span.normalizedStart as number),endOffset:Math.min(input.end,canonicalPage.range.endOffset,span.normalizedEnd as number)})).filter(span=>span.endOffset>span.startOffset)};
   if(this.images.layout){
    const layoutKey=`${binding.admittedHash}:${page}:${imageHash}`;let layout=this.layoutCache.get(layoutKey);
    if(!layout){
     if(this.pendingLayout.size>=2)throw new HttpError(429,'Local page layout is busy.');
     while(this.layoutCache.size>=4){const oldest=[...this.layoutCache.keys()].find(key=>!this.pendingLayout.has(key));if(!oldest)throw new HttpError(429,'Local layout cache is busy.');this.layoutCache.delete(oldest);}
     this.pendingLayout.add(layoutKey);layout=this.images.layout(vault,id,page).then(validateLayout).catch(error=>{this.layoutCache.delete(layoutKey);throw error;}).finally(()=>this.pendingLayout.delete(layoutKey));this.layoutCache.set(layoutKey,layout);
    }
    const native=await abortable(layout,signal),regions:{startOffset:number;endOffset:number;bounds:number[]}[]=[];
    for(const {node} of sourceDocumentEntries(input.document)){
     if(node.kind!=='paragraph'||node.range.startOffset<input.start||node.range.endOffset>input.end||node.range.startOffset<canonicalPage.range.startOffset||node.range.endOffset>canonicalPage.range.endOffset)continue;
     const rawText=input.text.slice(node.range.startOffset,node.range.endOffset),normalized=rawText.trim().replace(/\r?\n/g,' ');
     const matches=native.filter(line=>line.text===normalized);if(matches.length!==1)continue;
     const canonicalPageText=input.text.slice(canonicalPage.range.startOffset,canonicalPage.range.endOffset);if(canonicalPageText.indexOf(rawText)<0||canonicalPageText.indexOf(rawText)!==canonicalPageText.lastIndexOf(rawText))continue;
     const trimmedStart=node.range.startOffset+rawText.indexOf(rawText.trim());regions.push({startOffset:trimmedStart,endOffset:trimmedStart+rawText.trim().length,bounds:matches[0]!.bounds});
    }
    provenance.canonicalRegions=regions;
   }
   if(options.ocr){
    const cacheKey=`${binding.originalHash}:${binding.admittedHash}:${page}:${imageHash}:${this.backend.fingerprint??Math.random()}`;
    let pending=this.ocrCache.get(cacheKey);if(!pending){
     if(this.pendingOCR.size>=2)throw new HttpError(429,'Local evidence OCR is busy.');
     while(this.ocrCache.size>=4){const oldest=[...this.ocrCache.keys()].find(key=>!this.pendingOCR.has(key));if(!oldest)throw new HttpError(429,'Local evidence OCR cache is busy.');this.ocrCache.delete(oldest);}
     this.pendingOCR.add(cacheKey);pending=this.backend.recognize(bytes,signal).then(validateOCRResult).catch(error=>{this.ocrCache.delete(cacheKey);throw error;}).finally(()=>this.pendingOCR.delete(cacheKey));this.ocrCache.set(cacheKey,pending);
    }
    const result=await abortable(pending,signal),mapping:{startOffset:number;endOffset:number;lineIndex:number}[]=[];
    const start=Math.max(input.start,canonicalPage.range.startOffset),end=Math.min(input.end,canonicalPage.range.endOffset),passage=input.text.slice(start,end);
    for(const [lineIndex,line] of result.lines.entries()){
     const at=passage.indexOf(line.text),wholePage=input.text.slice(canonicalPage.range.startOffset,canonicalPage.range.endOffset),pageAt=wholePage.indexOf(line.text);if(at<0||pageAt<0||wholePage.indexOf(line.text,pageAt+1)!==-1||line.confidence<0.98||line.alternatives.some(alternative=>alternative!==line.text))continue;
     const first=start+at,last=first+line.text.length;
     if(!spans.some(span=>(span.normalizedStart as number)<=first&&(span.normalizedEnd as number)>=last))continue;
     if(mapping.some(prior=>prior.startOffset<last&&prior.endOffset>first))continue;
     mapping.push({startOffset:first,endOffset:last,lineIndex});
    }
    // A second invocation of the original OCR method is supplementary evidence only.
    const initial=raw?.pageEvidence?.find(value=>value.page===page);
    provenance.ocr={...result,mapping,independent:binding.extractorVerified===true&&initial?.method==='native'&&initial.coordinateSystem==='pdf-points-bottom-left'};
   }
   pages.push(provenance);
   if(options.originalPages&&options.allowExternalTransmission)images.push({page,mimeType:'image/png',base64:bytes.toString('base64'),sha256:imageHash});
  }
  const after=this.files.reprocessingEvidenceBinding(vault,id);if(after.originalHash!==binding.originalHash||after.admittedHash!==binding.admittedHash||after.canonicalHash!==binding.canonicalHash)throw new HttpError(409,'Source evidence changed while collecting page evidence.');
  return snapshot({version:1,canonicalText:baseline.canonicalText,pageNumbers:baseline.pageNumbers,originalPages:{available:images.length>0,reason:images.length?'Admitted page images bound to preserved-original and admitted-asset hashes.':'Original-page transmission was not requested.'},ocr:{available:options.ocr,reason:options.ocr?'Fresh local raster OCR with exact bounded canonical mappings; same-engine retries are not independent evidence.':'Local OCR was not requested.'},independentlyVerified:false,externalTransmissionAllowed:options.allowExternalTransmission,diagnostics:['OCR agreement is evidence, never blanket proof of scholarly or transcription correctness.'],pages,...(images.length?{images}:{})});
 }
 canTrustIndependentEvidence(vault:string,id:string,evidence:SourceReprocessingEvidenceSnapshot):boolean{
  if(this.closed)return false;
  try{
   const current=this.files.reprocessingEvidenceBinding(vault,id);
   if(current.extractorVerified!==true||!evidence.pages?.length)return false;
   const raw=current.manifest.rawExtraction as {pageEvidence?:{page:number;method:string;coordinateSystem?:string}[]}|undefined;
   const independent=evidence.pages.filter(page=>page.ocr?.independent);
   return independent.length>0&&evidence.pages.every(page=>page.originalHash===current.originalHash&&page.admittedHash===current.admittedHash)&&independent.every(page=>raw?.pageEvidence?.some(native=>native.page===page.page&&native.method==='native'&&native.coordinateSystem==='pdf-points-bottom-left'));
  }catch{return false;}
 }
 assertCurrent(vault:string,id:string,evidence:SourceReprocessingEvidenceSnapshot){
  if(this.closed)throw new HttpError(503,'Evidence collection is closed.');
  if(!evidence.pages?.length)return;const current=this.files.reprocessingEvidenceBinding(vault,id);
  if(evidence.pages.some(page=>page.originalHash!==current.originalHash||page.admittedHash!==current.admittedHash))throw new HttpError(409,'Original-source evidence asset changed; start a new revision.');
 }
 close(){this.closed=true;this.ocrCache.clear();this.layoutCache.clear();if(this.backend instanceof NativeReprocessingOCR)this.backend.close();}
}
function snapshot(value:Omit<SourceReprocessingEvidenceSnapshot,'hash'>):SourceReprocessingEvidenceSnapshot{return {...value,hash:createHash('sha256').update(JSON.stringify(value)).digest('hex')};}

function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)return Promise.reject(new HttpError(409,'Evidence collection cancelled.'));
 return new Promise<T>((resolve,reject)=>{const abort=()=>reject(new HttpError(409,'Evidence collection cancelled.'));signal.addEventListener('abort',abort,{once:true});work.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});
}

function validateLayout(lines:{text:string;bounds:number[]}[]){
 if(!Array.isArray(lines)||lines.length>2000||Buffer.byteLength(JSON.stringify(lines))>2*1024*1024||lines.some(line=>!line||typeof line.text!=='string'||line.text.length>4000||!Array.isArray(line.bounds)||line.bounds.length!==4||line.bounds.some(n=>!Number.isFinite(n)||n<0||n>1)||line.bounds[2]!<=0||line.bounds[3]!<=0||line.bounds[0]!+line.bounds[2]!>1.000001||line.bounds[1]!+line.bounds[3]!>1.000001))throw new HttpError(502,'Invalid native page layout.');return lines;
}
