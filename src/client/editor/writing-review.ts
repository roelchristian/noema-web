import type {Block,Segment} from '../../shared/domain';
import type {EditorReviewText,EditorReviewSuggestion} from '../../shared/editor-review';
import {isAIExplanation} from '../../shared/semantic-blocks';
import {editorSelectionRange,editorSelectionRanges} from './block-selection';
import {readSegments} from './segments';

export interface WritingReviewTarget {
  blockId:string; scope:'span'|'block'; snapshot:string;
  before:Segment[]; selected:Segment[]; after:Segment[];
  texts:EditorReviewText[];
}
export interface WritingReviewChange extends WritingReviewTarget {replacement:Segment[]; reasons:string[]}
// cloneContents omits the common ancestor's formatting (for example a selection
// entirely inside <strong>). Recreate that ancestry before reading its segments.
function rangeSegments(range:Range,editor:HTMLElement):Segment[]{
  let fragment:Node=range.cloneContents();
  let ancestor=range.commonAncestorContainer instanceof Element?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
  while(ancestor&&ancestor!==editor&&editor.contains(ancestor)){
    const wrapper=ancestor.cloneNode(false);wrapper.appendChild(fragment);fragment=wrapper;ancestor=ancestor.parentElement;
  }
  const container=document.createDocumentFragment();container.appendChild(fragment);
  return readSegments(container);
}
export function captureWritingReview(root:HTMLElement,blocks:Block[],ids?:string[]):WritingReviewTarget[] {
  const selection=ids?null:editorSelectionRange(root);
  const portions=selection?editorSelectionRanges(root,selection):[];
  return blocks.flatMap(block=>{
    if(isAIExplanation(block)||['code','math','image','divider','table','columns'].includes(block.type)||ids&&!ids.includes(block.id))return [];
    const row=Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]')).find(el=>el.dataset.blockId===block.id);
    const editor=row?.querySelector<HTMLElement>('.block-content[contenteditable="true"]');
    if(!editor)return [];
    const portion=ids?null:portions.find(range=>editor.contains(range.startContainer)&&editor.contains(range.endContainer))?.cloneRange();
    if(!ids&&!portion)return [];
    const whole=document.createRange();whole.selectNodeContents(editor);
    let before:Segment[]=[],after:Segment[]=[],selected=readSegments(editor);
    if(portion){
      // References and equations are atomic, even when a selection ends inside one.
      for(const edge of ['start','end'] as const){
        const node=edge==='start'?portion.startContainer:portion.endContainer;
        const atom=(node instanceof Element?node:node.parentElement)?.closest('[data-entity],[data-math],[data-source-reference]');
        if(atom&&editor.contains(atom)){if(edge==='start')portion.setStartBefore(atom);else portion.setEndAfter(atom);}
      }
      const prefix=whole.cloneRange();prefix.setEnd(portion.startContainer,portion.startOffset);before=rangeSegments(prefix,editor);
      const suffix=whole.cloneRange();suffix.setStart(portion.endContainer,portion.endOffset);after=rangeSegments(suffix,editor);
      selected=rangeSegments(portion,editor);
    }
    const texts=selected.flatMap((segment,index)=>segment.text?.trim()&&!segment.math&&!segment.code&&!segment.sourceReference&&!segment.skipAutoTag?[{id:`${block.id}:${index}`,text:segment.text}]:[]);
    if(!texts.length)return [];
    return [{blockId:block.id,scope:portion&&(before.some(hasContent)||after.some(hasContent))?'span' as const:'block' as const,snapshot:JSON.stringify(block.content),before,selected,after,texts}];
  });
}
function hasContent(segment:Segment){return !!(segment.text||segment.entityId);}
export function writingReviewChanges(targets:WritingReviewTarget[],suggestions:EditorReviewSuggestion[]):WritingReviewChange[]{
  const replacements=new Map(suggestions.map(item=>[item.id,item]));
  return targets.flatMap(target=>{
    const reasons:string[]=[];
    const replacement=target.selected.map((segment,index)=>{
      const suggestion=replacements.get(`${target.blockId}:${index}`);
      if(!suggestion)return segment;
      reasons.push(suggestion.reason);return {...segment,text:suggestion.replacement} as Segment;
    });
    return reasons.length?[{...target,replacement,reasons:[...new Set(reasons)]}]:[];
  });
}
