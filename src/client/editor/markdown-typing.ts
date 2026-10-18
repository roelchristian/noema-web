import type {Block,Entity} from '../../shared/domain';
import {isAIExplanation} from '../../shared/semantic-blocks';
import {allowedInColumn} from '../../shared/column-blocks';
import {markdownBlocks,markdownInline,markdownSegments} from './paste';
import {segmentHTML} from './segments';
import {completeInlineCode} from './inline-code';

/** Convert literal Markdown without interpreting existing rich text, code, or citations again. */
export function formatMarkdownBlocks(blocks:Block[]):Block[] {
  const formatted=blocks.flatMap(block=>{
    if(isAIExplanation(block)||['code','math','image','divider'].includes(block.type))return [block];
    if(block.type==='table'||block.type==='columns')return [{...block,rows:block.rows?.map(row=>row.map(markdownSegments))}];
    const plain=block.content.every(segment=>Object.keys(segment).every(key=>key==='text'));
    if(block.type==='paragraph'&&plain) {
      const parsed=markdownBlocks(block.content.map(segment=>segment.text??'').join(''));
      if(!block.column||parsed.every(block=>allowedInColumn(block.type)))return parsed.map((parsed,index)=>({...block,...parsed,id:index===0?block.id:parsed.id}));
    }
    return [{...block,content:markdownSegments(block.content)}];
  });
  return formatted.length<=2000?formatted:blocks;
}

/** Only a completed expression at the typing caret becomes native formatting. */
export function completeTypedMarkdown(element:HTMLElement,event:InputEvent,entities:Entity[]) {
  if(event.isComposing||event.inputType!=='insertText')return;
  completeInlineCode(element,event);
  const selection=document.getSelection();
  if(!selection?.isCollapsed||!selection.rangeCount)return;
  const range=selection.getRangeAt(0),node=range.startContainer;
  if(node.nodeType!==Node.TEXT_NODE||!element.contains(node)||node.parentElement?.closest('code,a,[data-math],[data-entity]'))return;
  const before=(node.textContent??'').slice(0,range.startOffset);
  const match=before.match(/(?<![\\*])\*\*([^*\n]+)\*\*$|(?<![\\\w])__([^_\n]+)__$|(?<![\\~])~~([^~\n]+)~~$|(?<![\\*])\*([^*\n]+)\*$|(?<![\\\w])_([^_\n]+)_$|(?<![\\\[])\[([^\]\n]+)\]\(([^\s)]+)\)$/);
  if(!match)return;
  // Do not format emphasis or links inside an unfinished code span.
  const prefix=before.slice(0,match.index);
  if(/(?<!\\)`/.test(prefix))return;
  const content=markdownInline(match[0]);
  if(!content.some(segment=>segment.bold||segment.italic||segment.strike||segment.href))return;
  const replacement=range.cloneRange();replacement.setStart(node,match.index!);replacement.deleteContents();
  const wrapper=document.createElement('span');wrapper.innerHTML=segmentHTML(content,entities);
  replacement.insertNode(wrapper);
  const spacer=document.createTextNode('\u200b');wrapper.after(spacer);
  replacement.setStart(spacer,1);replacement.collapse(true);selection.removeAllRanges();selection.addRange(replacement);
}

/** Recognize block prefixes after their trailing space, or a completed fence/divider. */
export function typedMarkdownBlock(block:Block,element:HTMLElement):Partial<Block>|undefined {
  if(element.querySelector('code,a,[data-math],[data-entity]'))return;
  const text=(element.textContent??'').replace(/\u200b/g,'');
  if(block.type==='bullet'&&/^\[[ xX]\] $/.test(text))return {type:'todo',checked:/\[[xX]\]/.test(text),content:[]};
  if(block.type!=='paragraph')return;
  const heading=text.match(/^(#{1,6}) $/);
  if(heading)return {type:heading[1]!.length===1?'heading1':'heading2',content:[]};
  if(/^[-*+] \[[ xX]\] $/.test(text))return {type:'todo',checked:/\[[xX]\]/.test(text),content:[]};
  if(/^[-*+] $/.test(text))return {type:'bullet',content:[]};
  if(/^\d+[.)] $/.test(text))return {type:'numbered',content:[]};
  if(text==='> ')return {type:'quote',content:[]};
  if(/^(```|~~~) ?$/.test(text))return {type:'code',content:[]};
  if(/^(---|\*\*\*|___) $/.test(text))return {type:'divider',content:[]};
}
