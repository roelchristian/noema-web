import {resolvePersona,personaInstructions} from './ai-personas.js';
import type {AIRequestObserver} from './ai-debug.js';
import type {ReadingExplanationOptions} from '../../shared/source-reading.js';
import type {IntelligencePreferences} from '../../shared/intelligence.js';
import {editorReviewInstructions} from './editor-review.js';
import {sourceMathInstructions} from './source-math.js';
import {sourcePagePrompt} from './source-page-prompt.js';
import {explanationPrompt} from './explanation-prompt.js';
import {entityDiscoveryPrompt} from './entity-discovery-prompt.js';
import {entityScanPrompt} from './entity-scan.js';
import {titlePrompt} from './title-prompt.js';
import {summaryPrompt} from './summary-prompt.js';
import {pageEnrichmentPrompt,type PageEnrichmentOptions} from './page-enrichment-prompt.js';
import {sourceEnrichmentPrompt,sourceAuthorsPrompt} from './source-enrichment-prompt.js';

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
  | {kind:'sourceAuthors';input:string}
  | {kind:'pageEnrichment';input:string;options:Omit<PageEnrichmentOptions,'signal'>}
  | {kind:'editorial';input:string;instructions:string;signal:AbortSignal}
);

type Prompt = ReturnType<typeof summaryPrompt> | ReturnType<typeof pageEnrichmentPrompt> | {instructions:string;input:string};
interface GenerationPolicy {
  persona?:ReturnType<typeof resolvePersona>;
  prompt:()=>Prompt;
  selection:IntelligencePreferences;
  admission:{activeSlot:'exclusive'|'independent';manual:boolean};
  timeoutMs:number;
  maxOutputTokens:number;
  maxOutputLength:number;
  stream:boolean;
  onDelta?: (delta:string)=>void;
  preview?:{onDelta:(delta:string)=>void;onReset:()=>void};
}
interface Selections {personaId?:string;standard:IntelligencePreferences;title:IntelligencePreferences;enrichment:IntelligencePreferences}
const ignoreDelta=(_delta:string)=>{};

/** Pure policy dispatch; credentials, admission state and transport belong to Intelligence.
 * Prompts run after admission, inside the provider error boundary, as before. */
export function generationPolicy(request:GenerationRequest,selections:Selections):GenerationPolicy {
  // Explicit allowlist: editorial is source preprocessing, not generative writing.
  const persona=request.kind==='explanation'||request.kind==='review'||request.kind==='sourcePage'
    ?resolvePersona(request.personaId??selections.personaId,request.personaVersion):undefined;
  // Background only bypasses manual accounting, never the exclusive active slot.
  const policy=(prompt:()=>Prompt,{activeSlot,...overrides}:Partial<Omit<GenerationPolicy,'prompt'|'admission'>>&{activeSlot:'exclusive'|'independent'}):GenerationPolicy=>({
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
    case 'sourceAuthors':
      return policy(()=>sourceAuthorsPrompt(request.input),{activeSlot:'exclusive'});
    case 'pageEnrichment': {
      const selection=selections.enrichment;
      const tokens=selection.reasoningEffort!=='none'?4096:request.options.requestedFields.includes('summary')?768:384;
      return policy(()=>pageEnrichmentPrompt(request.input,request.options),{activeSlot:'independent',selection,maxOutputTokens:tokens});
    }
    case 'editorial':
      return policy(()=>({instructions:request.instructions,input:request.input}),{activeSlot:'exclusive',selection:{...selections.standard,reasoningEffort:'none'},maxOutputTokens:16000,maxOutputLength:60000,timeoutMs:180000});
    default: {
      const exhaustive:never=request;
      throw new Error(`Unsupported generation request: ${String(exhaustive)}`);
    }
  }
}
