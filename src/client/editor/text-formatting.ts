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
  const original=range.cloneRange();
  const enable=!ranges.every(part=>restore(part)&&document.queryCommandState(command));
  root.dataset.formattingTransaction='true';
  try {
    for(const part of ranges)if(restore(part)&&document.queryCommandState(command)!==enable)document.execCommand(command);
  } finally {delete root.dataset.formattingTransaction;}
  restore(original);
  if(ranges.length>1)setEditorSelectionRange(root,original);
  onCommit();return true;
}
