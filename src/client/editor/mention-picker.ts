import type {Entity} from '../../shared/domain';

const normalized=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase();

/** Rank precise names and aliases before broader substring matches. */
export function mentionMatches(entities:Entity[],query:string):Entity[] {
  const needle=normalized(query);
  const rank=(value:string,alias:boolean)=>{
    const name=normalized(value);
    if(!needle)return 0;
    if(name===needle)return alias?1:0;
    if(name.startsWith(needle))return alias?3:2;
    if(name.split(/\s+/).some(word=>word.startsWith(needle)))return alias?5:4;
    return name.includes(needle)?alias?7:6:Infinity;
  };
  return entities.map(entity=>({entity,score:Math.min(rank(entity.name,false),...(entity.aliases??[]).map(alias=>rank(alias,true)))}))
    .filter(match=>Number.isFinite(match.score))
    .sort((a,b)=>a.score-b.score||a.entity.name.localeCompare(b.entity.name)||a.entity.id.localeCompare(b.entity.id))
    .map(match=>match.entity);
}

/** Measure the insertion point without changing editor content or selection. */
export function mentionCaretRect(range:Range,editor:HTMLElement):{left:number;right:number;top:number;bottom:number} {
  const caret=range.cloneRange();caret.collapse(false);
  const box=Array.from(caret.getClientRects()).find(rect=>rect.height>0);
  if(box)return box;
  if(caret.startContainer.nodeType===Node.TEXT_NODE&&caret.startOffset>0) {
    const previous=caret.cloneRange();previous.setStart(caret.startContainer,caret.startOffset-1);
    const last=Array.from(previous.getClientRects()).at(-1);
    if(last?.height){const left=getComputedStyle(editor).direction==='rtl'?last.left:last.right;return {left,right:left,top:last.top,bottom:last.bottom};}
  }
  const bounds=editor.getBoundingClientRect(),lineHeight=parseFloat(getComputedStyle(editor).lineHeight)||20;
  return {left:bounds.left,right:bounds.left,top:bounds.top,bottom:bounds.top+lineHeight};
}
