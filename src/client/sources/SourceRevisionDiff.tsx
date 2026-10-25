import {useEffect,useId,useMemo,useRef,useState} from 'react';
import type {SourceEditorialPatch,SourceReprocessingRevision} from '../../shared/source-reprocessing';
import {t as uiText,getLocale} from '../i18n';
import {SourceReaderText} from './SourceReaderText';
import './source-revision-diff.css';

type Decision=SourceEditorialPatch['decision'];
type Props={revision:SourceReprocessingRevision;disabled:boolean;patches?:SourceEditorialPatch[];onDecision:(patch:SourceEditorialPatch,decision:Decision)=>Promise<void>;onDecisions?:(patches:SourceEditorialPatch[],decision:'accepted'|'rejected')=>Promise<void>;onEdit?:(patch:SourceEditorialPatch)=>void;onLocate?:(patch:SourceEditorialPatch)=>void;onCompare?:(page:number)=>void};
export type RevisionDiffLine={kind:'context'|'removed'|'added';text:string;oldLine:number|null;newLine:number|null};

/** A filter must never split an atomic group (for example a note and its reference). */
export function buildRevisionDiffGroups(all:SourceEditorialPatch[],visible=all):SourceEditorialPatch[][] {
 const requested=new Set(visible.map(patch=>patch.id)),groups=new Map<string,SourceEditorialPatch[]>();
 for(const patch of all){const key=patch.patchGroupId?`group:${patch.patchGroupId}`:`patch:${patch.id}`;const group=groups.get(key)??[];group.push(patch);groups.set(key,group);}
 return [...groups.values()].filter(group=>group.some(patch=>requested.has(patch.id))).map(group=>group.sort((a,b)=>a.range.startOffset-b.range.startOffset)).sort((a,b)=>a[0]!.range.startOffset-b[0]!.range.startOffset);
}

/** Bounded line LCS preserves every source character, including blank lines. */
export function revisionDiffLines(before:string,after:string,oldStart=1,newStart=1):RevisionDiffLine[]{
 const beforeLines=before?before.split('\n'):[],afterLines=after?after.split('\n'):[],rows:RevisionDiffLine[]=[];
 let oldLine=oldStart,newLine=newStart;
 const append=(kind:RevisionDiffLine['kind'],text:string)=>{rows.push({kind,text,oldLine:kind==='added'?null:oldLine++,newLine:kind==='removed'?null:newLine++});};
 let start=0,endBefore=beforeLines.length,endAfter=afterLines.length;
 while(start<endBefore&&start<endAfter&&beforeLines[start]===afterLines[start])append('context',beforeLines[start++]!);
 while(endBefore>start&&endAfter>start&&beforeLines[endBefore-1]===afterLines[endAfter-1]){endBefore--;endAfter--;}
 const height=endBefore-start,width=endAfter-start;
 if(height*width>250_000){for(let i=start;i<endBefore;i++)append('removed',beforeLines[i]!);for(let i=start;i<endAfter;i++)append('added',afterLines[i]!);}
 else{
  const stride=width+1,lengths=new Uint32Array((height+1)*stride);
  for(let row=height-1;row>=0;row--)for(let col=width-1;col>=0;col--)lengths[row*stride+col]=beforeLines[start+row]===afterLines[start+col]?1+lengths[(row+1)*stride+col+1]!:Math.max(lengths[(row+1)*stride+col]!,lengths[row*stride+col+1]!);
  let row=0,col=0;
  while(row<height&&col<width){if(beforeLines[start+row]===afterLines[start+col]){append('context',beforeLines[start+row++]!);col++;}else if(lengths[(row+1)*stride+col]!>=lengths[row*stride+col+1]!)append('removed',beforeLines[start+row++]!);else append('added',afterLines[start+col++]!);}
  while(row<height)append('removed',beforeLines[start+row++]!);
  while(col<width)append('added',afterLines[start+col++]!);
 }
 for(let i=endBefore;i<beforeLines.length;i++)append('context',beforeLines[i]!);
 return rows;
}

