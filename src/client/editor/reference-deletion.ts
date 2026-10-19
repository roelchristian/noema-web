import {editorSelectionRange} from './block-selection';

const surfaceOf=(node:Node|null)=>(node instanceof Element?node:node?.parentElement)?.closest<HTMLElement>('.block-content[contenteditable="true"]');

/** Delete entity mentions and references as whole units at noneditable boundaries.
 * WebKit can leave the caret inside an atom or refuse native deletion beside it. */
export function deleteEditorReference(root:HTMLElement,target:EventTarget|null,direction:'backward'|'forward'):boolean {
  const focused=target instanceof Element?target.closest<HTMLElement>('[data-entity],[data-source-reference]'):null;
  const selection=document.getSelection();
  if(!selection)return false;
  const current=editorSelectionRange(root,selection);
  if(current&&!current.collapsed&&surfaceOf(current.startContainer)!==surfaceOf(current.endContainer))return false;
  const host=focused?surfaceOf(focused):surfaceOf(current?.startContainer??null);
  if(!host||!root.contains(host)||host.closest('[inert],[data-semantic-kind="ai-explanation"]'))return false;
  const range=document.createRange();
  if(focused&&host.contains(focused))range.selectNode(focused);
  else {
    if(!current||surfaceOf(current.endContainer)!==host)return false;
    range.setStart(current.startContainer,current.startOffset);range.setEnd(current.endContainer,current.endOffset);
    const references=Array.from(host.querySelectorAll<HTMLElement>('[data-entity],[data-source-reference]'));
    if(!range.collapsed) {
      const selected=references.filter(reference=>range.intersectsNode(reference));
      if(!selected.length)return false;
      for(const reference of selected){
        if(reference.contains(range.startContainer))range.setStartBefore(reference);
        if(reference.contains(range.endContainer))range.setEndAfter(reference);
      }
    } else {
      const candidates=direction==='backward'?references.reverse():references;
      const adjacent=candidates.find(reference=>{
        if(reference.contains(range.startContainer))return true;
        const parent=reference.parentNode!,index=Array.from(parent.childNodes).indexOf(reference);
        const side=range.comparePoint(parent,index+(direction==='backward'?1:0));
        if(direction==='backward'?side>0:side<0)return false;
        const gap=range.cloneRange();
        if(direction==='backward')gap.setStartAfter(reference);else gap.setEndBefore(reference);
        const contents=gap.cloneContents();
        // Skip only invisible caret spacers, never prose, spaces, or other atoms.
        return !(contents.textContent??'').replace(/\u200b/g,'')&&!contents.querySelector('[contenteditable="false"],br');
      });
      if(!adjacent)return false;
      range.selectNode(adjacent);
    }
  }
  range.deleteContents();range.collapse(true);
  host.focus({preventScroll:true});selection.removeAllRanges();selection.addRange(range);
  return true;
}
