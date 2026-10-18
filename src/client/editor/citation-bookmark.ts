/** Saved editor coordinates must survive innerHTML replacement while a picker has focus. */
export interface CitationBookmark {start:number;end:number;content:string}
const atomic=(node:Node)=>node instanceof HTMLElement&&node.contentEditable==='false';
function logicalText(node:Node):string {
  if(atomic(node))return '\ufffc';
  if(node.nodeType===Node.TEXT_NODE)return (node.textContent??'').replace(/\u200b/g,'');
  if(node instanceof HTMLElement&&node.tagName==='BR')return '\n';
  return Array.from(node.childNodes).map(logicalText).join('');
}
export function bookmarkCitationRange(editor:HTMLElement,range:Range):CitationBookmark {
  const prefix=range.cloneRange();prefix.selectNodeContents(editor);prefix.setEnd(range.startContainer,range.startOffset);
  const through=range.cloneRange();through.selectNodeContents(editor);through.setEnd(range.endContainer,range.endOffset);
  return {start:logicalText(prefix.cloneContents()).length,end:logicalText(through.cloneContents()).length,content:logicalText(editor)};
}
export function resolveCitationRange(editor:HTMLElement,bookmark:CitationBookmark):Range|null {
  // Never insert at a guessed position if actual prose or inline items changed.
  if(!editor.isConnected||logicalText(editor)!==bookmark.content)return null;
  function pointAt(offset:number):{node:Node;offset:number} {
    let remaining=offset,result:{node:Node;offset:number}|undefined;
    function visit(node:Node):boolean {
      if(atomic(node)||node instanceof HTMLElement&&node.tagName==='BR'){
        if(remaining<=1){const parent=node.parentNode!;result={node:parent,offset:Array.from(parent.childNodes).indexOf(node as ChildNode)+(remaining?1:0)};return true;}
        remaining--;return false;
      }
      if(node.nodeType===Node.TEXT_NODE){
        const text=node.textContent??'',size=text.replace(/\u200b/g,'').length;
        if(remaining<=size){let index=0,count=0;while(index<text.length&&count<remaining){if(text[index]!=='\u200b')count++;index++;}result={node,offset:index};return true;}
        remaining-=size;return false;
      }
      return Array.from(node.childNodes).some(visit);
    }
    visit(editor);return result??{node:editor,offset:editor.childNodes.length};
  }
  const start=pointAt(bookmark.start),end=pointAt(bookmark.end),range=document.createRange();
  range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);return range;
}
