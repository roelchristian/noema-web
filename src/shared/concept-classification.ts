import type {Page,Entity} from './domain.js';

export function classifiedConceptSubtypes(page:Page):string[] {
  return page.conceptContentHash && page.conceptClassification?.contentHash===page.conceptContentHash ? page.conceptClassification.subtypeIds : [];
}
/** An unclassified/stale page cannot automatically acquire technical Concept tags. */
export function entitiesForPage(page:Page,entities:Entity[]):Entity[] {
  const allowed=new Set(classifiedConceptSubtypes(page));
  return entities.filter(entity=>entity.type!=='concept'||entity.subtypes.some(id=>allowed.has(id)));
}
