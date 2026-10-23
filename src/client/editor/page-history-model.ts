import type {Block} from '../../shared/domain';
import type {PageVersion} from '../../shared/page-history';
export interface HistorySession {id:string;versions:PageVersion[]}
/** Timeline grouping affects presentation only; every durable state stays accessible. */
export function historySessions(versions:PageVersion[],gapMs=30*60*1000):HistorySession[] {
  const result:HistorySession[]=[];
  for(const version of versions) {
    const last=result.at(-1),previous=last?.versions.at(-1);
    const ordinary=(item:PageVersion)=>!item.pinned&&!item.name&&(item.kind==='edit'||item.kind==='baseline');
    if(last&&previous&&ordinary(previous)&&ordinary(version)&&Math.abs(Date.parse(previous.createdAt)-Date.parse(version.createdAt))<=gapMs)last.versions.push(version);
    else result.push({id:version.id,versions:[version]});
  }
  return result;
}
export interface BlockDifference {id:string;kind:'added'|'removed'|'modified';before?:Block;after?:Block}
export function compareHistoryBlocks(before:Block[],after:Block[]):BlockDifference[] {
  const old=new Map(before.map(block=>[block.id,block])),next=new Map(after.map(block=>[block.id,block]));
  const differences:BlockDifference[]=[];
  for(const block of before) {
    const current=next.get(block.id);
    if(!current)differences.push({id:block.id,kind:'removed',before:block});
    else if(JSON.stringify(block)!==JSON.stringify(current))differences.push({id:block.id,kind:'modified',before:block,after:current});
  }
  for(const block of after)if(!old.has(block.id))differences.push({id:block.id,kind:'added',after:block});
  return differences;
}
