/** Read actual wrapped line boundaries without changing the preview's text or layout. */
export function renderedReviewLines(element:HTMLElement):Array<{start:number;end:number}> {
  const doc=element.ownerDocument,walker=doc.createTreeWalker(element,4);
  const nodes:Array<{node:Text;start:number;end:number}>=[];
  let total=0;
  for(let node=walker.nextNode();node;node=walker.nextNode()){
    const length=node.textContent?.length??0;
    if(length)nodes.push({node:node as Text,start:total,end:total+length});
    total+=length;
  }
  if(!total)return [];
  const range=doc.createRange();
  const rectAt=(index:number)=>{
    const entry=nodes.find(item=>index<item.end)!;
    let offset=index-entry.start;
    const value=entry.node.data;
    if(offset>0&&/[\uDC00-\uDFFF]/.test(value[offset]!))offset--;
    const length=/[\uD800-\uDBFF]/.test(value[offset]!)?2:1;
    range.setStart(entry.node,offset);range.setEnd(entry.node,Math.min(value.length,offset+length));
    return range.getBoundingClientRect();
  };
  const lines:Array<{start:number;end:number}>=[];
  for(let start=0;start<total;){
    const rect=rectAt(start);
    // A temporarily unlaid-out paragraph is kept intact until the resize observer runs.
    if(!rect.height)return [{start:0,end:total}];
    let low=start+1,high=total;
    while(low<high){
      const mid=Math.floor((low+high)/2);
      if(Math.abs(rectAt(mid).top-rect.top)<1)low=mid+1;
      else high=mid;
    }
    lines.push({start,end:low});start=low;
  }
  return lines;
}
