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

function lowerBound(values:number[],value:number){let low=0,high=values.length;while(low<high){const middle=(low+high)>>>1;if(values[middle]!<value)low=middle+1;else high=middle;}return low;}
function upperBound(values:number[],value:number){let low=0,high=values.length;while(low<high){const middle=(low+high)>>>1;if(values[middle]!<=value)low=middle+1;else high=middle;}return low;}
/** All offsets remain JavaScript UTF-16 offsets, matching stored patch coordinates. */
export function buildRevisionDiffIndex(text:string,all:SourceEditorialPatch[]){
 const newlines:number[]=[];for(let offset=text.indexOf('\n');offset>=0;offset=text.indexOf('\n',offset+1))newlines.push(offset);
 const ordered=[...all].sort((a,b)=>a.range.startOffset-b.range.startOffset),starts=ordered.map(item=>item.range.startOffset),maxEnds:number[]=[];
 for(const item of ordered)maxEnds.push(Math.max(maxEnds.at(-1)??0,item.range.endOffset));
 const endOrdered=[...ordered].sort((a,b)=>a.range.endOffset-b.range.endOffset),ends=endOrdered.map(item=>item.range.endOffset),deltas=[0];
 const newlineCount=(from:number,to:number)=>lowerBound(newlines,to)-lowerBound(newlines,from);
 for(const item of endOrdered)deltas.push(deltas.at(-1)!+(item.userReplacement??item.replacement).split('\n').length-1-newlineCount(item.range.startOffset,item.range.endOffset));
 const lineAt=(offset:number)=>lowerBound(newlines,offset)+1;
 const lineStart=(offset:number)=>{const at=lowerBound(newlines,offset)-1;return at<0?0:newlines[at]!+1;};
 const lineEnd=(offset:number)=>newlines[lowerBound(newlines,offset)]??text.length;
 const within=(from:number,to:number)=>ordered.slice(lowerBound(maxEnds,from),upperBound(starts,to)).filter(item=>item.range.startOffset===item.range.endOffset?item.range.startOffset>=from&&item.range.startOffset<=to:item.range.startOffset<to&&item.range.endOffset>from);
 const deltaBefore=(from:number,included:SourceEditorialPatch[])=>deltas[upperBound(ends,from)]!-included.filter(item=>item.range.endOffset<=from).reduce((sum,item)=>sum+(item.userReplacement??item.replacement).split('\n').length-1-newlineCount(item.range.startOffset,item.range.endOffset),0);
 const groups=new Map<string,SourceEditorialPatch[]>();for(const item of ordered){const key=item.patchGroupId?`group:${item.patchGroupId}`:`patch:${item.id}`;const group=groups.get(key)??[];group.push(item);groups.set(key,group);}
 return {ordered,lineAt,lineStart,lineEnd,within,deltaBefore,groups};
}
type DiffIndex=ReturnType<typeof buildRevisionDiffIndex>;
function revisionDiffRange(text:string,patch:SourceEditorialPatch,index:DiffIndex){
 const {lineStart,lineEnd}=index;
 let from=lineStart(patch.range.startOffset),to=lineEnd(patch.range.endOffset);
 for(let i=0;i<2;i++){if(from>0)from=lineStart(from-1);if(to<text.length)to=lineEnd(to+1);}
 let changed=true;
 while(changed){changed=false;for(const item of index.within(from,to)){const nextFrom=Math.min(from,lineStart(item.range.startOffset)),nextTo=Math.max(to,lineEnd(item.range.endOffset));if(nextFrom!==from||nextTo!==to){from=nextFrom;to=nextTo;changed=true;}}}
 return {from,to};
}
/** Context compares canonical text with the complete proposal, including overlapping changes. */
export function buildRevisionDiffContext(text:string,patch:SourceEditorialPatch,all:SourceEditorialPatch[],index:DiffIndex=buildRevisionDiffIndex(text,all)){
 const {from,to}=revisionDiffRange(text,patch,index),included=index.within(from,to),before=text.slice(from,to);let after=before;
 for(let i=included.length-1;i>=0;i--){const item=included[i]!;after=after.slice(0,item.range.startOffset-from)+(item.userReplacement??item.replacement)+after.slice(item.range.endOffset-from);}
 const line=index.lineAt(from);
 return {before,after,line,newLine:line+index.deltaBefore(from,included),from,to,patchIds:included.map(item=>item.id)};
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
/** Lightweight section plan: no source text slicing, proposal copying or LCS work. */
export function planRevisionDiffSections(text:string,all:SourceEditorialPatch[],visible=all,index:DiffIndex=buildRevisionDiffIndex(text,all)){
 const requested=buildRevisionDiffGroups(all,visible).flat(),requestedIds=new Set(requested.map(item=>item.id)),contexts=requested.map(patch=>revisionDiffRange(text,patch,index)).sort((a,b)=>a.from-b.from);
 const ranges:{from:number;to:number}[]=[];
 for(const context of contexts){const previous=ranges.at(-1);if(previous&&context.from<=previous.to)previous.to=Math.max(previous.to,context.to);else ranges.push({from:context.from,to:context.to});}
 return ranges.map(({from,to})=>{
  const included=index.within(from,to),line=index.lineAt(from),hunkIds=new Set<string>(),hunkPatches:SourceEditorialPatch[]=[];
  for(const item of included)for(const linked of index.groups.get(item.patchGroupId?`group:${item.patchGroupId}`:`patch:${item.id}`)??[item])if(!hunkIds.has(linked.id)){hunkIds.add(linked.id);hunkPatches.push(linked);}
  return {from,to,line,newLine:line+index.deltaBefore(from,included),included,hunkPatches,patches:included.filter(item=>requestedIds.has(item.id))};
 });
}
export function materializeRevisionDiffSection(text:string,plan:ReturnType<typeof planRevisionDiffSections>[number]){
 const {included,...section}=plan,before=text.slice(section.from,section.to);let after=before;
 for(let i=included.length-1;i>=0;i--){const patch=included[i]!;after=after.slice(0,patch.range.startOffset-section.from)+(patch.userReplacement??patch.replacement)+after.slice(patch.range.endOffset-section.from);}
 return {...section,before,after};
}
export function buildRevisionDiffSections(text:string,all:SourceEditorialPatch[],visible=all,index:DiffIndex=buildRevisionDiffIndex(text,all)){
 return planRevisionDiffSections(text,all,visible,index).map(plan=>materializeRevisionDiffSection(text,plan));
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
 const diffIndex=useMemo(()=>buildRevisionDiffIndex(revision.original.text,revision.patches),[revision.original.text,revision.patches]);
 const sectionPlans=useMemo(()=>planRevisionDiffSections(revision.original.text,revision.patches,patches,diffIndex),[revision.original.text,revision.patches,patches,diffIndex]);
 const [sectionLimit,setSectionLimit]=useState(12);
 useEffect(()=>setSectionLimit(12),[revision.id]);
 const sections=useMemo(()=>sectionPlans.slice(0,sectionLimit).map(plan=>materializeRevisionDiffSection(revision.original.text,plan)),[sectionPlans,sectionLimit,revision.original.text]);
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
   for(const patch of section.patches){const line=diffIndex.lineAt(patch.range.startOffset);const index=rows.findIndex(row=>row.left.some(item=>item.oldLine===line));const at=index<0?0:index;controls.set(at,[...(controls.get(at)??[]),patch]);}
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
  {sectionLimit<sectionPlans.length&&<button type="button" className="button small" onClick={()=>setSectionLimit(limit=>limit+12)}>{uiText('Show more changes')} ({sectionPlans.length-sectionLimit})</button>}
 </div>;
}