export type RevisionSplitRow={left:RevisionDiffLine|null;right:RevisionDiffLine|null};
/** Pair changed runs until the next shared context, keeping insertions/deletions aligned. */
export function revisionSplitRows(rows:RevisionDiffLine[]):RevisionSplitRow[]{
 const result:RevisionSplitRow[]=[];
 for(let index=0;index<rows.length;){
  const row=rows[index]!;
  if(row.kind==='context'){result.push({left:row,right:row});index++;continue;}
  const removed:RevisionDiffLine[]=[],added:RevisionDiffLine[]=[];
  while(index<rows.length&&rows[index]!.kind!=='context'){const changed=rows[index++]!;(changed.kind==='removed'?removed:added).push(changed);}
  for(let i=0;i<Math.max(removed.length,added.length);i++)result.push({left:removed[i]??null,right:added[i]??null});
 }
 return result;
}

type DisplayRow={left:RevisionDiffLine[];right:RevisionDiffLine[]};
function displayRows(rows:RevisionDiffLine[],split:boolean,rendered:boolean):DisplayRow[]{
 if(!rendered)return split?revisionSplitRows(rows).map(({left,right})=>({left:left?[left]:[],right:right?[right]:[]})):rows.map(row=>({left:[row],right:[]}));
 const result:DisplayRow[]=[];
 for(const row of rows){
  const last=result.at(-1),previous=last?.left[0]??last?.right[0];
  const same=previous&&(split?(previous.kind==='context')===(row.kind==='context'):previous.kind===row.kind);
  const next=same?last!:{left:[],right:[]};
  if(!same)result.push(next);
  if(!split||row.kind!=='added')next.left.push(row);
  if(split&&row.kind!=='removed')next.right.push(row);
 }
 return result;
}

/** Context always compares canonical text with the complete proposal in that interval.
 * Expand across intersecting patches so no changed text is presented as unchanged. */
export function buildRevisionDiffContext(text:string,patch:SourceEditorialPatch,all:SourceEditorialPatch[]){
 const start=patch.range.startOffset,end=patch.range.endOffset;
 const lineStart=(offset:number)=>offset===0?0:text.lastIndexOf('\n',offset-1)+1;
 const lineEnd=(offset:number)=>{const next=text.indexOf('\n',offset);return next<0?text.length:next;};
 let from=lineStart(start),to=lineEnd(end);
 // Two unchanged lines provide orientation without expanding distant linked notes.
 for(let i=0;i<2;i++){if(from>0)from=text.lastIndexOf('\n',from-2)+1;if(to<text.length){const next=text.indexOf('\n',to+1);to=next<0?text.length:next;}}
 const ordered=[...all].sort((a,b)=>a.range.startOffset-b.range.startOffset);
 const intersects=(item:SourceEditorialPatch)=>item.id===patch.id||(item.range.startOffset===item.range.endOffset?item.range.startOffset>=from&&item.range.startOffset<=to:item.range.startOffset<to&&item.range.endOffset>from);
 let changed=true;
 while(changed){changed=false;for(const item of ordered){if(!intersects(item))continue;const nextFrom=Math.min(from,lineStart(item.range.startOffset)),nextTo=Math.max(to,lineEnd(item.range.endOffset));if(nextFrom!==from||nextTo!==to){from=nextFrom;to=nextTo;changed=true;}}}
 const included=ordered.filter(intersects),includedIds=new Set(included.map(item=>item.id));
 const before=text.slice(from,to);let after=before;
 for(const item of [...included].reverse())after=after.slice(0,item.range.startOffset-from)+(item.userReplacement??item.replacement)+after.slice(item.range.endOffset-from);
 let delta=0;
 for(const item of ordered){if(includedIds.has(item.id)||item.range.endOffset>from)continue;delta+=((item.userReplacement??item.replacement).match(/\n/g)?.length??0)-(text.slice(item.range.startOffset,item.range.endOffset).match(/\n/g)?.length??0);}
 const line=text.slice(0,from).split('\n').length;
 return {before,after,line,newLine:line+delta,from,to,patchIds:included.map(item=>item.id)};
}

