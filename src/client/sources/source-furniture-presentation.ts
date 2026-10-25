import type {SourceReprocessingRevision} from '../../shared/source-reprocessing';
import type {SourceViewEntry} from './SourceDocumentView';

/** Classify only whole reading nodes; adjacent substantive text is never hidden. */
export function classifiedFurnitureNodes(editorial:SourceReprocessingRevision|null,entries:SourceViewEntry[],viewEntries:SourceViewEntry[]):Map<string,'header'|'footer'>{
    const ids=new Map<string,'header'|'footer'>();if(!editorial?.furniture?.length)return ids;
    for(const entry of viewEntries){
      if(!entry.node.text||entry.node.kind!=='paragraph')continue;
      const originalIds=editorial.nodeLinks?.filter(link=>link.reprocessedNodeIds.includes(entry.node.id)).map(link=>link.originalNodeId)??[];
      if(originalIds.length!==1)continue;
      const original=entries.find(item=>item.node.id===originalIds[0]);
      if(!original?.node.text||original.node.kind!=='paragraph')continue;
      const normalize=(text:string)=>text.replace(/\uFFFC/g,'').replace(/\s+/g,' ').trim(),nodeText=normalize(entry.node.text);
      const furniture=editorial.furniture.filter(item=>item.page===entry.node.range.startPage&&item.startOffset>=original.node.range.startOffset&&item.endOffset<=original.node.range.endOffset&&nodeText.includes(normalize(item.text))).sort((a,b)=>a.startOffset-b.startOffset);
      const kind=furniture[0]?.kind??'header';
      if(furniture.length&&furniture.every(item=>(item.kind??'header')===kind)&&normalize(furniture.map(item=>item.text).join(' '))===nodeText)ids.set(entry.node.id,kind);
    }
    return ids;
}
