import {createHash} from 'node:crypto';
import {resolvePersona,personaInstructions} from './ai-personas.js';
import type {AIRequestObserver} from './ai-debug.js';
import type {ReadingExplanationOptions} from '../../shared/source-reading.js';
import {intelligenceModels,supportedIntelligencePreferences,type IntelligencePreferences} from '../../shared/intelligence.js';
import {HttpError} from '../validation.js';
import {editorReviewInstructions} from './editor-review.js';
import {sourceMathInstructions} from './source-math.js';
import {sourcePagePrompt} from './source-page-prompt.js';
import {explanationPrompt} from './explanation-prompt.js';
import {entityDiscoveryPrompt} from './entity-discovery-prompt.js';
import {entityScanPrompt} from './entity-scan.js';
import {titlePrompt} from './title-prompt.js';
import {summaryPrompt} from './summary-prompt.js';
import {pageEnrichmentPrompt,type PageEnrichmentOptions} from './page-enrichment-prompt.js';
import {sourceEnrichmentPrompt,sourceAuthorsPrompt,sourceScholarlyPrompt} from './source-enrichment-prompt.js';

export interface EditorialEvidenceImage {page:number;mimeType:'image/png';base64:string;sha256:string}
type CommonRequest = {onRequest?:AIRequestObserver;background?:boolean;signal?:AbortSignal};
/** One intent per request. Feature parsers remain with their existing owners. */
export type GenerationRequest = CommonRequest & (
  | {kind:'validation'}
  | {kind:'summary';input:string}
  | {kind:'title';input:string}
  | {kind:'utility';input:string;domains:{id:string;name:string}[];currentTitle:string}
  | {kind:'entityDiscovery';input:string}
  | {kind:'entityScan';input:string;onDelta?:(delta:string)=>void}
  | {kind:'explanation';personaId?:string;personaVersion?:number;input:string;options?:ReadingExplanationOptions}
  | {kind:'review';personaId?:string;personaVersion?:number;input:string}
  | {kind:'sourcePage';personaId?:string;personaVersion?:number;input:string;signal:AbortSignal;onDelta:(delta:string)=>void;onPreviewDelta?:(delta:string)=>void;onPreviewReset?:()=>void}
  | {kind:'sourceMath';input:string;signal:AbortSignal;onDelta?:(delta:string)=>void}
  | {kind:'sourceEnrichment';input:string}
  | {kind:'sourceScholarly';input:string}
  | {kind:'sourceAuthors';input:string}
  | {kind:'pageEnrichment';input:string;options:Omit<PageEnrichmentOptions,'signal'>}
  | {kind:'collectionRules';input:string;instructions:string}
  | {kind:'editorial';input:string;instructions:string;signal:AbortSignal;responseShape?:'blocks'|'blocksWithFurniture'|'blocksWithMetadata'|'blocksWithCorrections'|'synthesis'|'synthesisReview';evidenceImages?:EditorialEvidenceImage[];externalEvidenceConsent?:boolean;outputTokenBudget?:16000|32000|64000}
);

