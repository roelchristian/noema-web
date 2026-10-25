import type {Block,Page} from './domain.js';

export const sourcePageBlockTypes=['paragraph','heading1','heading2','bullet','numbered','quote','code','math'] as const;
export const sourcePageLanguages = ['Albanian','Armenian','Bulgarian','Catalan','Coptic','Czech','Danish','Dutch','English','Farsi','French','German','Greek','Greek (Modern, Polytonic)','Greek (Koine)','Japanese','Latin','Mandarin Chinese (Simplified)','Mandarin Chinese (Traditional)','Middle English','Occitan','Old Church Slavonic','Old English','Polish','Portuguese','Russian','Sardinian','Spanish','Swahili','Swedish','Syriac','Tagalog','Tajik','Turkish','Ukrainian'] as const;
/** Original Noema prompts; presets share the same source verification and output rules. */
export const sourcePageFormats = {
  briefing: {label:'Briefing', description:'Key ideas and takeaways', prompt:'Create a concise briefing of this source. Open with its central message, then explain the main findings or arguments, supporting evidence, and important qualifications. End with a short set of key takeaways. Attribute claims to the source and preserve disagreements; do not invent recommendations.'},
  study: {label:'Study guide', description:'Concepts, questions, glossary', prompt:'Create a study guide from this source. Explain the core concepts and their relationships, highlight definitions or formulas that matter, and include a short glossary. Add a few review questions followed by a separate answer key, with answers supported by source citations. Include source examples where available. Never ask questions the supplied material cannot answer.'},
  explainer: {label:'Concept explainer', description:'Understand how and why', prompt:'Create a clear concept explainer. Introduce the central concept, break it into understandable parts, and explain how the parts connect and why they matter according to the source. Define unfamiliar terms at the selected reader level. Keep examples within the selected source scope. Preserve nuances and identify any prerequisite knowledge missing from the source.'},
  guide: {label:'Practical guide', description:'Supported steps and advice', prompt:'Create a practical guide grounded in the source. State the goal, prerequisites, and a clear sequence of supported steps, with cautions and checks where the source supplies them. Distinguish recommendations actually made by the source from any permitted deductions. If the source is not procedural, explain its practical implications without fabricating a procedure or advice.'},
  critique: {label:'Critique', description:'Assess arguments and evidence', prompt:'Write a critical reading of the source. First fairly summarize its central position, then evaluate its reasoning, evidence, assumptions, strengths, limitations, and unanswered questions. Distinguish the source’s acknowledged limitations from your own analysis. Ground each analytical judgment in cited source passages and label it as an interpretation. Do not invent flaws or force a negative verdict. With source boundaries restricted, use only the supplied material; identify missing evidence as a gap rather than supplying outside facts. Add outside comparisons or background only when beyondSources=true, clearly labeled as additional context.'},
  custom: {label:'Create your own', description:'Choose your own direction', prompt:'Create a source-grounded knowledge page following the user’s instructions for its purpose, structure, and emphasis. If no instructions are supplied, explain the main ideas, evidence, and limitations in a clear thematic note. Use the selected customization settings without adding unsupported material.'},
} as const;
/** The complete set of generation formats exposed in the dialog. */
export const sourcePageFormatPresets=['briefing','study','explainer','guide','critique','custom'] as const;
export type SourcePageFormat = keyof typeof sourcePageFormats;
const sourcePageFormatLabels=Object.fromEntries(Object.entries(sourcePageFormats).map(([key,value])=>[key,value.label])) as {[K in SourcePageFormat]:typeof sourcePageFormats[K]['label']};
export const sourcePageChoices = {
  format: {label:'Format', options:sourcePageFormatLabels},
  detail: {label:'Length', options:{brief:'Brief', standard:'Standard', comprehensive:'Comprehensive'}},
  familiarity: {label:'Reader familiarity', options:{beginner:'Beginner', familiar:'Familiar', expert:'Expert'}},
} as const;
export type SourcePageChoice = keyof typeof sourcePageChoices;
export type SourcePageOptions = {[K in SourcePageChoice]: keyof typeof sourcePageChoices[K]['options']} & {language:string;beyondSources:boolean};
export const defaultSourcePageOptions:SourcePageOptions = {format:'briefing',detail:'standard',familiarity:'familiar',language:'',beyondSources:false};
export interface SourcePageRevision {draftId:string;feedback:string;mode:'retry'|'changes'}
export interface SourcePageReview {persona?:import('./ai-personas.js').PersonaIdentity;language?:string|null;id:string;title:string;blocks:Block[];focus:string;options?:SourcePageOptions}
export type SourcePageEvent =
  | {type:'preview_reset'}
  | {type:'status';phase:'thinking'|'reviewing'|'preparing_math';progress?:import('./source-progress.js').SourceProcessingProgress}
  | {type:'estimate';seconds:number}
  | {type:'title';title:string;language?:string|null}
  | {type:'block';block:Block}
  | {type:'block_delta';blockType:typeof sourcePageBlockTypes[number];delta:string;reset?:boolean}
  | {type:'review';draft:SourcePageReview}
  | {type:'completed';page:Page}
  | {type:'error';message:string};

/** Read older saved preferences/drafts, retaining only the exposed settings. */
export function normalizeSourcePageOptions(value:unknown):SourcePageOptions {
  const options={...defaultSourcePageOptions};
  if(!value||typeof value!=='object'||Array.isArray(value))return options;
  const stored=value as Record<string,unknown>;
  for(const key of Object.keys(sourcePageChoices) as SourcePageChoice[]) {
    if(typeof stored[key]==='string'&&Object.hasOwn(sourcePageChoices[key].options,stored[key] as string))Object.assign(options,{[key]:stored[key]});
  }
  if(typeof stored.format==='string'&&!Object.hasOwn(sourcePageFormats,stored.format))options.format='custom';
  if(typeof stored.language==='string'&&stored.language.length<=100)options.language=stored.language.trim();
  options.beyondSources=typeof stored.beyondSources==='boolean'?stored.beyondSources:stored.boundaries==='background';
  return options;
}
export function sourcePageScope(options:SourcePageOptions,beyondSources:boolean):SourcePageOptions {
  return {...options,beyondSources};
}
export function selectSourcePageFormat(options:SourcePageOptions,format:SourcePageFormat):SourcePageOptions {
  return {...options,format};
}
