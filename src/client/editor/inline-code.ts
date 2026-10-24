import type {Segment,TextStyle} from '../../shared/domain';

function codeSpans(text:string) {
  const spans:{start:number;end:number;text:string}[]=[];
  const runs=[...text.matchAll(/`+/g)];
  for(let i=0;i<runs.length;i++) {
    const opening=runs[i]!,start=opening.index!;
    const slashes=text.slice(0,start).match(/\\+$/)?.[0].length??0;
    if(slashes%2)continue;
    const closing=runs.findIndex((run,index)=>index>i&&run[0]===opening[0]);
    if(closing<0)continue;
    const end=runs[closing]!.index!;
    let value=text.slice(start+opening[0].length,end).replace(/\r\n?|\n/g,' ');
    if(!value)continue;
    if(value.startsWith(' ')&&value.endsWith(' ')&&value.trim())value=value.slice(1,-1);
    spans.push({start,end:end+opening[0].length,text:value});i=closing;
  }
  return spans;
}

/** Interpret backticks across clipboard formatting runs, keeping surrounding marks. */
export function inlineCodeSegments(content:Segment[]):Segment[] {
  const output:Segment[]=[];
  for(let i=0;i<content.length;) {
    const segment=content[i]!;
    if(segment.entityId||segment.code||segment.math||segment.sourceReference||segment.bibliographicReference||segment.href) {output.push(segment);i++;continue;}
    const run:Segment[]=[];
    while(i<content.length&&!content[i]!.entityId&&!content[i]!.code&&!content[i]!.math&&!content[i]!.sourceReference&&!content[i]!.bibliographicReference&&!content[i]!.href)run.push(content[i++]!);
    const text=run.map(segment=>segment.text??'').join('');
    const slice=(start:number,end:number)=>{
      let offset=0;
      return run.flatMap(segment=>{
        const value=segment.text??'',from=Math.max(0,start-offset),to=Math.min(value.length,end-offset);offset+=value.length;
        return to>from?[{...segment,text:value.slice(from,to)} as Segment]:[];
      });
    };
    let start=0;
    for(const span of codeSpans(text)) {
      output.push(...slice(start,span.start));
      const style:TextStyle=slice(span.start,span.start+1)[0]??{};
      output.push({...style,text:span.text,code:true});start=span.end;
    }
    output.push(...slice(start,text.length));
  }
  return output;
}

/** Format a completed backtick span and leave the caret outside the code. */
export function completeInlineCode(element:HTMLElement,event:InputEvent) {
  if(event.isComposing||event.inputType!=='insertText'||!event.data?.endsWith('`'))return;
  const selection=document.getSelection();
  if(!selection?.isCollapsed||!selection.rangeCount)return;
  const range=selection.getRangeAt(0),node=range.startContainer;
  if(node.nodeType!==Node.TEXT_NODE||!element.contains(node)||node.parentElement?.closest('code,a,[data-math],[data-entity]'))return;
  const before=(node.textContent??'').slice(0,range.startOffset);
  const span=codeSpans(before).find(span=>span.end===before.length);
  if(!span)return;
  const replacement=range.cloneRange();replacement.setStart(node,span.start);replacement.deleteContents();
  const code=document.createElement('code');code.textContent=span.text;replacement.insertNode(code);
  const spacer=document.createTextNode('\u200b');code.after(spacer);
  replacement.setStart(spacer,1);replacement.collapse(true);selection.removeAllRanges();selection.addRange(replacement);
}
