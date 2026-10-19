import {useMemo} from 'react';

export type ComparisonLayout='auto'|'split'|'unified';
type Change={kind:'equal'|'removed'|'added';text:string};

// Preserve punctuation and whitespace so OCR and line-break edits remain visible.
const tokenize=(text:string)=>text.match(/[\p{L}\p{N}\p{M}_]+|\s+|[^\p{L}\p{N}\p{M}_\s]/gu)??[];

function wordChanges(original:string,replacement:string):Change[]{
  const before=tokenize(original),after=tokenize(replacement),changes:Change[]=[];
  function append(kind:Change['kind'],text:string){
    if(!text)return;
    const previous=changes[changes.length-1];
    if(previous?.kind===kind)previous.text+=text;
    else changes.push({kind,text});
  }
  let start=0,endBefore=before.length,endAfter=after.length;
  while(start<endBefore&&start<endAfter&&before[start]===after[start])start++;
  while(endBefore>start&&endAfter>start&&before[endBefore-1]===after[endAfter-1]){endBefore--;endAfter--;}
  append('equal',before.slice(0,start).join(''));
  const rows=endBefore-start,columns=endAfter-start;
  // Bound memory and work for unusually large, completely rewritten passages.
  if(rows*columns>1_000_000){
    append('removed',before.slice(start,endBefore).join(''));
    append('added',after.slice(start,endAfter).join(''));
  }else if(rows&&columns){
    const width=columns+1,lengths=new Uint32Array((rows+1)*width);
    for(let row=rows-1;row>=0;row--)for(let column=columns-1;column>=0;column--){
      lengths[row*width+column]=before[start+row]===after[start+column]
        ?1+lengths[(row+1)*width+column+1]
        :Math.max(lengths[(row+1)*width+column],lengths[row*width+column+1]);
    }
    let row=0,column=0;
    while(row<rows&&column<columns){
      if(before[start+row]===after[start+column]){append('equal',before[start+row]);row++;column++;}
      else if(lengths[(row+1)*width+column]>=lengths[row*width+column+1])append('removed',before[start+row++]);
      else append('added',after[start+column++]);
    }
    append('removed',before.slice(start+row,endBefore).join(''));
    append('added',after.slice(start+column,endAfter).join(''));
  }else{
    append('removed',before.slice(start,endBefore).join(''));
    append('added',after.slice(start,endAfter).join(''));
  }
  append('equal',before.slice(endBefore).join(''));
  return changes;
}

function ChangeText({change}:{change:Change}){
  const whitespace=change.kind!=='equal'&&/^\s+$/.test(change.text);
  // Make whitespace-only edits distinguishable without changing copied text.
  const title=whitespace?`${change.kind==='added'?'Added':'Removed'} whitespace: ${JSON.stringify(change.text)}`:undefined;
  if(change.kind==='added')return <ins className="reprocessing-diff-added" title={title}>{change.text}</ins>;
  if(change.kind==='removed')return <del className="reprocessing-diff-removed" title={title}>{change.text}</del>;
  return <span className="reprocessing-diff-context">{change.text}</span>;
}

export function SourcePatchComparison({original,replacement,layout}:{original:string;replacement:string;layout:ComparisonLayout}){
  const changes=useMemo(()=>wordChanges(original,replacement),[original,replacement]);
  const render=(side?:'original'|'replacement')=>changes.map((change,index)=>
    (side==='original'&&change.kind==='added')||(side==='replacement'&&change.kind==='removed')
      ?null:<ChangeText key={index} change={change}/>);
  return <div className="reprocessing-diff" data-layout={layout}>
    <div className="reprocessing-diff-legend" aria-label="Change highlighting"><span className="reprocessing-diff-removed">Deletions</span><span className="reprocessing-diff-added">Additions</span></div>
    <div className="reprocessing-comparison reprocessing-diff-split">
      <div><h4>Original processed</h4><pre>{original?render('original'):<span className="reprocessing-diff-context">(Empty passage)</span>}</pre></div>
      <div><h4>Suggested revision</h4><pre>{replacement?render('replacement'):<span className="reprocessing-diff-context">(Removed from reading text; preserved in provenance)</span>}</pre></div>
    </div>
    <div className="reprocessing-comparison reprocessing-diff-unified"><div><h4>Original → Suggested revision</h4><pre>{render()}</pre></div></div>
  </div>;
}
