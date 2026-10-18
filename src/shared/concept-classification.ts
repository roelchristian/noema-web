import type {Page,Entity} from './domain.js';

/** Historical subtype classifications remain readable, but no longer gate recognition. */
export function classifiedConceptSubtypes(page:Page):string[] {
  return page.conceptContentHash && page.conceptClassification?.contentHash===page.conceptContentHash ? page.conceptClassification.subtypeIds : [];
}
/** Retrieve across disciplines: a subject assignment is contextual evidence, never a gate. */
export function entitiesForPage(_page:Page,entities:Entity[]):Entity[] { return entities; }
export const ALIAS_POLICY_VERSION = 'contextual-concepts-v1';
export function conceptAliasNeedsReview(alias:string):boolean {
  return alias.trim().split(/\s+/u).length === 1 || /^(?:field|group|order|class|object|characteristic|ring|set|space|type|model|structure|system|theory|method)$/iu.test(alias.trim());
}
/** Conservative ordinary-language senses, checked before any inferred link or review. */
export function ordinaryConceptUse(text:string,start:number,length:number,alias:string):boolean {
  const following=text.slice(start+length,start+length+45), preceding=text.slice(Math.max(0,start-35),start);
  switch(alias.toLowerCase()) {
    case 'field': case 'fields': return /^\s+(?:of\s+(?:research|study|studies|work|interest|expertise|vision)|work|trip|worker)/iu.test(following) || /(?:in|across)\s+(?:the\s+)?$/iu.test(preceding) && /^\s+(?:of\s+)?(?:grass|wheat|corn)/iu.test(following);
    case 'group': return /^\s+of\s+(?:people|friends|students|children)/iu.test(following);
    case 'order': return /^\s+(?:to\b|of\s+(?:business|arrival))/iu.test(following) || /\bin\s+$/iu.test(preceding);
    case 'class': return /^\s+(?:of\s+(?:students|children)|starts|tomorrow)/iu.test(following);
    default:return false;
  }
}
