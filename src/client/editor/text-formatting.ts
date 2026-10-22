import {editorSelectionRanges,selectedEditorBlocks,setEditorSelectionRange} from './block-selection';

export type TextFormat='bold'|'italic'|'underline'|'strikeThrough';
export const textFormatShortcuts:Record<TextFormat,string>={bold:'⌘/Ctrl+B',italic:'⌘/Ctrl+I',underline:'⌘/Ctrl+U',strikeThrough:'⌘/Ctrl+Shift+X'};

export function shortcutTextFormat(event:Pick<KeyboardEvent,'key'|'metaKey'|'ctrlKey'|'altKey'|'shiftKey'|'isComposing'>):TextFormat|undefined {
  if(event.isComposing||event.altKey||!event.metaKey&&!event.ctrlKey)return;
  const key=event.key.toLowerCase();
  if(event.shiftKey)return key==='x'?'strikeThrough':undefined;
  return key==='b'?'bold':key==='i'?'italic':key==='u'?'underline':undefined;
}
function editable(node:Node) {
  const element=node instanceof Element?node:node.parentElement;
  if(element?.closest('[contenteditable="false"],input,textarea'))return null;
  return element?.closest<HTMLElement>('.block-content[contenteditable="true"]');
}

/** Share one formatting transaction between toolbar buttons and keyboard shortcuts. */
export function applyEditorTextFormat(root:HTMLElement,range:Range,command:TextFormat,onCommit:()=>void):boolean {
  if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return false;
  const selected=selectedEditorBlocks(root);
  if(selected?.elements.some(element=>element.dataset.semanticKind==='ai-explanation'||element.closest('[data-block-group-id]')?.getAttribute('data-semantic-kind')==='ai-explanation'))return false;
  const selection=document.getSelection();
  if(!selection)return false;
  const restore=(part:Range)=>{
    const host=editable(part.startContainer)??(part.collapsed?null:editable(editorSelectionRanges(root,part)[0]?.startContainer??root));
    if(!host||!root.contains(host)||!part.startContainer.isConnected||!part.endContainer.isConnected)return false;
    host.focus({preventScroll:true});selection.removeAllRanges();selection.addRange(part);return true;
  };
  // A collapsed command changes the style of future typing without changing the document.
  if(range.collapsed) {
    if(!restore(range))return false;
    document.execCommand(command);return true;
  }
  const ranges=editorSelectionRanges(root,range);
  if(!ranges.length)return false;
  // execCommand can split/reparent the boundary text nodes and collapse cloned
  // DOM ranges. Keep logical text offsets inside each editable instead.
  const bookmarks=ranges.map(part=>{
    const element=part.startContainer instanceof Element?part.startContainer:part.startContainer.parentElement;
    const host=element!.closest<HTMLElement>('.block-content[contenteditable="true"]')!;
    const offset=(node:Node,index:number)=>{const prefix=document.createRange();prefix.selectNodeContents(host);prefix.setEnd(node,index);return prefix.toString().length;};
    return {host,start:offset(part.startContainer,part.startOffset),end:offset(part.endContainer,part.endOffset)};
  });
  function point(host:HTMLElement,offset:number,end=false):[Node,number] {
    const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
    let node:Node|null,last:Node=host;
    while((node=walker.nextNode())) {
      const size=node.textContent?.length??0;
      if(offset<size || end&&offset===size)return [node,offset];
      offset-=size;last=node;
    }
    return [last,last===host?host.childNodes.length:last.textContent?.length??0];
  }
  const enable=!ranges.every(part=>restore(part)&&document.queryCommandState(command));
  root.dataset.formattingTransaction='true';
  try {
    for(const part of ranges)if(restore(part)&&document.queryCommandState(command)!==enable)document.execCommand(command);
  } finally {delete root.dataset.formattingTransaction;}
  const first=bookmarks[0],last=bookmarks.at(-1)!;
  if(first.host.isConnected&&last.host.isConnected) {
    const restored=document.createRange();
    restored.setStart(...point(first.host,first.start));restored.setEnd(...point(last.host,last.end,true));
    restore(restored);
    if(ranges.length>1)setEditorSelectionRange(root,restored);
  }
  onCommit();return true;
}
