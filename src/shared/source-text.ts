/** Stable references to extracted text; these are not printed PDF line/page numbers. */
export function sourceTextLines(text:string):string[] {return text.replace(/\r\n?/g,'\n').split('\n');}
export function numberedSourceText(text:string):string {return sourceTextLines(text).map((line,index)=>`[L${index+1}] ${line}`).join('\n');}
