import {createHash} from 'node:crypto';
import {supportedIntelligencePreferences} from '../../shared/intelligence.js';
import {utf16Boundary} from './source-reprocessing-patches.js';
import type {SourceDocument} from '../../shared/source-document.js';
import type {ReconstructionUncertainty} from './source-reprocessing-context.js';

export type OptimizationStage='reconstruct'|'synthesis'|'verify'|'resolve';
export interface StageModelConfiguration {model:string;reasoningEffort:string|null}
export interface ReprocessingOptimizationPolicy {
 optIn:boolean;evaluationId:string|null;
 consent:{stageRouting:boolean;selectiveEvidence:boolean;externalTransmission:boolean};
 /** Explicit cap on any future extra provider investigations, never an automatic retry allowance. */
 additionalRequestBudget:number;
 routes?:Partial<Record<OptimizationStage,StageModelConfiguration>>;
 maxEvidencePages?:number;
}
export interface ReprocessingOptimizationCapabilities {stageRouting:boolean;selectiveEvidence:boolean;supportedModels:string[]}
export interface SelectiveEvidenceDemand {pageNumber:number;start:number;end:number;reasons:string[]}
export interface ReprocessingOptimizationPlan {
 version:1;baseHash:string;canonicalTextHash:string;canonicalDocumentHash:string;evaluationId:string|null;enabled:boolean;stage:OptimizationStage;model:StageModelConfiguration;
 modelRoutingEnabled:boolean;selectiveEvidenceEnabled:boolean;evidenceDemands:SelectiveEvidenceDemand[];
 externalTransmissionAllowed:boolean;additionalRequestBudget:number;reasons:string[];hash:string;
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A planning interface only. The executor remains pinned to its durable revision configuration.
 * Activating a plan requires a separately evaluated executor integration, never a silent upgrade. */
export function planReprocessingOptimization(input:{baseHash:string;stage:OptimizationStage;selectedModel:StageModelConfiguration;policy:ReprocessingOptimizationPolicy;capabilities:ReprocessingOptimizationCapabilities;text:string;document:SourceDocument;uncertainties?:ReconstructionUncertainty[]}):ReprocessingOptimizationPlan {
 const {policy,capabilities}=input;
 if(!Number.isSafeInteger(policy.additionalRequestBudget)||policy.additionalRequestBudget<0||policy.additionalRequestBudget>32)throw new Error('Explicit additional request budget must be between 0 and 32.');
 const maxPages=policy.maxEvidencePages??4;if(!Number.isSafeInteger(maxPages)||maxPages<0||maxPages>16)throw new Error('Selective evidence page budget must be between 0 and 16.');
 const reasons:string[]=[],enabled=policy.optIn&&typeof policy.evaluationId==='string'&&policy.evaluationId.trim().length>0;
 if(!policy.optIn)reasons.push('Optimization was not explicitly enabled.');
 if(!policy.evaluationId?.trim())reasons.push('An accepted synthetic or real-provider evaluation identifier is required.');
 const requestedModel=policy.routes?.[input.stage];
 const modelRoutingEnabled=!!(enabled&&policy.consent.stageRouting&&capabilities.stageRouting&&requestedModel&&capabilities.supportedModels.includes(requestedModel.model)&&supportedIntelligencePreferences(requestedModel));
 if(requestedModel&&!modelRoutingEnabled)reasons.push('Requested stage route requires opt-in, evaluation, routing consent and supported model capability.');
 const model=modelRoutingEnabled?{...requestedModel!}:{...input.selectedModel};
 const selectiveEvidenceEnabled=enabled&&policy.consent.selectiveEvidence&&capabilities.selectiveEvidence;
 const evidenceDemands:SelectiveEvidenceDemand[]=[];
 if(selectiveEvidenceEnabled)for(const page of input.document.physical.pages){
  const {startOffset:start,endOffset:end}=page.range;
  if(!Number.isSafeInteger(page.number)||page.number<1||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>input.text.length||start>=end||!utf16Boundary(input.text,start)||!utf16Boundary(input.text,end))throw new Error('Evidence demand page range differs from the canonical snapshot.');
  const text=input.text.slice(start,end),pageReasons:string[]=[];
  if(/�/.test(text))pageReasons.push('Canonical extraction contains replacement characters.');
  if(/\\(?:begin|frac)|\$\$|\|[^\n]+\|/.test(text))pageReasons.push('Mathematical or tabular layout may require original-page investigation.');
  if(input.uncertainties?.some(item=>item.evidence.some(ref=>ref.start!==undefined&&ref.end!==undefined&&ref.start<end&&ref.end>start)))pageReasons.push('Structured uncertainty references this physical page.');
  if(pageReasons.length)evidenceDemands.push({pageNumber:page.number,start,end,reasons:pageReasons});
 }
 // Demand planning itself makes zero requests; extra investigations remain separately
 // recorded work bounded by this explicit budget, including when zero is selected.
 const payload={version:1 as const,baseHash:input.baseHash,canonicalTextHash:digest(input.text),canonicalDocumentHash:digest(input.document),evaluationId:policy.evaluationId,enabled,stage:input.stage,model,modelRoutingEnabled,selectiveEvidenceEnabled,evidenceDemands:evidenceDemands.slice(0,maxPages),externalTransmissionAllowed:selectiveEvidenceEnabled&&policy.consent.externalTransmission,additionalRequestBudget:enabled?policy.additionalRequestBudget:0,reasons};
 return {...payload,hash:digest(payload)};
}

export function assertFrozenOptimizationPlan(plan:ReprocessingOptimizationPlan,expectedHash:string,baseHash:string,snapshot?:{text:string;document:SourceDocument}):void {
 const {hash,...payload}=plan;
 if(hash!==expectedHash||hash!==digest(payload)||plan.baseHash!==baseHash||(snapshot&&(plan.canonicalTextHash!==digest(snapshot.text)||plan.canonicalDocumentHash!==digest(snapshot.document))))throw new Error('Optimization plan changed after its request configuration was frozen.');
}
