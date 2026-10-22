import {parsePersonaIdentity,type PersonaIdentity} from './ai-personas.js';
import {sourcePageChoices,sourcePageFormats,type SourcePageOptions} from './source-page.js';
import type {ReadingExplanationOptions} from './source-reading.js';

/** Immutable creation settings; absent on pages created before recording began. */
export type PageGenerationMetadata = {
  version:1;instructions:string;persona?:PersonaIdentity;
} & ({type:'source_page';options:SourcePageOptions;formatPrompt:string;userPrompt:string;revisionFeedback:string[]}
  | {type:'reading_explanation';options:ReadingExplanationOptions});

/** Validate persisted snapshots and imported backups without filling missing fields. */
export function parsePageGenerationMetadata(value:unknown):PageGenerationMetadata|null {
  if(value===undefined||value===null)return null;
  if(typeof value==='string')value=JSON.parse(value);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid generation metadata');
  const data=value as Record<string,unknown>,options=data.options as Record<string,unknown>|undefined;
  const string=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max;
  if(data.version!==1||!string(data.instructions,40000)||!options||typeof options!=='object'||Array.isArray(options)||!string(options.language,100)||!Object.hasOwn(sourcePageChoices.familiarity.options,String(options.familiarity)))throw new Error('Invalid generation metadata');
  const persona=parsePersonaIdentity(data.persona);
  const identity=persona?{persona}:{};
  if(data.type==='reading_explanation')return {version:1,...identity,type:data.type,instructions:data.instructions as string,options:{...(persona?{persona}:{}),language:options.language as string,familiarity:options.familiarity as ReadingExplanationOptions['familiarity']}};
  if(data.type!=='source_page'||!Object.hasOwn(sourcePageFormats,String(options.format))||!Object.hasOwn(sourcePageChoices.detail.options,String(options.detail))||typeof options.beyondSources!=='boolean'||!string(data.formatPrompt,6000)||!string(data.userPrompt,2000)||!Array.isArray(data.revisionFeedback)||data.revisionFeedback.length>100||!data.revisionFeedback.every(value=>string(value,2000)))throw new Error('Invalid generation metadata');
  return {version:1,...identity,type:data.type,instructions:data.instructions as string,options:{format:options.format as SourcePageOptions['format'],detail:options.detail as SourcePageOptions['detail'],familiarity:options.familiarity as SourcePageOptions['familiarity'],language:options.language as string,beyondSources:options.beyondSources},formatPrompt:data.formatPrompt as string,userPrompt:data.userPrompt as string,revisionFeedback:data.revisionFeedback as string[]};
}
