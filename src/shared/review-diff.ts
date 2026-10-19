export interface ReviewTextEdit {start:number;end:number;replacement:string}
/** Disjoint edits in UTF-16 offsets, matching JavaScript string slicing. */
export function reviewTextEdits(original:string,replacement:string):ReviewTextEdit[]{
  if(original===replacement)return [];
  const tokenize=(value:string)=>value.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)??[];
  const before=tokenize(original),after=tokenize(replacement);
  if((before.length+1)*(after.length+1)>250000){
    const left=Array.from(original),right=Array.from(replacement);let start=0,end=0;
    while(start<left.length&&start<right.length&&left[start]===right[start])start++;
    while(end<left.length-start&&end<right.length-start&&left[left.length-1-end]===right[right.length-1-end])end++;
    const offset=left.slice(0,start).join('').length;
    return [{start:offset,end:original.length-left.slice(left.length-end).join('').length,replacement:right.slice(start,right.length-end).join('')}];
  }
  const width=after.length+1,table=new Uint32Array((before.length+1)*width);
  for(let i=before.length-1;i>=0;i--)for(let j=after.length-1;j>=0;j--)
    table[i*width+j]=before[i]===after[j]?1+table[(i+1)*width+j+1]!:Math.max(table[(i+1)*width+j]!,table[i*width+j+1]!);
  const edits:ReviewTextEdit[]=[];let i=0,j=0,offset=0,pending:ReviewTextEdit|undefined;
  function flush(){if(pending){edits.push(pending);pending=undefined;}}
  while(i<before.length||j<after.length){
    if(i<before.length&&j<after.length&&before[i]===after[j]){flush();offset+=before[i++]!.length;j++;}
    else {
      pending??={start:offset,end:offset,replacement:''};
      if(i<before.length&&(j===after.length||table[(i+1)*width+j]!>=table[i*width+j+1]!)){offset+=before[i++]!.length;pending.end=offset;}
      else pending.replacement+=after[j++]!;
    }
  }
  flush();return edits;
}
