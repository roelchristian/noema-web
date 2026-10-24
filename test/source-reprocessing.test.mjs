import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {materializeSourceRevision,editorialPatchRisk,SourceReprocessing} from '../src/server/modules/source-reprocessing.ts';
import {pageBoundaryDiagnostics} from '../src/server/modules/source-reprocessing-diagnostics.ts';
import {sourceDocumentEntries} from '../src/shared/source-document.ts';
// Recorded live PDF regression; derived output is rebuilt, never trusted as the expected result.
const fixture=()=>{const r=JSON.parse(readFileSync(new URL('./fixtures/dante-editorial-revision.json',import.meta.url),'utf8'));r.reprocessed=structuredClone(r.original);return r;};
const headings=r=>sourceDocumentEntries(r.document).filter(({node})=>node.kind==='chapter');
test('saved Dante formatting patch preserves Introduction and all six structural sections',()=>{
 const r=fixture();r.patches=r.patches.filter(p=>p.original.includes('1. Introduction'));assert.equal(r.patches.length,1);r.patches[0].decision='accepted';
 materializeSourceRevision(r);
 assert.equal(headings(r.original).length,6);assert.equal(headings(r.reprocessed).length,6);
 const intro=headings(r.reprocessed).find(({node})=>node.title.includes('Introduction'));assert.ok(intro);
 assert.ok(r.nodeLinks.find(link=>link.originalNodeId===headings(r.original)[0].node.id).reprocessedNodeIds.includes(intro.node.id));
});
test('saved accepted revision is blocked when page delimiters would become inline',()=>{
 assert.throws(()=>materializeSourceRevision(fixture()),/page marker.*own line/i);
 assert.equal(pageBoundaryDiagnostics('<!-- Page 1 -->\ntext','<!-- Page 1 -->text').length,1);
});
test('custom replacements get identical global page-boundary validation',()=>{
 const r=fixture();r.patches=r.patches.filter(p=>p.original.includes('1. Introduction'));
 r.patches[0].decision='accepted';r.patches[0].userReplacement=r.patches[0].replacement+'<!-- Page 99 -->';
 assert.throws(()=>materializeSourceRevision(r),/page markers differ/i);
});
test('model confidence cannot auto-approve quotations, gaps, deletions, or headings',()=>{
 for(const [a,b,c,structure] of [['“an historically extended”','“a historically extended”','ocr',false],['New York:','New York: [publication details incomplete in source]','citation',false],['header','', 'apparatus',false],['1. Introduction','1.  Introduction','formatting',true]])assert.ok(editorialPatchRisk(a,b,c,structure).length);
 assert.deepEqual(editorialPatchRisk('Two  spaces','Two spaces','formatting',false),[]);
 assert.ok(editorialPatchRisk('one\ntwo','one two','line_breaks',false).length);
 assert.ok(editorialPatchRisk('    code',' code','formatting',false).length);
 assert.ok(editorialPatchRisk('**two  words**','**two words**','formatting',false).length);
});
test('resume skips completed excerpts and preserves their checkpoint coverage',async()=>{
 const r=fixture();r.patches=[];r.status='interrupted';r.report.promptVersion='source-editorial-beta-3';r.report.chunksCompleted=4;r.report.charactersReviewed=r.original.document.physical.pages[4].range.startOffset;
 let stored=structuredClone(r),calls=0;
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{stored=JSON.parse(payload);},get:()=>undefined};
 const service=new SourceReprocessing(store,{require:()=>({entity_id:'test'})},{selection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),editorialSelection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),reeditSource:async()=>{calls++;return '{"patches":[]}';}},()=>{}, {start:()=>1,finish:()=>{}});
 service.detail=()=>structuredClone(stored);service.baseHash=()=>r.baseHash;
 service.resume('v',r.fileId,r.id);
 store.all=()=>stored.status==='queued'?[{vault_id:'v',payload:JSON.stringify(stored)}]:[];
 await service.tick();assert.equal(calls,1);assert.equal(stored.status,'completed');assert.equal(stored.report.chunksCompleted,5);assert.equal(stored.report.charactersReviewed,r.original.text.length);
});
test('Review all keeps confidence-1 formatting pending during actual execution',async()=>{
 const r=fixture();r.patches=[];r.status='queued';r.acceptanceMode='review_all';r.acceptanceThreshold=1;r.report.chunksCompleted=0;r.report.charactersReviewed=0;
 let stored=structuredClone(r),calls=0;
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{stored=JSON.parse(payload);},get:()=>undefined};
 const service=new SourceReprocessing(store,{require:()=>({entity_id:'test'})},{selection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),editorialSelection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),reeditSource:async()=>{calls++;return JSON.stringify({patches:calls===1?[{original:'Religions 2019, 10, 372',replacement:'Religions  2019, 10, 372',category:'formatting',reason:'Spacing',confidence:1}]:[]});}},()=>{}, {start:()=>1,finish:()=>{}});
 service.baseHash=()=>r.baseHash;store.all=()=>stored.status==='queued'?[{vault_id:'v',payload:JSON.stringify(stored)}]:[];
 await service.tick();assert.equal(stored.status,'completed');assert.equal(stored.patches.length,1);assert.equal(stored.patches[0].decision,'pending');assert.equal(stored.reprocessed.text,r.original.text);
});
test('cancellation aborts in-flight output and resumes only after worker settles',async()=>{
 const r=fixture();r.patches=[];r.status='queued';r.report.promptVersion='source-editorial-beta-3';r.report.chunksCompleted=4;r.report.charactersReviewed=r.original.document.physical.pages[4].range.startOffset;
 let stored=structuredClone(r),entered,release;
 const inFlight=new Promise(resolve=>{entered=resolve;});
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{stored=JSON.parse(payload);},get:()=>undefined};
 const service=new SourceReprocessing(store,{require:()=>({entity_id:'test'})},{selection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),editorialSelection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),reeditSource:async()=>{entered();return new Promise(resolve=>{release=()=>resolve('{"patches":[]}');});}},()=>{}, {start:()=>1,finish:()=>{}});
 service.detail=()=>structuredClone(stored);service.baseHash=()=>r.baseHash;store.all=()=>stored.status==='queued'?[{vault_id:'v',payload:JSON.stringify(stored)}]:[];
 const work=service.tick();await inFlight;service.cancel('v',r.fileId,r.id);
 assert.throws(()=>service.resume('v',r.fileId,r.id),/interruption/);
 release();await work;assert.equal(stored.status,'interrupted');assert.equal(stored.report.chunksCompleted,4);
 service.resume('v',r.fileId,r.id);assert.equal(stored.status,'queued');
});
test('backup roundtrip retains review mode, threshold, and patch risk evidence',async()=>{
 const {restoreSourceRevision}=await import('../src/server/modules/source-reprocessing-backup.ts');
 const r=fixture();r.patches=r.patches.filter(p=>p.original.includes('1. Introduction'));r.patches[0].decision='pending';r.patches[0].riskReasons=['Touches a structural heading.'];r.acceptanceMode='review_all';r.acceptanceThreshold=1;
 const restored=restoreSourceRevision(r,r.id,r.fileId,'restored-revision','restored-file');
 assert.equal(restored.acceptanceMode,'review_all');assert.equal(restored.acceptanceThreshold,1);assert.deepEqual(restored.patches[0].riskReasons,r.patches[0].riskReasons);
});
function concurrentHarness(provider){
 const r=fixture();r.patches=[];r.status='queued';r.acceptanceMode='review_all';r.report.promptVersion='source-editorial-beta-3';r.report.chunksCompleted=0;r.report.charactersReviewed=0;r.report.durationMs=null;
 for(const key of ['inputTokens','outputTokens','reasoningTokens','cachedInputTokens'])r.report[key]=null;
 let stored=structuredClone(r),writes=0;
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{writes++;stored=JSON.parse(payload);},get:()=>undefined};
 const service=new SourceReprocessing(store,{require:()=>({entity_id:'test'})},{selection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),editorialSelection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),reeditSource:async(prompt,_instructions,signal,observe)=>{
  observe(10).usage({input_tokens:10,output_tokens:2,output_tokens_details:{reasoning_tokens:0},input_tokens_details:{cached_tokens:3}});
  return provider(JSON.parse(prompt),signal);
 }},()=>{}, {start:()=>1,finish:()=>{},request:()=>({})});
 service.detail=()=>structuredClone(stored);service.baseHash=()=>r.baseHash;store.all=()=>stored.status==='queued'?[{vault_id:'v',payload:JSON.stringify(stored)}]:[];
 return {service,r,get stored(){return stored;},get writes(){return writes;}};
}
function excerptResponse(prompt){
 const original=prompt.editableText.split('\n').find(line=>line.length>30&&!line.includes('<!--'));
 return JSON.stringify({patches:[{original,replacement:original+' [review]',category:'ocr',reason:'Compare original',confidence:1}],diagnostics:['page '+prompt.physicalPage]});
}
test('bounded concurrency assembles out-of-order responses in canonical order and saves once per wave',async()=>{
 let active=0,peak=0;const completion=[];
 const env=concurrentHarness(async prompt=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,prompt.physicalPage%2?15:1));active--;completion.push(prompt.physicalPage);return excerptResponse(prompt);});
 await env.service.tick();assert.equal(peak,2);assert.equal(completion[0],2);assert.equal(env.stored.status,'completed');
 assert.deepEqual(env.stored.report.completedChunkIndexes,[0,1,2,3,4]);assert.equal(env.stored.report.charactersReviewed,env.r.original.text.length);
 assert.equal(env.stored.patches.length,5);assert.deepEqual(env.stored.patches.map(p=>p.range.startPage),[1,2,3,4,5]);
 assert.deepEqual(env.stored.report.diagnostics.filter(d=>d.includes(': page ')),['Excerpt 1: page 1','Excerpt 2: page 2','Excerpt 3: page 3','Excerpt 4: page 4','Excerpt 5: page 5']);
 assert.equal(env.stored.report.inputTokens,50);assert.equal(env.stored.report.outputTokens,10);assert.equal(env.writes,5);assert.equal(env.stored.reprocessed.text,env.r.original.text);
});
test('failed early excerpt keeps successful sibling and resume retries only missing indexes',async()=>{
 const calls=[];let fail=true;
 const env=concurrentHarness(async prompt=>{calls.push(prompt.physicalPage);if(fail&&prompt.physicalPage===1)throw Error('Provider failure');return excerptResponse(prompt);});
 await env.service.tick();assert.equal(env.stored.status,'failed');assert.deepEqual(calls,[1,2]);assert.deepEqual(env.stored.report.completedChunkIndexes,[1]);assert.equal(env.stored.report.chunksCompleted,1);assert.equal(env.stored.report.inputTokens,20);
 fail=false;env.service.resume('v',env.r.fileId,env.r.id);await env.service.tick();
 assert.deepEqual(calls,[1,2,1,3,4,5]);assert.equal(env.stored.status,'completed');assert.equal(env.stored.patches.length,5);assert.deepEqual(env.stored.patches.map(p=>p.range.startPage),[1,2,3,4,5]);assert.equal(env.stored.report.inputTokens,60);assert.equal(env.stored.report.charactersReviewed,env.r.original.text.length);
});
test('cancelling a concurrent wave retains prior checkpoints and counts both interrupted attempts',async()=>{
 let entered;const started=new Promise(resolve=>{entered=resolve;});let waiting=0;
 const env=concurrentHarness(async(prompt,signal)=>{
  if(prompt.physicalPage<=2)return excerptResponse(prompt);
  return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});if(++waiting===2)entered();});
 });
 const work=env.service.tick();await started;env.service.cancel('v',env.r.fileId,env.r.id);await work;
 assert.equal(env.stored.status,'interrupted');assert.deepEqual(env.stored.report.completedChunkIndexes,[0,1]);assert.equal(env.stored.patches.length,2);assert.equal(env.stored.report.inputTokens,40);assert.equal(env.stored.report.chunksCompleted,2);
});
test('canonical hash cache checks metadata, math, text and vault access without rebuilding unchanged snapshots',()=>{
 const r=fixture();let snapshots=0,locked=false;const file={text:'source',structural_nodes:'[]',status:'ready',admitted:1};let math;
 const service=new SourceReprocessing({all:()=>[],get:()=>math},{require:()=>({...file})},{},()=>{if(locked)throw Error('locked');},{});
 service.snapshot=()=>{snapshots++;return {text:JSON.stringify([file,math]),document:r.original.document};};
 const first=service.baseHash('v','f');assert.equal(service.baseHash('v','f'),first);assert.equal(snapshots,1);
 file.generated_name='New title';assert.notEqual(service.baseHash('v','f'),first);assert.equal(snapshots,2);
 math={raw_hash:'x',cleaned_text:'clean',uncertainty_json:'[]',algorithm_version:2};service.baseHash('v','f');assert.equal(snapshots,3);
 file.text='changed';service.baseHash('v','f');assert.equal(snapshots,4);
 locked=true;assert.throws(()=>service.baseHash('v','f'),/locked/);assert.equal(snapshots,4);
});
test('backup preserves sparse completed checkpoints and rejects duplicate indexes',async()=>{
 const {restoreSourceRevision}=await import('../src/server/modules/source-reprocessing-backup.ts');
 const r=fixture();r.patches=[];r.status='failed';r.report.completedChunkIndexes=[1];r.report.chunksCompleted=1;r.report.concurrency=2;
 const page=r.original.document.physical.pages[1];r.report.charactersReviewed=page.range.endOffset-page.range.startOffset;
 const restored=restoreSourceRevision(r,r.id,r.fileId,'restored','restored-file');assert.deepEqual(restored.report.completedChunkIndexes,[1]);assert.equal(restored.report.concurrency,2);
 r.report.completedChunkIndexes=[1,1];r.report.chunksCompleted=2;assert.throws(()=>restoreSourceRevision(r,r.id,r.fileId,'restored','restored-file'),/invalid source editorial/);
});
test('resume duration accumulates active wall time without counting time paused',async t=>{
 let clock=100,fail=true;t.mock.method(Date,'now',()=>clock);
 const env=concurrentHarness(async prompt=>{clock+=10;if(fail&&prompt.physicalPage===1)throw Error('failed');return excerptResponse(prompt);});
 await env.service.tick();assert.equal(env.stored.report.durationMs,20);
 clock=1000;fail=false;env.service.resume('v',env.r.fileId,env.r.id);await env.service.tick();assert.equal(env.stored.report.durationMs,60);
});
test('global assembly refuses overlap even when restored checkpoint coverage is inconsistent',async()=>{
 let fail=true;const env=concurrentHarness(async prompt=>{if(fail&&prompt.physicalPage===2)throw Error('failed');return excerptResponse(prompt);});
 await env.service.tick();assert.equal(env.stored.patches.length,1);
 env.stored.report.completedChunkIndexes=[];env.stored.report.chunksCompleted=0;env.stored.report.charactersReviewed=0;
 fail=false;env.service.resume('v',env.r.fileId,env.r.id);await env.service.tick();
 assert.equal(env.stored.status,'failed');assert.match(env.stored.report.error,/overlapping patches/);
 assert.equal(new Set(env.stored.patches.map(p=>p.range.startOffset)).size,env.stored.patches.length);
});
test('lightweight status projects progress from SQLite without returning document snapshots',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),{Store}=await import('../src/server/store.ts');
 const db=new DatabaseSync(':memory:');
 try {
  db.exec('CREATE TABLE source_reprocessing(id TEXT,file_id TEXT,vault_id TEXT,status TEXT,updated_at TEXT,payload TEXT)');
  const r=fixture();db.prepare('INSERT INTO source_reprocessing VALUES(?,?,?,?,?,?)').run(r.id,r.fileId,'v',r.status,r.updatedAt,JSON.stringify(r));
  const service=new SourceReprocessing(new Store(db),{require:()=>({})},{},()=>{},{});
  const status=service.status('v',r.fileId,r.id);assert.equal(status.status,'completed');assert.equal(status.chunksCompleted,5);assert.equal(status.charactersTotal,r.original.text.length);assert.equal(status.updatedAt,r.updatedAt);assert.equal(status.original,undefined);
  assert.throws(()=>service.status('wrong',r.fileId,r.id),/not found/);
 }finally{db.close();}
});
