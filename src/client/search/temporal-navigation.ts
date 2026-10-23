import {entityMentionName,type Entity,type Page} from '../../shared/domain.js';
import {projectPageText} from '../../shared/page-text.js';
import type {TemporalPageReference} from '../../shared/temporal.js';

/** Validate before handing the reference to the existing page passage highlighter.
 * There is deliberately no text search fallback, including for repeated dates. */
export function validateTemporalReference(reference:TemporalPageReference,page:Page,entities:Entity[]):boolean {
 if(reference.pageId!==page.id||reference.revision!==page.revision||reference.blockIds.length!==1||reference.blockIds[0]!==reference.blockId)return false;
 if(!Number.isSafeInteger(reference.blockStart)||!Number.isSafeInteger(reference.blockEnd)||reference.blockStart<0||reference.blockEnd<=reference.blockStart)return false;
 const names=new Map(entities.filter(entity=>entity.vault_id===page.vault_id).map(entity=>[entity.id,entityMentionName(entity)]));
 const block=projectPageText(page.blocks,id=>names.get(id)).blocks.find(block=>block.id===reference.blockId);
 return !!block&&reference.blockEnd<=block.text.length&&reference.startOffset===block.start+reference.blockStart&&reference.endOffset===block.start+reference.blockEnd&&block.text.slice(reference.blockStart,reference.blockEnd)===reference.excerpt;
}
