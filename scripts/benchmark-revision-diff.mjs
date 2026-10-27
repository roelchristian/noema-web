// Synthetic-only comparison; optional REVISION_DIFF_BASELINE selects a baseline checkout.
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const hooks=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {};',shortCircuit:true}:next(url,context);}});
const load=root=>import(pathToFileURL(path.join(root,'src/client/sources/SourceRevisionDiff.tsx')).href);
const current=await load(process.cwd()),baseline=process.env.REVISION_DIFF_BASELINE?await load(process.env.REVISION_DIFF_BASELINE):null;
hooks.deregister();
const raw=Array.from({length:20_000},(_,i)=>`${i}: Synthetic 😀 source paragraph with exact UTF-16 offsets.`).join('\n');
const lines=[];let from=0;for(const line of raw.split('\n')){lines.push(from);from+=line.length+1;}
const patches=Array.from({length:1000},(_,i)=>{const start=lines[10+i*20]+5;return {id:'patch-'+i,range:{startOffset:start,endOffset:start+9},replacement:'Revised\n😀 text',decision:'pending'};});
function meter(){const counts={sourceSliceCalls:0,sourceCharactersSliced:0,sourcePrefixSliceCalls:0,patchSortCalls:0};const text={length:raw.length,indexOf:(...args)=>raw.indexOf(...args),lastIndexOf:(...args)=>raw.lastIndexOf(...args),slice:(start,end)=>{counts.sourceSliceCalls++;const result=raw.slice(start,end);counts.sourceCharactersSliced+=result.length;if(start===0)counts.sourcePrefixSliceCalls++;return result;}};return {counts,text};}
function measure(module,progressive){
 const {counts,text}=meter(),sort=Array.prototype.sort;
 Array.prototype.sort=function(...args){counts.patchSortCalls++;return sort.apply(this,args);};
 const started=performance.now();let plans,sections;
 try {
  if(progressive){const index=module.buildRevisionDiffIndex(text,patches);plans=module.planRevisionDiffSections(text,patches,patches,index);sections=plans.slice(0,12).map(plan=>module.materializeRevisionDiffSection(text,plan));}
  else{sections=module.buildRevisionDiffSections(text,patches);plans=sections;}
  for(const section of sections)module.revisionDiffLines(section.before,section.after,section.line,section.newLine);
 }finally{Array.prototype.sort=sort;}
 return {...counts,plannedSections:plans.length,materializedSections:sections.length,diffLineComputations:sections.length,elapsedMs:performance.now()-started};
}
const result={environment:{node:process.version,platform:process.platform,arch:process.arch},fixture:{sourceLines:20_000,sourceUTF16Units:raw.length,patches:patches.length,initialSectionLimit:12},note:'One local synthetic run; elapsed times include planning, visible materialization and line comparisons. This is not device/browser responsiveness evidence.'};
if(baseline)result.baseline=measure(baseline,false);
result.optimized=measure(current,true);
console.log(JSON.stringify(result,null,2));
