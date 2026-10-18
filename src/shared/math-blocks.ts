import type {Block,Segment} from './domain.js';
import {isAIExplanation} from './semantic-blocks.js';

export type MathInlinePlacement='previous'|'next'|'both';
const textTypes=new Set(['paragraph','heading1','heading2','bullet','numbered','quote','todo']);
/** Drop explicit layout spacing while preserving TeX command boundaries and row breaks. */
export function inlineMathSource(source:string):string {
  const tokens=/%[^\n]*|\\(?:hspace|mspace)\*?\s*\{[^{}]*\}|\\(?:hskip|kern|mkern)\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:em|ex|mu|pt|pc|in|bp|cm|mm|dd|cc|sp)(?![a-zA-Z])|\\(?:[a-zA-Z]+|[^\n])/g;
  return source.replace(tokens,token=>{
    const spacing=/^\\(?:q?quad|enspace|enskip|space|thinspace|medspace|thickspace|negthinspace|negmedspace|negthickspace|hfill|hfil|hss)$/.test(token)
      ||/^\\[,;:!> ]$/.test(token)
      ||/^\\(?:hspace|mspace)\*?\s*\{/.test(token)
      ||/^\\(?:hskip|kern|mkern)\s*[+-]?[\d.]/.test(token);
    // A plain space prevents commands on either side from joining into a new command.
    return spacing?' ':token;
  }).trim();
}

function compatible(equation:Block,target:Block|undefined):target is Block {
  return !!target&&textTypes.has(target.type)&&!isAIExplanation(target)
    &&target.semantic===equation.semantic&&target.semanticGroup?.id===equation.semanticGroup?.id
    &&target.column?.id===equation.column?.id&&target.column?.index===equation.column?.index;
}
export function mathInlineOptions(blocks:Block[],id:string):Record<MathInlinePlacement,boolean> {
  const index=blocks.findIndex(block=>block.id===id),equation=blocks[index];
  if(!equation||equation.type!=='math'||isAIExplanation(equation)||!inlineMathSource(equation.content.map(segment=>segment.text??'').join('')))return {previous:false,next:false,both:false};
  const previous=compatible(equation,blocks[index-1]),next=compatible(equation,blocks[index+1]);
  // Combining both text blocks keeps their shared block style and task state intact.
  const both=previous&&next&&blocks[index-1]!.type===blocks[index+1]!.type&&blocks[index-1]!.checked===blocks[index+1]!.checked;
  return {previous,next,both};
}
/** A local layout hint: prefer real prose over empty trailing blocks or headings. */
export function recommendedMathInlinePlacement(blocks:Block[],id:string):MathInlinePlacement|undefined {
  const options=mathInlineOptions(blocks,id),index=blocks.findIndex(block=>block.id===id);
  const above=blocks[index-1],below=blocks[index+1];
  const text=(block:Block|undefined)=>block?.content.map(segment=>segment.entityId?segment.mentionText??'entity':segment.text??'').join('').trim()??'';
  const before=text(above),after=text(below);
  const continuesAbove=!!before&&!/[.!?。！？]$/.test(before);
  const continuesBelow=/^[\p{Ll},;:)]/u.test(after);
  if(options.both&&above?.type==='paragraph'&&below?.type==='paragraph'&&continuesAbove&&continuesBelow)return 'both';
  const score=(block:Block|undefined,value:string)=>!value?-2:block?.type==='heading1'||block?.type==='heading2'?-1:2;
  const previousScore=score(above,before)+(continuesAbove?2:0),nextScore=score(below,after)+(continuesBelow?1:0);
  if(options.previous&&(!options.next||previousScore>=nextScore))return 'previous';
  if(options.next)return 'next';
}
function joinInline(left:Segment[],right:Segment[]):Segment[] {
  const visible=(segment:Segment)=>!!(segment.entityId||segment.math||segment.sourceReference||segment.text);
  const last=left.filter(visible).at(-1),first=right.find(visible);
  const needsSpace=last&&first&&(last.entityId||last.math||!last.text||!/\s$/.test(last.text))&&(first.entityId||first.math||!first.text||!/^\s/.test(first.text));
  return [...left,...(needsSpace?[{text:' '}]:[]),...right];
}
/** Merge with immediate compatible text neighbors; retain their IDs, formatting and citations. */
export function inlineMathBlock(blocks:Block[],id:string,placement:MathInlinePlacement):{blocks:Block[];targetId:string}|undefined {
  if(!mathInlineOptions(blocks,id)[placement])return;
  const index=blocks.findIndex(block=>block.id===id),equation=blocks[index]!;
  const math:Segment[]=[{text:inlineMathSource(equation.content.map(segment=>segment.text??'').join('')),math:true}];
  const target=blocks[index+(placement==='next'?1:-1)]!;
  let content=placement==='next'?joinInline(math,target.content):joinInline(target.content,math);
  if(placement==='both')content=joinInline(content,blocks[index+1]!.content);
  return {targetId:target.id,blocks:blocks.filter(block=>block.id!==id&&(placement!=='both'||block.id!==blocks[index+1]!.id)).map(block=>block.id===target.id?{...block,content}:block)};
}
