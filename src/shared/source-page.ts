import type {Block,Page} from './domain.js';

export const sourcePageBlockTypes=['paragraph','heading1','heading2','bullet','numbered','quote','code','math'] as const;
export const sourcePageLanguages = ['Czech','English','French','German','Japanese','Latin','Mandarin Chinese (Simplified)','Mandarin Chinese (Traditional)','Polish','Portuguese','Spanish','Tagalog'] as const;
/** Original Noema prompts; presets share the same source verification and output rules. */
export const sourcePageFormats = {
  briefing: {organization:'theme', label:'Briefing', description:'Key ideas and takeaways', prompt:'Create a concise briefing of this source. Open with its central message, then explain the main findings or arguments, supporting evidence, and important qualifications. End with a short set of key takeaways. Attribute claims to the source and preserve disagreements; do not invent recommendations.'},
  study: {organization:'theme', label:'Study guide', description:'Concepts, questions, glossary', prompt:'Create a study guide from this source. Explain the core concepts and their relationships, highlight definitions or formulas that matter, and include a short glossary. Add a few review questions followed by a separate answer key, with answers supported by source citations. Include source examples where available. Never ask questions the supplied material cannot answer.'},
  explainer: {organization:'theme', label:'Concept explainer', description:'Understand how and why', prompt:'Create a clear concept explainer. Introduce the central concept, break it into understandable parts, and explain how the parts connect and why they matter according to the source. Define unfamiliar terms at the selected reader level. Use examples within the selected example and knowledge boundaries. Preserve nuances and identify any prerequisite knowledge missing from the source.'},
  faq: {organization:'questions', label:'FAQ', description:'Questions with clear answers', prompt:'Turn the source into a frequently asked questions page. Choose the most useful questions a reader would ask about its central ideas, evidence, distinctions, and limitations. Use question headings with direct, self-contained answers and source citations. Group related questions and avoid repetitive answers. Do not invent answers to gaps in the source.'},
  guide: {organization:'steps', label:'Practical guide', description:'Supported steps and advice', prompt:'Create a practical guide grounded in the source. State the goal, prerequisites, and a clear sequence of supported steps, with cautions and checks where the source supplies them. Distinguish recommendations actually made by the source from any permitted deductions. If the source is not procedural, explain its practical implications without fabricating a procedure or advice.'},
  timeline: {organization:'source', label:'Timeline', description:'Events and developments', prompt:'Create a chronological account of the events or developments in the source. For each entry, give the date or period only when stated, what happened, and its significance as supported by the text. Use headings and lists, cite entries, distinguish historical dates from publication dates, and mark uncertain ordering. If no reliable chronology exists, explain this limitation and organize only the explicitly supported sequence; never invent dates.'},
  article: {organization:'theme', label:'Article', description:'A readable narrative', prompt:'Create an engaging, readable article that explains the source’s central theme. Open with a grounded introduction, develop a coherent narrative with descriptive subheadings and concrete supporting evidence, and close with takeaways. Attribute the source’s positions. Do not fabricate anecdotes, statistics, quotations, or sensational claims.'},
  custom: {organization:'theme', label:'Create your own', description:'Choose your own direction', prompt:'Create a source-grounded knowledge page following the user’s instructions for its purpose, structure, and emphasis. If no instructions are supplied, explain the main ideas, evidence, and limitations in a clear thematic note. Use the selected customization settings without adding unsupported material.'},
} as const;
export type SourcePageFormat = keyof typeof sourcePageFormats;
const sourcePageFormatLabels=Object.fromEntries(Object.entries(sourcePageFormats).map(([key,value])=>[key,value.label])) as {[K in SourcePageFormat]:typeof sourcePageFormats[K]['label']};
export const sourcePageChoices = {
  format: {label:'Format', options:sourcePageFormatLabels},
  purpose: {label:'Page purpose', options:{summary:'Summary', explanation:'Explanation', study:'Study notes', analysis:'Critical analysis', guide:'Practical guide'}},
  detail: {label:'Length', options:{brief:'Brief', standard:'Standard', comprehensive:'Comprehensive'}},
  quotations: {label:'Direct quotations', options:{none:'None', phrases:'Key phrases', passages:'Selected passages'}},
  citations: {label:'Citation detail', options:{section:'Section references', paragraph:'Paragraph references', claim:'Claim-level references'}},
  boundaries: {label:'Source boundaries', options:{source:'Source only', interpretation:'Allow interpretation', background:'Add background knowledge'}},
  familiarity: {label:'Reader familiarity', options:{beginner:'Beginner', familiar:'Familiar', expert:'Expert'}},
  organization: {label:'Organization', options:{source:'Follow the source', theme:'Group by theme', questions:'Question and answer', steps:'Step by step'}},
  examples: {label:'Examples', options:{source:'Source examples only', illustrative:'Allow illustrative examples'}},
  criticalReading: {label:'Critical reading', options:{off:'Off', on:'Surface assumptions and limitations'}},
} as const;
export type SourcePageChoice = keyof typeof sourcePageChoices;
export type SourcePageOptions = {[K in SourcePageChoice]: keyof typeof sourcePageChoices[K]['options']} & {language:string};
export const defaultSourcePageOptions:SourcePageOptions = {format:'briefing', purpose:'summary', detail:'standard', quotations:'phrases', citations:'paragraph', boundaries:'source', familiarity:'familiar', organization:'theme', examples:'source', criticalReading:'off', language:''};
export interface SourcePageRevision {draftId:string;feedback:string;mode:'retry'|'changes'}
export interface SourcePageReview {language?:string|null;id:string;title:string;blocks:Block[];focus:string;options?:SourcePageOptions}
export type SourcePageEvent =
  | {type:'preview_reset'}
  | {type:'status';phase:'thinking'|'reviewing'}
  | {type:'title';title:string;language?:string|null}
  | {type:'block';block:Block}
  | {type:'block_delta';blockType:typeof sourcePageBlockTypes[number];delta:string;reset?:boolean}
  | {type:'review';draft:SourcePageReview}
  | {type:'completed';page:Page}
  | {type:'error';message:string};
