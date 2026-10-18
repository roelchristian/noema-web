import {entityMentionName,type Block,type Entity} from '../../shared/domain';

export interface PageHeading {id:string;title:string;level:1|2}
export function pageHeadings(blocks:Block[],entities:Entity[]):PageHeading[] {
  const names=new Map(entities.map(entity=>[entity.id,entityMentionName(entity)??entity.name]));
  return blocks.flatMap(block=>{
    if(block.type!=='heading1'&&block.type!=='heading2')return [];
    const title=block.content.map(segment=>segment.entityId?segment.mentionText??names.get(segment.entityId)??'':segment.text??'').join('').replace(/\s+/gu,' ').trim();
    return title?[{id:block.id,title,level:block.type==='heading1'?1 as const:2 as const}]:[];
  });
}
