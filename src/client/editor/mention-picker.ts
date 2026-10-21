import type {Entity} from '../../shared/domain';

export interface MentionMatchOptions {
  /** Most-recent-first entity IDs already used in the current page, including citations. */
  priorityIds?: readonly string[];
  limit?: number;
}

const normalized=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').trim().replace(/\s+/g,' ').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').toLocaleLowerCase();
const words=(value:string)=>value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Only use bounded edit distance as a fallback: short or vague queries should not flood the picker. */
function closeSpelling(left:string,right:string,max:number) {
  if(Math.abs(left.length-right.length)>max)return false;
  let row=Array.from({length:right.length+1},(_,index)=>index);
  for(let i=1;i<=left.length;i++){
    const next=[i];
    for(let j=1;j<=right.length;j++)next[j]=Math.min(next[j-1]!+1,row[j]!+1,row[j-1]!+(left[i-1]===right[j-1]?0:1));
    if(Math.min(...next)>max)return false;
    row=next;
  }
  return row[right.length]!<=max;
}

/** Exact names and aliases outrank prefixes, complete words, substrings, and spelling suggestions.
 * Page usage breaks ties within the same lexical class, never overriding an exact match.
 */
function matchRank(name:string,needle:string) {
  if(!needle)return 20;
  if(name===needle)return 0;
  if(name.startsWith(needle))return 2;
  const parts=words(name);
  if(parts.includes(needle))return 4;
  if(parts.some(part=>part.startsWith(needle)))return 6;
  const terms=words(needle);
  if(terms.length>1&&terms.every((term,i)=>parts.slice(i).some(part=>part.startsWith(term))))return 7;
  if(name.includes(needle))return 8;
  if(needle.length>=4&&needle.length<=60){
    const max=needle.length>=7?2:1;
    if(parts.some(part=>closeSpelling(part,needle,max))||Math.abs(name.length-needle.length)<=max&&closeSpelling(name,needle,max))return 10;
  }
  return Infinity;
}
export function mentionMatches(entities:Entity[],query:string,options:MentionMatchOptions={}):Entity[] {
  const needle=normalized(query);
  const priorities=new Map((options.priorityIds??[]).map((id,index)=>[id,index]));
  const matches=entities.filter(entity=>!entity.archived_at&&!entity.inactive).map(entity=>{
    const score=Math.min(matchRank(normalized(entity.name),needle),...(entity.aliases??[]).map(alias=>matchRank(normalized(alias),needle)+1));
    return {entity,score,priority:priorities.get(entity.id)??Infinity};
  }).filter(match=>Number.isFinite(match.score));
  matches.sort((a,b)=>a.score-b.score||a.priority-b.priority||a.entity.name.localeCompare(b.entity.name)||a.entity.id.localeCompare(b.entity.id));
  return matches.slice(0,options.limit??matches.length).map(match=>match.entity);
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