function Notes({group}:{group:SourceEditorialPatch[]}){
 return <details className="revision-diff-notes">
  <summary aria-label={uiText('Change notes')} title={uiText('Change notes')}><span aria-hidden="true">ⓘ</span></summary>
  <div className="revision-diff-notes-body">{group.map((patch,index)=><section key={patch.id}>
   <strong>{group.length>1?`${index+1}. `:''}{uiText(patch.category.replaceAll('_',' '))}</strong>
   <p>{patch.reason}</p>
   {!!patch.riskReasons?.length&&<><strong>{uiText('Review carefully')}</strong><ul>{patch.riskReasons.map(reason=><li key={reason}>{reason}</li>)}</ul></>}
   {patch.autoAcceptance&&<><strong>{uiText('Acceptance evidence')}</strong><p>{patch.autoAcceptance.validator} · {patch.autoAcceptance.policy}</p><ul>{patch.autoAcceptance.checks.map(check=><li key={check}>{check}</li>)}</ul></>}
   {!!patch.decisionHistory?.length&&<details><summary>{uiText('Decision history')}</summary><ol>{patch.decisionHistory.map((entry,i)=><li key={i}>{new Date(entry.at).toLocaleString(getLocale())} · {entry.actor} · {entry.from} → {entry.to}</li>)}</ol></details>}
   {patch.confidence>0&&<small>{uiText('AI confidence:')} {Math.round(patch.confidence*100)}%</small>}
  </section>)}</div>
 </details>;
}

function LineText({row,paired}:{row:RevisionDiffLine;paired?:RevisionDiffLine}){
 if(!paired)return <>{row.text||'\u200b'}</>;
 let from=0,to=row.text.length,otherEnd=paired.text.length;
 while(from<to&&from<otherEnd&&row.text[from]===paired.text[from])from++;
 while(to>from&&otherEnd>from&&row.text[to-1]===paired.text[otherEnd-1]){to--;otherEnd--;}
 return <>{row.text.slice(0,from)}<span className="revision-diff-word" title={/^\s+$/.test(row.text.slice(from,to))?uiText('Whitespace change'):undefined}>{row.text.slice(from,to)}</span>{row.text.slice(to)||(!row.text?'\u200b':'')}</>;
}

/** Merge overlapping contexts into a continuous diff, rather than repeating a
 * paragraph or enclosing each individual edit in a separate visual group. */
export function buildRevisionDiffSections(text:string,all:SourceEditorialPatch[],visible=all){
 const requested=buildRevisionDiffGroups(all,visible).flat(),contexts=requested.map(patch=>buildRevisionDiffContext(text,patch,all)).sort((a,b)=>a.from-b.from);
 const ranges:{from:number;to:number}[]=[];
 for(const context of contexts){const previous=ranges.at(-1);if(previous&&context.from<=previous.to)previous.to=Math.max(previous.to,context.to);else ranges.push({from:context.from,to:context.to});}
 const ordered=[...all].sort((a,b)=>a.range.startOffset-b.range.startOffset);
 return ranges.map(({from,to})=>{
  const included=ordered.filter(patch=>patch.range.startOffset<to&&patch.range.endOffset>from||patch.range.startOffset===patch.range.endOffset&&patch.range.startOffset>=from&&patch.range.startOffset<=to);
  const before=text.slice(from,to);let after=before;
  for(const patch of [...included].reverse())after=after.slice(0,patch.range.startOffset-from)+(patch.userReplacement??patch.replacement)+after.slice(patch.range.endOffset-from);
  const line=text.slice(0,from).split('\n').length;
  const delta=ordered.filter(patch=>patch.range.endOffset<=from&&!included.includes(patch)).reduce((sum,patch)=>sum+((patch.userReplacement??patch.replacement).match(/\n/g)?.length??0)-(text.slice(patch.range.startOffset,patch.range.endOffset).match(/\n/g)?.length??0),0);
  return {from,to,before,after,line,newLine:line+delta,hunkPatches:buildRevisionDiffGroups(all,included).flat(),patches:requested.filter(patch=>included.some(item=>item.id===patch.id))};
 });
}

