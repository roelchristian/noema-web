/** Stable references to extracted text; these are not printed PDF line/page numbers. */
export function sourceTextLines(text:string):string[] {return text.replace(/\r\n?/g,'\n').split('\n');}
export function numberedSourceText(text:string):string {return sourceTextLines(text).map((line,index)=>`[L${index+1}] ${line}`).join('\n');}
/** Physical PDF page positions, recorded by the extractor independently of text. */
export function sourcePageRange(starts:number[],startLine:number,endLine:number):{startPage:number;endPage:number}|undefined {
  if(!starts.length)return;
  const page=(line:number)=>{let result=1;for(let index=0;index<starts.length&&starts[index]!<=line;index++)result=index+1;return result;};
  return {startPage:page(startLine),endPage:page(endLine)};
}
