// Offline structural evaluation. Scripted outputs test machinery, never model quality.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {planReprocessingChunks} from '../src/server/modules/source-reprocessing-planner.ts';
import {reconstructBlocks} from '../src/server/modules/source-reprocessing-diff.ts';
import {createSynthesisInput,parseDocumentSynthesis,selectVerificationContext} from '../src/server/modules/source-reprocessing-context.ts';
const corpus=JSON.parse(readFileSync(new URL('../test/fixtures/source-reprocessing/scholarly-synthetic.json',import.meta.url),'utf8'));
const document={physical:{pages:[]}};
function coarseSpan(before,after){let start=0,end=before.length,other=after.length;while(start<Math.min(end,other)&&before[start]===after[start])start++;while(end>start&&other>start&&before[end-1]===after[other-1]){end--;other--;}return end-start;}
export function evaluateSourceReprocessing(){
 const started=performance.now();let proposed=0,expected=0,truePositives=0,oldCanonicalSpan=0,newCanonicalSpan=0,preservationChecks=0;
 const results=[];
 for(const fixture of corpus.cases){
  let candidate=fixture.canonical;for(const correction of fixture.corrections)candidate=candidate.replace(correction.before,correction.after);
  const chunks=planReprocessingChunks(fixture.canonical,document),patches=chunks.flatMap(chunk=>reconstructBlocks(chunk,{blocks:chunk.blocks.map(block=>({id:block.id,text:fixture.corrections.reduce((text,correction)=>text.replace(correction.before,correction.after),block.text)})),diagnostics:[],unresolved:fixture.id.includes('unresolved')}).patches);
  const rebuilt=[...patches].sort((a,b)=>b.startOffset-a.startOffset).reduce((text,patch)=>{assert.equal(text.slice(patch.startOffset,patch.endOffset),patch.original);return text.slice(0,patch.startOffset)+patch.replacement+text.slice(patch.endOffset);},fixture.canonical);
  assert.equal(rebuilt,candidate,fixture.id);
  for(const passage of fixture.preserve??[]){assert.equal(rebuilt.split(passage).length,fixture.canonical.split(passage).length,`${fixture.id}: preserve ${passage}`);preservationChecks++;}
  for(const correction of fixture.corrections){assert.ok(rebuilt.includes(correction.after));truePositives++;}
  expected+=fixture.corrections.length;proposed+=fixture.corrections.length;
  oldCanonicalSpan+=coarseSpan(fixture.canonical,candidate);newCanonicalSpan+=patches.reduce((sum,patch)=>sum+patch.original.length,0);
  results.push({id:fixture.id,patches:patches.length,exactReconstruction:true});
 }
 // A scripted verifier demonstrates context delivery across physical chunks. Its
 // branching rule is explicit and is not an estimate of any provider's reasoning.
 const text='CHAPTER I\nThe term hypostasis is uncertain here.\n'+'x'.repeat(180)+'\nCHAPTER VI\nThe author defines hypostasis as underlying reality.\n';
 const chunks=planReprocessingChunks(text,document,100),definition=chunks.flatMap(chunk=>chunk.blocks).find(block=>block.text.includes('underlying reality'));
 assert.ok(definition);const input=createSynthesisInput({revisionId:'synthetic',baseHash:'synthetic',text,chunks,firstPasses:chunks.map(chunk=>({chunkIndex:chunk.index,requestHash:'mock-'+chunk.index,result:JSON.stringify({blocks:chunk.blocks.map(block=>({id:block.id,text:block.text})),diagnostics:[],unresolved:false})}))});
 const register=parseDocumentSynthesis(input,JSON.stringify({observations:[{kind:'terminology',reading:'hypostasis is described as underlying reality',alternatives:[],evidence:[{blockId:definition.id,quote:'hypostasis as underlying reality'}]}]}));
 const selected=selectVerificationContext(register,chunks[0],text),localContext=[];
 const scriptedVerifier=context=>context.some(entry=>entry.reading.includes('hypostasis'))?'definition available':'unresolved';
 assert.equal(scriptedVerifier(localContext),'unresolved');assert.equal(scriptedVerifier(selected.documentContext.retrieved),'definition available');
 assert.ok(JSON.stringify(selected).length<12000);assert.equal(selected.adjacentContext.editable,false);
 return {conditions:{corpus:'authored synthetic text',provider:'scripted mock; no requests',baseline:'single common-prefix/suffix span',modelQuality:'UNRUN',realAcademicPDFs:'UNRUN',paidUsage:0},metrics:{expectedCorrections:expected,scriptedCorrectionPrecision:proposed?truePositives/proposed:1,scriptedCorrectionRecall:expected?truePositives/expected:1,preservationChecks,coarseCanonicalSpan:oldCanonicalSpan,granularCanonicalSpan:newCanonicalSpan,contextAblation:{local:'unresolved',documentInformed:'definition available'},durationMs:Number((performance.now()-started).toFixed(2)),costPerThousandSourceCharacters:0},cases:results};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(evaluateSourceReprocessing(),null,2));