function ChangeControls({patch,revision,disabled,onDecision,onEdit,onLocate,onCompare}:Omit<Props,'patches'>&{patch:SourceEditorialPatch}){
 const related=revision.patches.filter(item=>item.id===patch.id||!!patch.patchGroupId&&item.patchGroupId===patch.patchGroupId);
 const decision=related.every(item=>item.decision===patch.decision)?patch.decision:'pending';
 const controls=<>
  <div className="revision-diff-change-label"><span className="revision-diff-category">{uiText(patch.category.replaceAll('_',' '))}</span><span className="revision-diff-state">{uiText(decision==='accepted'?'Accepted':decision==='rejected'?'Rejected':'Pending')}</span></div>
  <div className="revision-diff-actions">
   <button type="button" className="revision-diff-accept" disabled={disabled||decision==='accepted'} onClick={()=>void onDecision(patch,'accepted')}>{uiText('Accept')}</button>
   <button type="button" disabled={disabled||decision==='rejected'} onClick={()=>void onDecision(patch,'rejected')}>{uiText('Reject')}</button>
   {onEdit&&<button type="button" disabled={disabled} onClick={()=>onEdit(patch)}>{uiText('Edit')}</button>}
   <Notes group={[patch]}/>
  </div>
  <details className="revision-diff-more"><summary aria-label={uiText('More actions')} title={uiText('More actions')}>⋯</summary><div>
   {decision!=='pending'&&<button type="button" disabled={disabled} onClick={()=>void onDecision(patch,'pending')}>{uiText('Return to review')}</button>}
   {onLocate&&<button type="button" onClick={()=>onLocate(patch)}>{uiText('Show original passage')}</button>}
   {onCompare&&patch.range.startPage&&<button type="button" onClick={()=>onCompare(patch.range.startPage!)}>{uiText('Compare PDF page')} {patch.range.startPage}</button>}
  </div></details>
 </>;
 return <div className="revision-diff-change" data-patch-id={patch.id} data-decision={decision} aria-label={uiText('Change at line {value0}',{value0:patch.range.startLine})}>
  {decision==='accepted'?<details className="revision-diff-accepted"><summary aria-label={uiText('Accepted')} title={`${uiText(patch.category.replaceAll('_',' '))} · ${uiText('Accepted')}`}><span aria-hidden="true">✓</span></summary><div className="revision-diff-accepted-controls">{controls}</div></details>:controls}
 </div>;
}

