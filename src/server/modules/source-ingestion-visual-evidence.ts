import {checkDocumentRequest,DocumentProviderError} from './document-provider.js';
import type {SourceIngestionDocument,SourceIngestionOptions,SourceIngestionWindowPlan} from '../../shared/source-ingestion.js';
import type {PdfPlatform} from './pdf-platform.js';
import {SOURCE_INGESTION_TARGETED_REPAIR_SCHEMA,sourceIngestionTargetedRepairPrompt,sourceIngestionTargetedRepairEvidence} from './source-ingestion-targeted-repair.js';
export const sourceIngestionVisualEvidenceAlgorithm='pdfjs-context-crop-v1' as const;
export interface SourceIngestionVisualRect {x:number;y:number;width:number;height:number}
export interface SourceIngestionVisualEvidenceManifest {
 version:1;algorithm:typeof sourceIngestionVisualEvidenceAlgorithm;
 pageMap:number[];ownedPages:number[];
 crops:{physicalPage:number;blockId:string;rect:SourceIngestionVisualRect;accuracy:'approximate'}[];
 fallback:'none'|'no-valid-geometry'|'render-unavailable'|'input-budget';
}
export interface SourceIngestionVisualEvidenceInput {
 pdf:Uint8Array;pageMap:number[];document:SourceIngestionDocument;plan:SourceIngestionWindowPlan;
 options:SourceIngestionOptions;signal:AbortSignal;
}
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key))&&allowed.every(key=>Object.hasOwn(value,key));
export function validSourceIngestionVisualRect(rect:unknown):rect is SourceIngestionVisualRect{
 if(!rect||typeof rect!=='object'||Array.isArray(rect)||!keys(rect as Record<string,unknown>,['x','y','width','height']))return false;
 const r=rect as SourceIngestionVisualRect;
 return [r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=1&&r.y+r.height<=1;
}
/** Persisted metadata is evidence selection, never native geometry or verification. */
export function validateSourceIngestionVisualEvidence(value:unknown):SourceIngestionVisualEvidenceManifest{
 const invalid=()=>new Error('Invalid visual repair evidence manifest');
 if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
 const v=value as Record<string,unknown>;
 const pages=(list:unknown):list is number[]=>Array.isArray(list)&&list.length>0&&list.length<=32&&new Set(list).size===list.length&&list.every(p=>Number.isSafeInteger(p)&&p>=1&&p<=1000);
 if(!keys(v,['version','algorithm','pageMap','ownedPages','crops','fallback'])||v.version!==1||v.algorithm!==sourceIngestionVisualEvidenceAlgorithm||!pages(v.pageMap)||!pages(v.ownedPages)||v.ownedPages.some(p=>!(v.pageMap as number[]).includes(p))||!Array.isArray(v.crops)||v.crops.length>4||!['none','no-valid-geometry','render-unavailable','input-budget'].includes(String(v.fallback)))throw invalid();
 const cropPages=new Set<number>();
 for(const candidate of v.crops){
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||!keys(candidate,['physicalPage','blockId','rect','accuracy'])||!Number.isSafeInteger(candidate.physicalPage)||!v.ownedPages.includes(candidate.physicalPage)||cropPages.has(candidate.physicalPage)||typeof candidate.blockId!=='string'||!candidate.blockId||candidate.blockId.length>512||candidate.accuracy!=='approximate'||!validSourceIngestionVisualRect(candidate.rect))throw invalid();
  cropPages.add(candidate.physicalPage);
 }
 if(v.fallback==='none'&&v.crops.length===0||v.fallback!=='none'&&v.crops.length!==0)throw invalid();
 return structuredClone(value as SourceIngestionVisualEvidenceManifest);
}
/** Bounded visual derivative for explicit repair only; canonical PDF is untouched. */
export async function prepareSourceIngestionVisualEvidence(platform:Pick<PdfPlatform,'renderRepairEvidence'>,input:SourceIngestionVisualEvidenceInput):Promise<{bytes:Uint8Array;pageMap:number[];evidence:SourceIngestionVisualEvidenceManifest}>{
 input.signal.throwIfAborted();
 const evidence:SourceIngestionVisualEvidenceManifest={version:1,algorithm:sourceIngestionVisualEvidenceAlgorithm,pageMap:input.pageMap.slice(),ownedPages:input.plan.ownedPages.slice(),crops:[],fallback:'no-valid-geometry'};
 // Validate scope before inspecting geometry, including fallback-only manifests.
 validateSourceIngestionVisualEvidence(evidence);
 const scope=sourceIngestionTargetedRepairEvidence(input.document,{ownedPages:input.plan.ownedPages,depth:input.options.depth}),selected=new Set(scope.evidence.map(block=>block.id)),pages=new Set<number>();
 for(const block of input.document.blocks){
  if(evidence.crops.length===4)break;
  if(!selected.has(block.id)||pages.has(block.page)||!block.location||block.location.accuracy!=='approximate')continue;
  const {x,y,width,height}=block.location;if(!validSourceIngestionVisualRect({x,y,width,height}))continue;
  // A normalized margin keeps small adjacent marks and subscripts in evidence.
  const left=Math.max(0,x-.02),top=Math.max(0,y-.02),right=Math.min(1,x+width+.02),bottom=Math.min(1,y+height+.02);
  const rect={x:left,y:top,width:right-left,height:bottom-top};
  if(!validSourceIngestionVisualRect(rect))continue;
  evidence.crops.push({physicalPage:block.page,blockId:block.id,rect,accuracy:'approximate'});pages.add(block.page);
 }
 if(!evidence.crops.length)return {bytes:input.pdf,pageMap:input.pageMap.slice(),evidence};
 let bytes:Uint8Array;
 try{
  bytes=await platform.renderRepairEvidence(input.pdf,evidence.crops.map(crop=>({page:input.pageMap.indexOf(crop.physicalPage)+1,rect:crop.rect})),input.signal);
 }catch(error){
  input.signal.throwIfAborted();
  evidence.crops=[];evidence.fallback='render-unavailable';
  return {bytes:input.pdf,pageMap:input.pageMap.slice(),evidence};
 }
 input.signal.throwIfAborted();evidence.fallback='none';validateSourceIngestionVisualEvidence(evidence);
 if(input.options.route==='local'||!input.options.model)throw new Error('Visual repair evidence requires a selected document provider');
 // Raster expansion can hit a provider's conservative context guard even when
 // the original split PDF fits. Preflight the exact repair prompt and manifest,
 // using the same output reservation as runtime, before retaining this derivative.
 try{
  checkDocumentRequest(input.options.route,{task:'repair',model:input.options.model,pdf:bytes,pages:input.pageMap.length,prompt:sourceIngestionTargetedRepairPrompt(input.document,{ownedPages:input.plan.ownedPages,contextPages:input.plan.contextPages,pageMap:input.pageMap,depth:input.options.depth,visualEvidence:evidence}),schema:SOURCE_INGESTION_TARGETED_REPAIR_SCHEMA,maxOutputTokens:Math.min(input.options.budget.maxOutputTokens,8000),signal:input.signal});
 }catch(error){
  input.signal.throwIfAborted();
  if(!(error instanceof DocumentProviderError)||!['file_limit','context_limit'].includes(error.code))throw error;
  evidence.crops=[];evidence.fallback='input-budget';
  return {bytes:input.pdf,pageMap:input.pageMap.slice(),evidence};
 }
 return {bytes,pageMap:input.pageMap.slice(),evidence};
}
