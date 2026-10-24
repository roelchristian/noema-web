import {sourceReprocessingEvidencePageBytes,sourceReprocessingEvidenceRevisionBytes} from '../../shared/source-reprocessing.js';
import {createHash} from 'node:crypto';
import type {SourceDocument} from '../../shared/source-document.js';
import type {SourceReprocessingConfiguration,SourceReprocessingEvidenceSnapshot} from '../../shared/source-reprocessing.js';
import {utf16Boundary} from './source-reprocessing-patches.js';
import {HttpError} from '../validation.js';

const invalid=()=>new HttpError(400,'This backup contains invalid source reconstruction evidence.');
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>;};
const array=(value:unknown,max:number):unknown[]=>{if(!Array.isArray(value)||value.length>max)throw invalid();return value;};
const string=(value:unknown,max:number):string=>{if(typeof value!=='string'||value.length>max)throw invalid();return value;};
const integer=(value:unknown,min:number,max:number):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw invalid();return value;};
const hash=(value:unknown):string=>{const text=string(value,64);if(!/^[a-f0-9]{64}$/.test(text))throw invalid();return text;};
const boolean=(value:unknown)=>{if(typeof value!=='boolean')throw invalid();return value;};
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');

/** Validate cached evidence without regenerating native OCR or exposing original assets. */
export function validateReprocessingEvidenceSnapshot(value:unknown,input:{text:string;document:SourceDocument;start:number;end:number;configuration:SourceReprocessingConfiguration;evidenceHash:string}):SourceReprocessingEvidenceSnapshot {
 const e=object(value),{text,document,start,end,configuration,evidenceHash}=input;
 if(Buffer.byteLength(JSON.stringify(e))>sourceReprocessingEvidenceRevisionBytes)throw invalid();
 const {hash:snapshotHash,...content}=e;
 if(e.version!==1||hash(snapshotHash)!==evidenceHash||digest(JSON.stringify(content))!==snapshotHash||e.canonicalText!==text.slice(start,end)||e.independentlyVerified!==false)throw invalid();
 const pageNumbers=array(e.pageNumbers,2).map(page=>integer(page,1,1000)),expected=document.physical.pages.filter(page=>page.range.startOffset<end&&page.range.endOffset>start).map(page=>page.number);
 if(JSON.stringify(pageNumbers)!==JSON.stringify(expected))throw invalid();
 const originalPages=object(e.originalPages),ocr=object(e.ocr);boolean(originalPages.available);string(originalPages.reason,2000);boolean(ocr.available);string(ocr.reason,2000);
 const external=boolean(e.externalTransmissionAllowed);if(external&&!configuration.evidence.allowExternalTransmission)throw invalid();
 for(const diagnostic of array(e.diagnostics,100))string(diagnostic,2000);
 const images=e.images===undefined?[]:array(e.images,2),imageHashes=new Map<number,string>();
 for(const imageValue of images){
  const image=object(imageValue),page=integer(image.page,1,1000),base64=string(image.base64,Math.ceil(sourceReprocessingEvidencePageBytes/3)*4),sha=hash(image.sha256);
  if(!external||!configuration.evidence.originalPages||image.mimeType!=='image/png'||!pageNumbers.includes(page)||imageHashes.has(page)||!base64.length||base64.length%4!==0||/[^A-Za-z0-9+/=]/.test(base64))throw invalid();
  const bytes=Buffer.from(base64,'base64');if(bytes.length>sourceReprocessingEvidencePageBytes||bytes.toString('base64')!==base64||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||digest(bytes)!==sha)throw invalid();
  imageHashes.set(page,sha);
 }
 if(originalPages.available!==Boolean(images.length))throw invalid();
 const seenPages=new Set<number>();let ocrCount=0;
 for(const pageValue of e.pages===undefined?[]:array(e.pages,2)){
  const page=object(pageValue),number=integer(page.page,1,1000);if(!pageNumbers.includes(number)||seenPages.has(number))throw invalid();seenPages.add(number);
  hash(page.originalHash);hash(page.admittedHash);const imageHash=hash(page.imageHash);if(imageHashes.has(number)&&imageHashes.get(number)!==imageHash)throw invalid();
  const physicalPage=document.physical.pages.find(value=>value.number===number)!;
  for(const key of ['canonicalRanges','canonicalRegions'] as const){
   if(page[key]===undefined)continue;let priorEnd=-1;
   for(const value of array(page[key],key==='canonicalRanges'?10000:2000)){
    const region=object(value),from=integer(region.startOffset,Math.max(start,physicalPage.range.startOffset),Math.min(end,physicalPage.range.endOffset)),to=integer(region.endOffset,from+1,Math.min(end,physicalPage.range.endOffset));
    if(!utf16Boundary(text,from)||!utf16Boundary(text,to)||from<priorEnd)throw invalid();priorEnd=to;
    if(key==='canonicalRegions'){const bounds=array(region.bounds,4);if(bounds.length!==4||bounds.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)||(bounds[2] as number)<=0||(bounds[3] as number)<=0||(bounds[0] as number)+(bounds[2] as number)>1.000001||(bounds[1] as number)+(bounds[3] as number)>1.000001)throw invalid();}
   }
  }
  if(page.ocr===undefined)continue;if(!configuration.evidence.ocr)throw invalid();ocrCount++;
  const data=object(page.ocr);if(!string(data.engine,200)||!string(data.version,200))throw invalid();string(data.configuration,2000);boolean(data.independent);
  const lines=array(data.lines,2000);
  for(const lineValue of lines){const line=object(lineValue);string(line.text,4000);if(typeof line.confidence!=='number'||!Number.isFinite(line.confidence)||line.confidence<0||line.confidence>1)throw invalid();const bounds=array(line.bounds,4);if(bounds.length!==4||bounds.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)||(bounds[0] as number)+(bounds[2] as number)>1.000001||(bounds[1] as number)+(bounds[3] as number)>1.000001)throw invalid();for(const alternative of array(line.alternatives,10))string(alternative,4000);}
  const physical=document.physical.pages.find(page=>page.number===number)!,mappingRanges:{from:number;to:number}[]=[],mappedLines=new Set<number>();
  for(const mappingValue of array(data.mapping,2000)){const mapping=object(mappingValue),from=integer(mapping.startOffset,start,end),to=integer(mapping.endOffset,from+1,end),lineIndex=integer(mapping.lineIndex,0,lines.length-1);const lineText=object(lines[lineIndex]).text as string,pageText=text.slice(physical.range.startOffset,physical.range.endOffset),at=pageText.indexOf(lineText);if(!utf16Boundary(text,from)||!utf16Boundary(text,to)||from<physical.range.startOffset||to>physical.range.endOffset||text.slice(from,to)!==lineText||mappedLines.has(lineIndex)||mappingRanges.some(range=>range.from<to&&range.to>from)||at<0||pageText.indexOf(lineText,at+1)!==-1)throw invalid();mappedLines.add(lineIndex);mappingRanges.push({from,to});}
 }
 if(ocr.available!==Boolean(ocrCount)||[...imageHashes.keys()].some(page=>!seenPages.has(page)))throw invalid();
 return structuredClone(e) as unknown as SourceReprocessingEvidenceSnapshot;
}
