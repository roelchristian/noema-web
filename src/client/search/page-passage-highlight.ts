import {projectPageText} from '../../shared/page-text';
import {entityMentionName,type Page,type Entity} from '../../shared/domain';
import type {PageReference} from '../../shared/embeddings';

/** Highlight DOM ranges only when rendered text agrees with the canonical block.
 * Math/table widgets fall back to block anchors instead of guessing offsets. */
export function highlightPagePassage(reference:PageReference,page:Page,entities:Entity[]) {
 const names=new Map(entities.map(entity=>[entity.id,entityMentionName(entity)]));
 const projection=projectPageText(page.blocks,id=>names.get(id)),ranges:Range[]=[],blocks:HTMLElement[]=[];
 if(page.revision!==reference.revision||projection.text.slice(reference.startOffset,reference.endOffset)!==reference.excerpt)return ()=>{};
 for(const block of projection.blocks) {
  if(!reference.blockIds.includes(block.id))continue;
  const element=document.querySelector<HTMLElement>(`#content [data-block-id="${CSS.escape(block.id)}"]`);
  if(!element)continue;
  blocks.push(element);element.classList.add('page-search-passage');
  const content=element.querySelector<HTMLElement>('.block-content');
  if(!content||content.textContent!==block.text)continue;
  const from=Math.max(0,reference.startOffset-block.start),to=Math.min(block.text.length,reference.endOffset-block.start);
  if(to<=from)continue;
  const walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT),range=document.createRange();
  let node:Node|null,offset=0,started=false;
  while((node=walker.nextNode())) {
   const length=node.textContent?.length??0;
   if(!started&&from<=offset+length){range.setStart(node,from-offset);started=true;}
   if(started&&to<=offset+length){range.setEnd(node,to-offset);ranges.push(range);break;}
   offset+=length;
  }
 }
 if(typeof Highlight!=='undefined'&&CSS.highlights&&ranges.length)CSS.highlights.set('page-search-evidence',new Highlight(...ranges));
 // Ranges within very long blocks scroll directly to the actual passage.
 const bounds=ranges[0]?.getBoundingClientRect();
 if(bounds&&bounds.height){window.scrollBy({top:bounds.top-innerHeight/2,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 else blocks[0]?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 return ()=>{blocks.forEach(block=>block.classList.remove('page-search-passage'));CSS.highlights?.delete('page-search-evidence');};
}
