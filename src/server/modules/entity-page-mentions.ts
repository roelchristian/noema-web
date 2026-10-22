import {createHash} from 'node:crypto';
import {entityMentionName,type Block,type EntityPageMention} from '../../shared/domain.js';
import {projectEntityMentions} from '../../shared/entity-mentions.js';
import {projectPageText} from '../../shared/page-text.js';
import type {Store} from '../store.js';

/** Candidate index only; occurrences are always derived from explicit saved segments. */
export function entityPageMentions(store:Store,vault:string,id:string):EntityPageMention[] {
 const entities=store.all<{id:string;name:string;mention_case:'canonical'|'lowercase'}>('SELECT id,name,mention_case FROM entities WHERE vault_id=?',vault);
 const names=new Map(entities.map(entity=>[entity.id,entityMentionName({name:entity.name,mentionCase:entity.mention_case})]));
 if(!names.has(id))return [];
 const candidates=store.all<{id:string;title:string;icon:EntityPageMention['icon'];updated_at:string;revision:number;blocks:string}>(`SELECT p.id,p.title,p.icon,p.updated_at,p.revision,p.blocks FROM pages p JOIN page_mentioned_entities m ON m.page_id=p.id WHERE p.vault_id=? AND p.deleted_at IS NULL AND m.entity_id=? ORDER BY p.updated_at DESC,p.id`,vault,id);
 return candidates.flatMap(({blocks,revision,...summary})=>{
  const page={id:summary.id,revision,blocks:JSON.parse(blocks) as Block[]},name=(entityId:string)=>names.get(entityId);
  const hash=createHash('sha256').update(projectPageText(page.blocks,name).text).digest('hex');
  const contexts=projectEntityMentions(page,id,name,hash),mentionCount=contexts.reduce((count,context)=>count+context.occurrences.length,0);
  return mentionCount?[{...summary,mentionCount,excerpt:contexts[0]!.excerpt,contexts}]:[];
 });
}
