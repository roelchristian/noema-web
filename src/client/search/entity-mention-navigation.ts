import {entityMentionName,type Entity,type Page} from '../../shared/domain.js';
import {projectEntityMentions,type EntityMentionReference} from '../../shared/entity-mentions.js';

/** Refuse stale references instead of opening a different identical mention. */
export function validateEntityMention(reference:EntityMentionReference,page:Page,entities:Entity[]):boolean {
 if(reference.pageId!==page.id||reference.revision!==page.revision||!Number.isInteger(reference.segmentIndex)||reference.segmentIndex<0)return false;
 const names=new Map(entities.filter(entity=>entity.vault_id===page.vault_id).map(entity=>[entity.id,entityMentionName(entity)]));
 if(!names.has(reference.entityId))return false;
 const occurrence=projectEntityMentions(page,reference.entityId,id=>names.get(id)).flatMap(context=>context.occurrences).find(({reference:current})=>current.blockId===reference.blockId&&current.segmentIndex===reference.segmentIndex&&current.row===reference.row&&current.column===reference.column);
 if(!occurrence)return false;
 const current=occurrence.reference;
 return reference.blockIds.length===1&&reference.blockIds[0]===current.blockId&&reference.startOffset===current.startOffset&&reference.endOffset===current.endOffset&&reference.excerpt===current.excerpt&&reference.segmentId===current.segmentId;
}