type MultimodalInput={role:'user';content:({type:'input_text';text:string}|{type:'input_image';image_url:string;detail:'high'})[]}[];
type Prompt = {instructions:string;input:string|MultimodalInput;text?:unknown}|ReturnType<typeof summaryPrompt> | ReturnType<typeof pageEnrichmentPrompt> | {instructions:string;input:string};
interface GenerationPolicy {
  persona?:ReturnType<typeof resolvePersona>;
  prompt:()=>Prompt;
  selection:IntelligencePreferences;
  admission:{activeSlot:'exclusive'|'independent'|'editorial';manual:boolean};
  timeoutMs:number;
  maxOutputTokens:number;
  maxOutputLength:number;
  stream:boolean;
  onDelta?: (delta:string)=>void;
  preview?:{onDelta:(delta:string)=>void;onReset:()=>void};
}
interface Selections {personaId?:string;standard:IntelligencePreferences;title:IntelligencePreferences;enrichment:IntelligencePreferences}
const ignoreDelta=(_delta:string)=>{};
/** Nullable offsets retain the legacy unique-substring protocol. Local validation is authoritative. */
const uncertaintySchema={type:'object',additionalProperties:false,required:['blockId','nature','readings','evidence','resolutionNeed'],properties:{blockId:{type:'string'},nature:{type:'string'},readings:{type:'array',items:{type:'string'}},evidence:{type:'array',items:{type:'object',additionalProperties:false,required:['blockId','quote'],properties:{blockId:{type:'string'},quote:{type:'string'}}}},resolutionNeed:{type:'string'}}};
const reconstructionFormat={type:'json_schema',name:'source_reconstruction_blocks',strict:true,schema:{type:'object',additionalProperties:false,required:['blocks','diagnostics','unresolved','uncertainties'],properties:{blocks:{type:'array',items:{type:'object',additionalProperties:false,required:['id','text'],properties:{id:{type:'string'},text:{type:'string'}}}},diagnostics:{type:'array',items:{type:'string'}},unresolved:{type:'boolean'},uncertainties:{type:'array',items:uncertaintySchema}}}};
const furnitureReconstructionFormat={...reconstructionFormat,name:'source_reconstruction_furniture',schema:{...reconstructionFormat.schema,required:[...reconstructionFormat.schema.required,'pageFurniture'],properties:{...reconstructionFormat.schema.properties,pageFurniture:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['blockId','quote','kind'],properties:{blockId:{type:'string'},quote:{type:'string'},kind:{type:'string',enum:['header','footer']}}}}}}};
export const editorialMetadataFields=['title','author','editor','translator','date','publisher','edition','doi','isbn','issn','journal','booktitle','volume','issue','pages','series','url','language'] as const;
const metadataReconstructionFormat={...furnitureReconstructionFormat,name:'source_reconstruction_metadata',schema:{...furnitureReconstructionFormat.schema,required:[...furnitureReconstructionFormat.schema.required,'metadata'],properties:{...furnitureReconstructionFormat.schema.properties,metadata:{type:'array',maxItems:32,items:{type:'object',additionalProperties:false,required:['field','value','blockId','quote','reason'],properties:{field:{type:'string',enum:editorialMetadataFields},value:{type:'string'},blockId:{type:'string'},quote:{type:'string'},reason:{type:'string'}}}}}}};
/** Bind the structured response to this chunk's block count and identifier set. */
function chunkMetadataFormat(input:string){
 const data=JSON.parse(input),blocks=data.blocks;
 if(!Array.isArray(blocks)||!blocks.length||blocks.some(block=>!block||typeof block.id!=='string'))throw new HttpError(400,'Canonical reconstruction blocks are required.');
 const schema=metadataReconstructionFormat.schema,base=schema.properties.blocks;
 return {...metadataReconstructionFormat,schema:{...schema,properties:{...schema.properties,blocks:{...base,minItems:blocks.length,maxItems:blocks.length,items:{...base.items,properties:{...base.items.properties,id:{type:'string',enum:blocks.map(block=>block.id)}}}}}}};
}
/** New correction policy has its own schema so archived provider requests stay stable. */
function chunkCorrectionsFormat(input:string){
 const base=chunkMetadataFormat(input);
 return {...base,name:'source_reconstruction_corrections',schema:{...base.schema,required:[...base.schema.required,'correctionReviews'],properties:{...base.schema.properties,correctionReviews:{type:'array',maxItems:128,items:{type:'object',additionalProperties:false,required:['id','outcome','explanation'],properties:{id:{type:'string'},outcome:{type:'string',enum:['proposed','retained','source_required']},explanation:{type:'string'}}}}}}};
}
const synthesisObservationSchema={type:'object',additionalProperties:false,required:['kind','reading','alternatives','evidence','resolutionNeed'],properties:{kind:{type:'string',enum:['terminology','entity','outline','reference','pattern','uncertainty']},reading:{type:'string'},alternatives:{type:'array',items:{type:'string'}},evidence:{type:'array',items:{type:'object',additionalProperties:false,required:['blockId','quote'],properties:{blockId:{type:'string'},quote:{type:'string'}}}},resolutionNeed:{type:'string'}}};
const synthesisFormat={type:'json_schema',name:'source_document_synthesis',strict:true,schema:{type:'object',additionalProperties:false,required:['observations'],properties:{observations:{type:'array',maxItems:128,items:synthesisObservationSchema}}}};
const synthesisReviewFormat={type:'json_schema',name:'source_synthesis_evidence_review',strict:true,schema:{type:'object',additionalProperties:false,required:['reviews'],properties:{reviews:{type:'array',maxItems:128,items:{type:'object',additionalProperties:false,required:['index','classification','explanation','observation'],properties:{index:{type:'integer'},classification:{type:'string',enum:['extraction_fix','wrong_reference','unsupported']},explanation:{type:'string'},observation:{anyOf:[synthesisObservationSchema,{type:'null'}]}}}}}}};
const editorialFormat={type:'json_schema',name:'source_editorial_patches',strict:true,schema:{
  type:'object',additionalProperties:false,required:['patches','diagnostics'],properties:{
    patches:{type:'array',maxItems:50,items:{type:'object',additionalProperties:false,
      required:['original','replacement','category','reason','confidence','startOffset','endOffset'],properties:{
        original:{type:'string'},replacement:{type:'string'},
        category:{type:'string',enum:['ocr','line_breaks','footnote','apparatus','metadata','citation','math','formatting']},
        reason:{type:'string'},confidence:{type:'number'},
        startOffset:{type:['integer','null']},endOffset:{type:['integer','null']},
      }}},
    diagnostics:{type:'array',items:{type:'string'}},
  },
}};

