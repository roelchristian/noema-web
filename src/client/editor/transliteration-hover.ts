// Paint correspondence without adding wrappers to the editable document or moving its caret.
const highlightName='transliteration-word';
let activeOwner:symbol|undefined;
interface HighlightRegistry {set:(name:string,value:unknown)=>void;delete:(name:string)=>void}
interface HighlightWindow extends Window {
  CSS?:{highlights?:HighlightRegistry};
  Highlight?:new(...ranges:Range[])=>unknown;
}
interface Word {start:number;end:number}
interface TextIndex {nodes:{node:Text;start:number;end:number}[];words:Word[]}
const excluded='[data-source-reference],[data-bibliographic-reference],.inline-math,code,svg,.icon,[aria-hidden="true"]';

function textIndex(host:HTMLElement):TextIndex {
  const nodes:TextIndex['nodes']=[];
  const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
  let text='',node:Node|null;
  while((node=walker.nextNode())){
    if(node.parentElement?.closest(excluded))continue;
    const start=text.length;
    text+=node.textContent??'';
    nodes.push({node:node as Text,start,end:text.length});
  }
  const words:Word[]=[];
  // Keep offsets stable while ignoring legacy citation placeholders and editor caret spacers.
  const prose=text.replace(/\[ref\]/gi,match=>' '.repeat(match.length)).replace(/\u200b/g,' ');
  for(const match of prose.matchAll(/[\p{L}\p{M}\p{N}]+(?:[ʹʺʿʾ'’\u200c\u200d][\p{L}\p{M}\p{N}]+)*[ʹʺʿʾ]?/gu)){
    words.push({start:match.index,end:match.index+match[0].length});
  }
  return {nodes,words};
}
function wordRange(index:TextIndex,word:Word):Range|null {
  const start=index.nodes.find(item=>item.start<=word.start&&item.end>word.start);
  const end=index.nodes.find(item=>item.start<word.end&&item.end>=word.end);
  if(!start||!end)return null;
  const range=document.createRange();
  range.setStart(start.node,word.start-start.start);
  range.setEnd(end.node,word.end-end.start);
  return range;
}

export function attachTransliterationHover(transliteration:HTMLElement) {
  const view=document.defaultView as HighlightWindow|null;
  const registry=view?.CSS?.highlights,Highlight=view?.Highlight;
  const block=transliteration.parentElement;
  const source=block?.querySelector<HTMLElement>(':scope > .block-content');
  if(!view||!registry||!Highlight||!block||!source)return ()=>{};
  const owner=Symbol();
  let indexes:[TextIndex,TextIndex]|undefined,frame=0,point:{x:number;y:number;host:HTMLElement}|undefined;
  const clear=()=>{
    if(activeOwner===owner){registry.delete(highlightName);activeOwner=undefined;}
  };
  const paint=()=>{
    frame=0;
    if(!point||!document.getSelection()?.isCollapsed){clear();return;}
    const caretDocument=document as Document&{caretPositionFromPoint?:(x:number,y:number)=>{offsetNode:Node;offset:number}|null;caretRangeFromPoint?:(x:number,y:number)=>Range|null};
    const position=caretDocument.caretPositionFromPoint?.(point.x,point.y);
    const caret=position?null:caretDocument.caretRangeFromPoint?.(point.x,point.y);
    const node=position?.offsetNode??caret?.startContainer,offset=position?.offset??caret?.startOffset;
    if(!node||offset===undefined||!point.host.contains(node)||node.parentElement?.closest(excluded)){clear();return;}
    indexes??=[textIndex(source),textIndex(transliteration)];
    // Each script word projects to one Latin word. Avoid guessing if rendered content differs.
    if(indexes[0].words.length!==indexes[1].words.length){clear();return;}
    const side=point.host===source?0:1,index=indexes[side];
    const item=index.nodes.find(item=>item.node===node);
    if(!item){clear();return;}
    const at=item.start+offset;
    const word=index.words.findIndex(word=>word.start<=at&&word.end>=at);
    if(word<0){clear();return;}
    const range=wordRange(index,index.words[word]!);
    if(!range||!Array.from(range.getClientRects()).some(rect=>point!.x>=rect.left&&point!.x<=rect.right&&point!.y>=rect.top&&point!.y<=rect.bottom)){clear();return;}
    const counterpart=wordRange(indexes[side===0?1:0],indexes[side===0?1:0].words[word]!);
    if(!counterpart){clear();return;}
    registry.set(highlightName,new Highlight(range,counterpart));
    activeOwner=owner;
  };
  const move=(event:PointerEvent)=>{
    const target=event.target instanceof Element?event.target:null;
    const host=target?.closest('.block-content,.block-transliteration');
    if(event.pointerType==='touch'||event.buttons||!host||host!==source&&host!==transliteration||target?.closest(excluded)){point=undefined;clear();return;}
    point={x:event.clientX,y:event.clientY,host:host as HTMLElement};
    if(!frame)frame=view.requestAnimationFrame(paint);
  };
  const leave=()=>{point=undefined;clear();};
  const invalidate=()=>{indexes=undefined;leave();};
  const observer=new MutationObserver(invalidate);
  observer.observe(source,{subtree:true,childList:true,characterData:true});
  observer.observe(transliteration,{subtree:true,childList:true,characterData:true});
  block.addEventListener('pointermove',move);
  block.addEventListener('pointerleave',leave);
  block.addEventListener('pointerdown',leave);
  document.addEventListener('selectionchange',leave);
  document.addEventListener('scroll',leave,true);
  return ()=>{
    if(frame)view.cancelAnimationFrame(frame);
    observer.disconnect();clear();
    block.removeEventListener('pointermove',move);
    block.removeEventListener('pointerleave',leave);
    block.removeEventListener('pointerdown',leave);
    document.removeEventListener('selectionchange',leave);
    document.removeEventListener('scroll',leave,true);
  };
}