export function SourceRevisionDiff(props:Props){
 const {revision,patches}=props,root=useRef<HTMLDivElement>(null),prefix=useId();
 const [wide,setWide]=useState(false),[layout,setLayout]=useState<'unified'|'split'>('unified'),[rendered,setRendered]=useState(true);
 useEffect(()=>{
  const element=root.current;if(!element||typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(entries=>setWide((entries[0]?.contentRect.width??0)>=820));observer.observe(element);
  return()=>observer.disconnect();
 },[]);
 const split=wide&&layout==='split';
 const sections=useMemo(()=>buildRevisionDiffSections(revision.original.text,revision.patches,patches),[revision.original.text,revision.patches,patches]);
 const textCell=(lines:RevisionDiffLine[],side:'original'|'revision',paired?:RevisionDiffLine)=>{
  const row=lines[0],line=side==='original'?row?.oldLine:row?.newLine;
  return <div className={`revision-diff-side ${row?'is-'+row.kind:'is-empty'}`}>
   <span className="revision-diff-number" role="cell" aria-label={line==null?undefined:uiText(side==='original'?'Original line {value0}':'Revised line {value0}',{value0:line})}>{line}</span>
   <span className="revision-diff-sign" role="cell" aria-label={row?uiText(row.kind==='added'?'Addition':row.kind==='removed'?'Deletion':'Unchanged'):undefined}>{row?.kind==='added'?'+':row?.kind==='removed'?'−':' '}</span>
   <div className="revision-diff-text" role="cell">{rendered?<SourceReaderText text={lines.map(item=>item.text).join('\n')} footnotePrefix={`${prefix}-${side}`}/>:row?<LineText row={row} paired={paired}/>:null}</div>
  </div>;
 };
 return <div ref={root} className={`source-revision-diff${split?' is-split':''}${rendered?' is-rendered':''}`}>
  <div className="revision-diff-toolbar">
   <div className="reprocessing-view-switch" role="group" aria-label={uiText('Diff layout')}>
    <button type="button" aria-pressed={!split} onClick={()=>setLayout('unified')}>{uiText('Unified')}</button>
    <button type="button" aria-pressed={split} disabled={!wide} title={!wide?uiText('Widen the window to use side-by-side diff'):undefined} onClick={()=>setLayout('split')}>{uiText('Side by side')}</button>
   </div>
   <div className="reprocessing-view-switch" role="group" aria-label={uiText('Diff text display')}>
    <button type="button" aria-pressed={!rendered} onClick={()=>setRendered(false)}>{uiText('Source')}</button>
    <button type="button" aria-pressed={rendered} onClick={()=>setRendered(true)}>{uiText('Rendered')}</button>
   </div>
  </div>
  <div className="revision-diff-file-heading"><span>{uiText(split?'Original':'Original → Suggested revision')}</span>{split&&<span>{uiText('Suggested revision')}</span>}<span>{uiText('{value0} changes',{value0:revision.patches.length})}</span></div>
  {!sections.length&&<p className="revision-diff-empty" role="status">{uiText('No changes to review.')}</p>}
  {sections.map(section=>{
   const rows=displayRows(revisionDiffLines(section.before,section.after,section.line,section.newLine),split,rendered),controls=new Map<number,SourceEditorialPatch[]>();
   for(const patch of section.patches){const line=revision.original.text.slice(0,patch.range.startOffset).split('\n').length;const index=rows.findIndex(row=>row.left.some(item=>item.oldLine===line));const at=index<0?0:index;controls.set(at,[...(controls.get(at)??[]),patch]);}
   const pending=section.hunkPatches.filter(patch=>patch.decision==='pending');
   return <div className="revision-diff-section" key={section.from}>
    <div className="revision-diff-hunk-heading">
     <div className="revision-diff-location">@@ −{section.line},{section.before?section.before.split('\n').length:0} +{section.newLine},{section.after?section.after.split('\n').length:0} @@</div>
     {props.onDecisions&&<div className="revision-diff-hunk-actions" role="group" aria-label={uiText('Changes near line {value0}',{value0:section.line})}>
      <button type="button" className="reprocessing-quiet-action" disabled={props.disabled||!pending.length} title={uiText('Apply pending changes in this section, including linked changes')} onClick={()=>void props.onDecisions!(pending,'accepted')}>{uiText('Apply changes ({value0})',{value0:pending.length})}</button>
      <button type="button" className="reprocessing-quiet-action" disabled={props.disabled||!pending.length} title={uiText('Keep originals for pending changes in this section, including linked changes')} onClick={()=>void props.onDecisions!(pending,'rejected')}>{uiText('Keep originals')}</button>
     </div>}
    </div>
    <div className="revision-diff-lines" role="table" aria-label={uiText('Original → Suggested revision')}>
     {rows.map(({left,right},index)=>{
      const row=left[0]!;
      return <div className={`revision-diff-line${split?'':` is-${row.kind}`}`} role="row" key={index}>
       {split?<>{textCell(left,'original',right[0])}{textCell(right,'revision',left[0])}</>:<>
        <span className="revision-diff-number" role="cell" aria-label={row.oldLine===null?undefined:uiText('Original line {value0}',{value0:row.oldLine})}>{row.oldLine}</span>
        <span className="revision-diff-number" role="cell" aria-label={row.newLine===null?undefined:uiText('Revised line {value0}',{value0:row.newLine})}>{row.newLine}</span>
        <span className="revision-diff-sign" role="cell" aria-label={uiText(row.kind==='added'?'Addition':row.kind==='removed'?'Deletion':'Unchanged')}>{row.kind==='added'?'+':row.kind==='removed'?'−':' '}</span>
        <div className="revision-diff-text" role="cell">{rendered?<SourceReaderText text={left.map(item=>item.text).join('\n')} footnotePrefix={`${prefix}-${row.kind==='removed'?'original':'revision'}`}/>:<LineText row={row} paired={row.kind==='removed'&&rows[index+1]?.left[0]?.kind==='added'?rows[index+1]!.left[0]:row.kind==='added'&&rows[index-1]?.left[0]?.kind==='removed'?rows[index-1]!.left[0]:undefined}/>}</div>
       </>}
       <div className="revision-diff-margin" role="cell">{controls.get(index)?.map(patch=><ChangeControls key={patch.id} {...props} patch={patch}/>)}</div>
      </div>;
     })}
    </div>
   </div>;
  })}
 </div>;
}