/** Pure policy dispatch; credentials, admission state and transport belong to Intelligence.
 * Prompts run after admission, inside the provider error boundary, as before. */
export function generationPolicy(request:GenerationRequest,selections:Selections):GenerationPolicy {
  // Explicit allowlist: editorial is source preprocessing, not generative writing.
  const persona=request.kind==='explanation'||request.kind==='review'||request.kind==='sourcePage'
    ?resolvePersona(request.personaId??selections.personaId,request.personaVersion):undefined;
  // Background only bypasses manual accounting, never the exclusive active slot.
  const policy=(prompt:()=>Prompt,{activeSlot,...overrides}:Partial<Omit<GenerationPolicy,'prompt'|'admission'>>&{activeSlot:GenerationPolicy['admission']['activeSlot']}):GenerationPolicy=>({
    persona,prompt:()=>{const value=prompt();return persona?{...value,instructions:personaInstructions(value.instructions,persona,request.kind==='review')}:value;},selection:selections.standard,maxOutputTokens:8192,maxOutputLength:12000,timeoutMs:45000,stream:false,
    admission:{activeSlot,manual:!request.background},...overrides,
  });
  switch(request.kind) {
    case 'validation':
      return policy(()=>({instructions:'Reply with OK.',input:'Connection test.'}),{activeSlot:'exclusive',maxOutputTokens:2048});
    case 'summary':
      return policy(()=>summaryPrompt(request.input),{activeSlot:'exclusive'});
    case 'title':
      return policy(()=>titlePrompt(request.input),{activeSlot:'independent',selection:selections.title,maxOutputTokens:512});
    case 'utility':
      return policy(()=>titlePrompt(request.input,request.domains,request.currentTitle),{activeSlot:'independent',selection:selections.title,maxOutputTokens:512});
    case 'entityDiscovery':
      return policy(()=>entityDiscoveryPrompt(request.input),{activeSlot:'exclusive',maxOutputTokens:4096,maxOutputLength:20000});
    case 'entityScan':
      return {...policy(()=>entityScanPrompt(request.input),{activeSlot:'independent',maxOutputTokens:16384,maxOutputLength:100000}),stream:!!request.onDelta,onDelta:request.onDelta};
    case 'explanation':
      return policy(()=>explanationPrompt(request.input,request.options),{activeSlot:'exclusive'});
    case 'review':
      return policy(()=>({instructions:editorReviewInstructions,input:request.input}),{activeSlot:'exclusive'});
    case 'sourcePage':
      return {...policy(()=>sourcePagePrompt(request.input),{activeSlot:'exclusive',maxOutputLength:60000,timeoutMs:180000}),stream:true,onDelta:request.onDelta,
        preview:request.onPreviewDelta?{onDelta:request.onPreviewDelta,onReset:()=>request.onPreviewReset?.()}:undefined};
    case 'sourceMath':
      return {...policy(()=>({instructions:sourceMathInstructions,input:[{role:'user',content:[{type:'input_text',text:request.input}]}]}),{activeSlot:'exclusive',maxOutputLength:60000,timeoutMs:180000}),stream:true,onDelta:request.onDelta??ignoreDelta};
    case 'sourceEnrichment':
      return policy(()=>sourceEnrichmentPrompt(request.input),{activeSlot:'exclusive',maxOutputLength:20000});
    case 'sourceScholarly':
      return policy(()=>sourceScholarlyPrompt(request.input),{activeSlot:'exclusive',maxOutputTokens:4096});
    case 'sourceAuthors':
      return policy(()=>sourceAuthorsPrompt(request.input),{activeSlot:'exclusive'});
    case 'pageEnrichment': {
      const selection=selections.enrichment;
      const tokens=selection.reasoningEffort!=='none'?4096:request.options.requestedFields.includes('summary')?768:384;
      return policy(()=>pageEnrichmentPrompt(request.input,request.options),{activeSlot:'independent',selection,maxOutputTokens:tokens});
    }
    case 'collectionRules':
      return policy(()=>({instructions:request.instructions,input:request.input}),{activeSlot:'exclusive',selection:{...selections.standard,reasoningEffort:'none'},maxOutputTokens:4096,maxOutputLength:32768});
    case 'editorial':
      if(request.evidenceImages?.length){
       if(request.externalEvidenceConsent!==true||!['blocks','blocksWithFurniture','blocksWithMetadata','blocksWithCorrections'].includes(request.responseShape??''))throw new HttpError(400,'Explicit original-page transmission consent is required.');
       if(!intelligenceModels.find(model=>model.id===selections.standard.model)?.imageInput)throw new HttpError(400,'The selected model has no enabled original-page image capability.');
       if(request.evidenceImages.length>2||request.evidenceImages.some(image=>image.mimeType!=='image/png'||!Number.isSafeInteger(image.page)||image.page<1||!/^[a-f0-9]{64}$/.test(image.sha256)||image.base64.length>16*1024*1024||createHash('sha256').update(Buffer.from(image.base64,'base64')).digest('hex')!==image.sha256||!Buffer.from(image.base64,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||!/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)))throw new HttpError(400,'Invalid or excessive original-page image evidence.');
      }
      if(!supportedIntelligencePreferences(selections.standard))throw new HttpError(400,'Choose a supported editorial model and reasoning effort in Settings → Intelligence.');
      return policy(()=>({instructions:request.instructions,input:request.evidenceImages?.length?[{role:'user' as const,content:[{type:'input_text' as const,text:request.input},...request.evidenceImages.map(image=>({type:'input_image' as const,image_url:`data:image/png;base64,${image.base64}`,detail:'high' as const}))]}]:request.input,...(intelligenceModels.find(model=>model.id===selections.standard.model)?.structuredOutputs?{text:{format:request.responseShape==='blocksWithCorrections'?chunkCorrectionsFormat(request.input):request.responseShape==='blocksWithMetadata'?chunkMetadataFormat(request.input):request.responseShape==='blocksWithFurniture'?furnitureReconstructionFormat:request.responseShape==='blocks'?reconstructionFormat:request.responseShape==='synthesis'?synthesisFormat:request.responseShape==='synthesisReview'?synthesisReviewFormat:editorialFormat}}:{})}),{activeSlot:'editorial',selection:{...selections.standard},maxOutputTokens:request.outputTokenBudget??16000,maxOutputLength:60000,timeoutMs:180000});
    default: {
      const exhaustive:never=request;
      throw new Error(`Unsupported generation request: ${String(exhaustive)}`);
    }
  }
}
