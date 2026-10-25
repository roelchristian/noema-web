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
test('saved accepted revision retains page separators when corrections collapse surrounding whitespace',()=>{
 const r=fixture();materializeSourceRevision(r);assert.deepEqual(pageBoundaryDiagnostics(r.original.text,r.reprocessed.text),[]);
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
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{stored=_sql.includes('json_set(payload')?{...stored,status,updatedAt:_at,report:JSON.parse(payload)}:JSON.parse(payload);},get:()=>undefined};
 const service=new SourceReprocessing(store,{require:()=>({entity_id:'test'})},{selection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),editorialSelection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),reeditSource:async()=>{calls++;return '{"patches":[]}';}},()=>{}, {start:()=>1,finish:()=>{}});
 service.detail=()=>structuredClone(stored);service.baseHash=()=>r.baseHash;
 service.resume('v',r.fileId,r.id);
 store.all=()=>stored.status==='queued'?[{vault_id:'v',payload:JSON.stringify(stored)}]:[];
 await service.tick();assert.equal(calls,1);assert.equal(stored.status,'completed');assert.equal(stored.report.chunksCompleted,5);assert.equal(stored.report.charactersReviewed,r.original.text.length);
});
test('Review all keeps confidence-1 formatting pending during actual execution',async()=>{
 const r=fixture();r.patches=[];r.status='queued';r.acceptanceMode='review_all';r.acceptanceThreshold=1;r.report.chunksCompleted=0;r.report.charactersReviewed=0;
 let stored=structuredClone(r),calls=0;
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{stored=_sql.includes('json_set(payload')?{...stored,status,updatedAt:_at,report:JSON.parse(payload)}:JSON.parse(payload);},get:()=>undefined};
 const service=new SourceReprocessing(store,{require:()=>({entity_id:'test'})},{selection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),editorialSelection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),reeditSource:async()=>{calls++;return JSON.stringify({patches:calls===1?[{original:'Religions 2019, 10, 372',replacement:'Religions  2019, 10, 372',category:'formatting',reason:'Spacing',confidence:1}]:[]});}},()=>{}, {start:()=>1,finish:()=>{}});
 service.baseHash=()=>r.baseHash;store.all=()=>stored.status==='queued'?[{vault_id:'v',payload:JSON.stringify(stored)}]:[];
 await service.tick();assert.equal(stored.status,'completed');assert.equal(stored.patches.length,1);assert.equal(stored.patches[0].decision,'pending');assert.equal(stored.reprocessed.text,r.original.text);
});
test('cancellation aborts in-flight output and resumes only after worker settles',async()=>{
 const r=fixture();r.patches=[];r.status='queued';r.report.promptVersion='source-editorial-beta-3';r.report.chunksCompleted=4;r.report.charactersReviewed=r.original.document.physical.pages[4].range.startOffset;
 let stored=structuredClone(r),entered,release;
 const inFlight=new Promise(resolve=>{entered=resolve;});
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{stored=_sql.includes('json_set(payload')?{...stored,status,updatedAt:_at,report:JSON.parse(payload)}:JSON.parse(payload);},get:()=>undefined};
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
 let stored=structuredClone(r),writes=0,snapshotWrites=0;
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{writes++;if(!_sql.includes('json_set(payload'))snapshotWrites++;stored=_sql.includes('json_set(payload')?{...stored,status,updatedAt:_at,report:JSON.parse(payload)}:JSON.parse(payload);},get:()=>undefined};
 const service=new SourceReprocessing(store,{require:()=>({entity_id:'test'})},{selection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),editorialSelection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),reeditSource:async(prompt,_instructions,signal,observe)=>{
  observe(10).usage({input_tokens:10,output_tokens:2,output_tokens_details:{reasoning_tokens:0},input_tokens_details:{cached_tokens:3}});
  return provider(JSON.parse(prompt),signal);
 }},()=>{}, {start:()=>1,finish:()=>{},request:()=>({})});
 service.detail=()=>structuredClone(stored);service.baseHash=()=>r.baseHash;store.all=()=>stored.status==='queued'?[{vault_id:'v',payload:JSON.stringify(stored)}]:[];
 return {service,r,get stored(){return stored;},get writes(){return writes;},get snapshotWrites(){return snapshotWrites;}};
}
function excerptResponse(prompt){
 const original=prompt.editableText.split('\n').find(line=>line.length>30&&!line.includes('<!--'));
 return JSON.stringify({patches:[{original,replacement:original+' [review]',category:'ocr',reason:'Compare original',confidence:1}],diagnostics:['page '+prompt.physicalPage]});
}
test('bounded concurrency assembles out-of-order responses in canonical order with durable attempts and ordered wave checkpoints',async()=>{
 let active=0,peak=0;const completion=[];
 const env=concurrentHarness(async prompt=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,prompt.physicalPage%2?15:1));active--;completion.push(prompt.physicalPage);return excerptResponse(prompt);});
 await env.service.tick();assert.equal(peak,2);assert.equal(completion[0],2);assert.equal(env.stored.status,'completed');
 assert.deepEqual(env.stored.report.completedChunkIndexes,[0,1,2,3,4]);assert.equal(env.stored.report.charactersReviewed,env.r.original.text.length);
 assert.equal(env.stored.patches.length,5);assert.deepEqual(env.stored.patches.map(p=>p.range.startPage),[1,2,3,4,5]);
 assert.deepEqual(env.stored.report.diagnostics.filter(d=>d.includes(': page ')),['Excerpt 1: page 1','Excerpt 2: page 2','Excerpt 3: page 3','Excerpt 4: page 4','Excerpt 5: page 5']);
 assert.equal(env.stored.report.inputTokens,50);assert.equal(env.stored.report.outputTokens,10);assert.equal(env.writes,16);assert.equal(env.snapshotWrites,6);assert.equal(env.stored.reprocessed.text,env.r.original.text);
});
test('failed early excerpt keeps successful sibling and resume retries only missing indexes',async()=>{
 const calls=[];let fail=true;
 const env=concurrentHarness(async prompt=>{calls.push(prompt.physicalPage);if(fail&&prompt.physicalPage===1)throw Error('Provider failure');return excerptResponse(prompt);});
 await env.service.tick();assert.equal(env.stored.status,'failed');assert.deepEqual(calls,[1,2]);assert.deepEqual(env.stored.report.completedChunkIndexes,[1]);assert.equal(env.stored.report.chunksCompleted,1);assert.equal(env.stored.report.inputTokens,20);
 fail=false;env.service.intelligence.editorialSelection=()=>({model:env.r.report.model,reasoningEffort:'high'});env.service.resume('v',env.r.fileId,env.r.id);await env.service.tick();
 assert.equal(env.stored.report.reasoningEffort,'high');assert.equal(env.stored.report.excerpts[1].history[0].reasoningEffort,env.r.report.reasoningEffort);assert.equal(env.stored.report.excerpts[0].history.at(-1).reasoningEffort,'high');
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

test('invalid editorial JSON fails activity while a successful sibling remains resumable without duplicate work',async()=>{
 let invalid=true;const calls=[],activities=[];
 const env=concurrentHarness(async prompt=>{calls.push(prompt.physicalPage);return invalid&&prompt.physicalPage===1?'not json':excerptResponse(prompt);});
 env.service.activity={start:()=>activities.length+1,request:()=>({}),finish:(_id,status)=>activities.push(status)};
 await env.service.tick();assert.equal(env.stored.status,'failed');assert.equal(env.stored.report.errorCode,'invalid_json');
 assert.deepEqual(activities.sort(),['completed','failed']);assert.deepEqual(env.stored.report.completedChunkIndexes,[1]);
 assert.equal(env.stored.report.excerpts[0].attempts,1);assert.equal(env.stored.report.excerpts[0].errorCode,'invalid_json');
 invalid=false;env.service.resume('v',env.r.fileId,env.r.id);await env.service.tick();
 assert.equal(calls.filter(page=>page===2).length,1);assert.equal(env.stored.status,'completed');assert.equal(env.stored.report.inputTokens,60);
 assert.equal(env.stored.report.excerpts[0].attempts,2);assert.equal(env.stored.report.sessionCompletedIndexes.length,4);
});

test('explicit transient provider failures back off within three attempts and preserve exhausted sibling progress',async()=>{
 const {GenerationProviderError}=await import('../src/server/modules/intelligence.ts');
 const calls=[];const env=concurrentHarness(async prompt=>{calls.push(prompt.physicalPage);if(prompt.physicalPage===1)throw new GenerationProviderError(503,'Temporary provider outage');return excerptResponse(prompt);});
 await env.service.tick();assert.equal(env.stored.status,'failed');assert.deepEqual(calls,[1,2,1,1]);
 assert.deepEqual(env.stored.report.completedChunkIndexes,[1]);assert.equal(env.stored.report.excerpts[0].attempts,3);
 assert.equal(env.stored.report.excerpts[0].errorCode,'provider_unavailable');assert.equal(env.stored.report.inputTokens,40);
 assert.equal(env.stored.report.excerpts[0].history.length,3);
 let rateLimited=true;const recovered=concurrentHarness(async prompt=>{if(rateLimited&&prompt.physicalPage===1){rateLimited=false;throw new GenerationProviderError(429,'Rate limited');}return excerptResponse(prompt);});
 await recovered.service.tick();assert.equal(recovered.stored.status,'completed');assert.equal(recovered.stored.report.excerpts[0].attempts,2);assert.equal(recovered.stored.report.inputTokens,60);
});

test('configuration errors trip the circuit breaker and uncertain transports never automatically repeat paid work',async()=>{
 const {GenerationProviderError,GenerationTransportError,GenerationAdmissionError,GenerationCancellationError}=await import('../src/server/modules/intelligence.ts');
 for(const [error,code] of [[new GenerationProviderError(400,'Unsupported configuration'),'provider_http_400'],[new GenerationTransportError('timeout'),'transport_timeout'],[new GenerationAdmissionError('Busy'),'local_admission'],[new GenerationCancellationError(true),'cancelled']]){
  const calls=[];const env=concurrentHarness(async prompt=>{calls.push(prompt.physicalPage);if(prompt.physicalPage===1)throw error;return excerptResponse(prompt);});
  await env.service.tick();assert.equal(env.stored.status,'failed');assert.equal(env.stored.report.errorCode,code);assert.ok(calls.length<=2);assert.equal(calls.filter(page=>page===1).length,1);assert.equal(env.stored.report.excerpts[0].attempts,1);
  if(code==='transport_timeout'||code==='cancelled')assert.equal(env.stored.report.excerpts[0].outcomeUncertain,true);
 }
});

test('source changes while concurrent calls are in flight discard stale outputs and leave canonical snapshots immutable',async()=>{
 let resolveFirst,resolveSecond,entered;const ready=new Promise(resolve=>{entered=resolve;});let count=0;
 const env=concurrentHarness(async prompt=>new Promise(resolve=>{if(++count===1)resolveFirst=()=>resolve(excerptResponse(prompt));else{resolveSecond=()=>resolve(excerptResponse(prompt));entered();}}));
 const original=JSON.stringify(env.r.original),work=env.service.tick();await ready;env.service.baseHash=()=> 'changed';resolveFirst();resolveSecond();await work;
 assert.equal(env.stored.status,'failed');assert.equal(env.stored.report.errorCode,'source_changed');assert.equal(env.stored.patches.length,0);assert.equal(env.stored.report.chunksCompleted,0);assert.equal(JSON.stringify(env.stored.original),original);
});

test('validated successes are durable before held siblings settle and restart never reissues successful work',async()=>{
 let siblingEntered,successSaved;const entered=new Promise(resolve=>{siblingEntered=resolve;}),saved=new Promise(resolve=>{successSaved=resolve;});
 const env=concurrentHarness(async(prompt,signal)=>{
  if(prompt.physicalPage===1)return excerptResponse(prompt);
  if(prompt.physicalPage===2){siblingEntered();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('interrupted')),{once:true}));}
  return excerptResponse(prompt);
 });
 const run=env.service.store.run;env.service.store.run=(...args)=>{run(...args);if(env.stored.report.completedChunkIndexes?.includes(0))successSaved();};
 const work=env.service.tick();await entered;await saved;
 assert.equal(env.stored.report.excerpts[0].status,'completed');assert.equal(env.stored.patches.length,1);
 let restarted=structuredClone(env.stored),calls=[];
 const recoveryStore={all:sql=>sql.includes("IN ('queued','running')")?[{vault_id:'v',payload:JSON.stringify(restarted)}]:restarted.status==='queued'?[{vault_id:'v',payload:JSON.stringify(restarted)}]:[],get:()=>undefined,run:(sql,status,updatedAt,payload)=>{restarted=sql.includes('json_set(payload')?{...restarted,status,updatedAt,report:JSON.parse(payload)}:JSON.parse(payload);}};
 const intelligence={selection:()=>({model:env.r.report.model,reasoningEffort:env.r.report.reasoningEffort}),editorialSelection:()=>({model:env.r.report.model,reasoningEffort:env.r.report.reasoningEffort}),reeditSource:async prompt=>{calls.push(JSON.parse(prompt).physicalPage);return '{"patches":[]}';}};
 const recovered=new SourceReprocessing(recoveryStore,{require:()=>({})},intelligence,()=>{},{start:()=> 'a',finish:()=>{}});
 recovered.detail=()=>structuredClone(restarted);recovered.baseHash=()=>env.r.baseHash;
 assert.equal(restarted.report.excerpts[0].status,'completed');assert.equal(restarted.report.excerpts[1].outcomeUncertain,true);
 // Finish the old simulated process before operating the new instance.
 env.service.close();await work;
 recovered.resume('v',env.r.fileId,env.r.id);await recovered.tick();
 assert.equal(restarted.status,'completed');assert.deepEqual(calls,[2,3,4,5]);assert.equal(restarted.patches.length,1);
});

test('attempt accounting retains missing-usage and effective reasoning provenance across configuration repair',async()=>{
 const {GenerationProviderError}=await import('../src/server/modules/intelligence.ts');let first=true;
 const env=concurrentHarness(async prompt=>{if(first&&prompt.physicalPage===1){first=false;throw new GenerationProviderError(503,'Transient');}return '{"patches":[]}';});
 const original=env.service.intelligence.reeditSource;let calls=0;
 env.service.intelligence.reeditSource=async(...args)=>{calls++;if(calls===3)args[3]=()=>({usage:()=>{}});return original(...args);};
 await env.service.tick();assert.equal(env.stored.status,'completed');assert.equal(env.stored.report.usageIncomplete,true);
 const history=env.stored.report.excerpts[0].history;assert.equal(history.length,2);assert.equal(history[1].inputTokens,null);assert.equal(history[0].model,env.r.report.model);assert.equal(history[0].reasoningEffort,env.r.report.reasoningEffort);
 assert.match(env.stored.report.diagnostics.join('\n'),/usage was unavailable/);
});

test('scholarly UTF-16 offsets disambiguate repeated citations without normalizing quotations, equations, footnotes or bibliography',async()=>{
 const {locateEditorialPatch}=await import('../src/server/modules/source-reprocessing-patches.ts');
 const corpus=JSON.parse(readFileSync(new URL('./fixtures/editorial-academic.json',import.meta.url),'utf8')),text=corpus.text;
 const citation='[1] Smith, 2020, p. 7',start=text.lastIndexOf(citation);
 assert.deepEqual(locateEditorialPatch(text,{original:citation,startOffset:start,endOffset:start+citation.length}),{start,end:start+citation.length});
 assert.throws(()=>locateEditorialPatch(text,{original:citation}),/unique canonical/);
 for(const item of [
  {original:citation,startOffset:start+1,endOffset:start+citation.length+1},
  {original:citation,startOffset:-1,endOffset:4},
  {original:citation,startOffset:0,endOffset:text.length+1},
  {original:citation,startOffset:start+0.5,endOffset:start+citation.length},
  {original:citation,startOffset:start},
  {original:'é is decomposed',startOffset:text.indexOf('é is decomposed'),endOffset:text.indexOf('é is decomposed')+'é is decomposed'.length},
  {original:'\ud83d',startOffset:text.indexOf('😀'),endOffset:text.indexOf('😀')+1}
 ])assert.throws(()=>locateEditorialPatch(text,item),/offset|canonical/);
 for(const original of ['$E=mc^2$','“λόγος καὶ ἀλήθεια”','« 日本語の引用 »','[^p1-1]: Printed note 1','[2] Δοκιμή, Β.'])assert.deepEqual(locateEditorialPatch(text,{original}),{start:text.indexOf(original),end:text.indexOf(original)+original.length});
});

test('accepted saved patches verify exact canonical evidence, excerpt binding and surrogate boundaries with legacy compatibility',()=>{
 const base=fixture();base.patches=base.patches.filter(p=>p.original.includes('1. Introduction'));base.patches[0].decision='accepted';
 materializeSourceRevision(structuredClone(base));
 for(const mutate of [
  p=>{p.baseHash='another-revision';},
  p=>{p.original='different original';},
  p=>{p.range.endOffset=Number.MAX_SAFE_INTEGER;},
  p=>{p.excerptIndex=127;},
  p=>{p.userReplacement='broken \ud83d';}
 ]){const r=structuredClone(base);mutate(r.patches[0]);assert.throws(()=>materializeSourceRevision(r),/canonical revision or excerpt/);}
 const overlapping=structuredClone(base);overlapping.patches.push({...overlapping.patches[0],id:'overlap'});assert.throws(()=>materializeSourceRevision(overlapping),/canonical revision or excerpt/);
});

test('lightweight durable progress keeps row, detail, status and selector summary consistent without serializing snapshots',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),{Store}=await import('../src/server/store.ts');
 const {setupSourceReprocessingSummarySchema}=await import('../src/server/source-reprocessing-summary-schema.ts');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE source_reprocessing(id TEXT PRIMARY KEY,file_id TEXT,vault_id TEXT,status TEXT,created_at TEXT,updated_at TEXT,payload TEXT)');setupSourceReprocessingSummarySchema(db);
  const r=fixture();db.prepare('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)').run(r.id,r.fileId,'v',r.status,r.createdAt,r.updatedAt,JSON.stringify(r));
  const service=new SourceReprocessing(new Store(db),{require:()=>({})},{},()=>{},{});service.currentHash=()=>r.baseHash;
  r.status='running';r.report.sessionStartedAt=new Date().toISOString();
  const original=r.original;Object.defineProperty(r,'original',{get(){throw Error('Progress update serialized a snapshot');}});
  service.saveProgress('v',r);Object.defineProperty(r,'original',{value:original});
  const detail=service.detail('v',r.fileId,r.id),status=service.status('v',r.fileId,r.id),summary=service.list('v',r.fileId)[0];
  assert.equal(detail.status,'running');assert.equal(summary.status,'running');assert.equal(status.status,'running');assert.equal(detail.updatedAt,status.updatedAt);assert.equal(summary.updatedAt,status.updatedAt);assert.deepEqual(detail.original,original);
 }finally{db.close();}
});

async function layoutPolicyInput(original='Ordinary prose\ncontinues here',replacement='Ordinary prose continues here'){
 const {processedSourceDocument}=await import('../src/server/modules/source-document.ts');
 const document=processedSourceDocument({id:'synthetic',name:'Synthetic',original_filename:'Synthetic',generated_name:'Synthetic',format:'txt',language:'en',source_url:null,text:original,pages:1,structural_nodes:'[]',page_start_lines:'[1]',enrichment_status:'completed'});
 return {text:original,document,start:0,end:original.length,original,replacement,category:'line_breaks',confidence:0.95,threshold:0.9,policy:'balanced',legacyRisks:editorialPatchRisk(original,replacement,'line_breaks',false)};
}
test('balanced proves layout invariants but fails closed without independent passage-language evidence',async()=>{
 const {evaluateEditorialAcceptance}=await import('../src/server/modules/source-reprocessing-risk.ts');
 const input=await layoutPolicyInput(),result=evaluateEditorialAcceptance(input);
 assert.equal(result.automatic,false);assert.match(result.reasons.join(' '),/Independent passage-language evidence is unavailable/);assert.ok(result.checks.includes('exact-canonical-substring'));assert.ok(result.checks.includes('existing-soft-wrap-only'));
 assert.equal(evaluateEditorialAcceptance({...input,policy:'review_all'}).automatic,false);
 assert.equal(evaluateEditorialAcceptance({...input,policy:'safe_formatting'}).automatic,false);
 assert.equal(evaluateEditorialAcceptance({...input,policy:undefined}).automatic,false);
 for(const policy of ['unknown','',null])assert.equal(evaluateEditorialAcceptance({...input,policy}).automatic,false);
 for(const mutate of [
  v=>{v.threshold=undefined;},v=>{v.confidence=0.8;},v=>{v.confidence=NaN;},v=>{v.start=1;},v=>{v.document.source.language=null;},v=>{v.document.physical.pages=[];},v=>{v.document.semantic.children=[];},v=>{v.document.semantic.children[0].text='Different text';}
 ]){const value=structuredClone(input);mutate(value);assert.equal(evaluateEditorialAcceptance(value).automatic,false);}
});
test('protected and uncertain changes stay pending for every automatic policy',async()=>{
 const {evaluateEditorialAcceptance}=await import('../src/server/modules/source-reprocessing-risk.ts');
 for(const [a,b] of [
  ['The value is  42','The value is 42'],['“Two  words”','“Two words”'],["'Two  words'","'Two words'"],['See [reference]  here','See [reference] here'],['Use $x$  here','Use $x$ here'],['Un mot français  ici','Un mot français ici'],['First paragraph\n\nSecond paragraph','First paragraph Second paragraph'],['soft-\nware','software'],['A deliberate  \nbreak','A deliberate break'],['Some words vanish','Some words'],['one\ntwo','one\n\ntwo'],['    indented  code','    indented code']
 ])for(const policy of ['balanced','minimal_review','safe_formatting']){
  const input=await layoutPolicyInput(a,b);input.category='formatting';input.policy=policy;input.confidence=1;input.legacyRisks=editorialPatchRisk(a,b,'formatting',false);
  assert.equal(evaluateEditorialAcceptance(input).automatic,false,`${policy}: ${JSON.stringify(a)}`);
 }
 const input=await layoutPolicyInput('modem civilisation','modern civilisation');input.policy='minimal_review';input.category='ocr';
 assert.match(evaluateEditorialAcceptance(input).reasons.join(' '),/independently verified source evidence/);
});
test('automatic history is reversible and manual replacement audit survives restoration',async()=>{
 const {restoreSourceRevision}=await import('../src/server/modules/source-reprocessing-backup.ts');
 const r=fixture();r.patches=r.patches.filter(p=>p.original.includes('1. Introduction'));const patch=r.patches[0];patch.decision='accepted';r.acceptanceMode='balanced';
 patch.autoAcceptance={policy:'balanced',validator:'canonical-layout-v1',checks:['exact-canonical-substring'],appliedAt:r.createdAt};patch.decisionHistory=[{at:r.createdAt,actor:'automatic',from:'pending',to:'accepted'}];
 let stored=r;const service=new SourceReprocessing({all:()=>[],run:(_sql,_status,_at,payload)=>{stored=JSON.parse(payload);}},{require:()=>({})},{},()=>{},{});service.detail=()=>structuredClone(stored);
 service.review('v',r.fileId,r.id,{updatedAt:stored.updatedAt,decisions:[{patchId:patch.id,decision:'rejected'}]});
 assert.equal(stored.patches[0].decision,'rejected');assert.equal(stored.reprocessed.text,stored.original.text);assert.equal(stored.patches[0].autoAcceptance.policy,'balanced');assert.deepEqual(stored.patches[0].decisionHistory.at(-1).from,'accepted');
 service.review('v',r.fileId,r.id,{updatedAt:stored.updatedAt,decisions:[{patchId:patch.id,decision:'accepted',replacement:patch.replacement}]});
 const restored=restoreSourceRevision(stored,r.id,r.fileId,'restored-revision','restored-file');
 assert.equal(restored.acceptanceMode,'balanced');assert.equal(restored.patches[0].decisionHistory.length,3);assert.equal(restored.patches[0].decisionHistory.at(-1).replacement,patch.replacement);assert.deepEqual(restored.patches[0].autoAcceptance,patch.autoAcceptance);
});
test('explicit legacy safe-formatting execution retains narrow automatic layouts with durable audit and canonical coordinates',async()=>{
 const {sourceRevisionBaseHash}=await import('../src/server/modules/source-reprocessing.ts');
 const input=await layoutPolicyInput('Ordinary  prose continues here','Ordinary prose continues here');const r=fixture();r.patches=[];r.status='queued';r.acceptanceMode='safe_formatting';r.acceptanceThreshold=0.9;r.original={text:input.text,document:input.document};r.reprocessed=structuredClone(r.original);r.baseHash=sourceRevisionBaseHash(r.original);
 Object.assign(r.report,{chunksTotal:1,chunksCompleted:0,charactersTotal:input.text.length,charactersReviewed:0});delete r.report.completedChunkIndexes;delete r.report.excerpts;
 let stored=structuredClone(r);
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{stored=_sql.includes('json_set(payload')?{...stored,status,updatedAt:_at,report:JSON.parse(payload)}:JSON.parse(payload);},get:()=>undefined};
 const service=new SourceReprocessing(store,{require:()=>({entity_id:'synthetic'})},{editorialSelection:()=>({model:r.report.model,reasoningEffort:r.report.reasoningEffort}),reeditSource:async()=>JSON.stringify({patches:[{startOffset:0,endOffset:input.original.length,original:input.original,replacement:input.replacement,category:'formatting',reason:'Model asserts safe',confidence:0.95}]})},()=>{},{start:()=>1,finish:()=>{}});
 service.baseHash=()=>r.baseHash;service.detail=()=>structuredClone(stored);store.all=()=>stored.status==='queued'?[{vault_id:'v',payload:JSON.stringify(stored)}]:[];
 await service.tick();assert.equal(stored.status,'completed',stored.report.error);assert.equal(stored.patches.length,1);const patch=stored.patches[0];assert.equal(patch.decision,'accepted');assert.equal(stored.patches.filter(p=>p.decision==='pending').length,0);assert.equal(stored.reprocessed.text,input.replacement);assert.equal(stored.original.text,input.original);assert.equal(patch.range.startOffset,0);assert.equal(patch.range.endOffset,input.original.length);assert.equal(patch.autoAcceptance.validator,'canonical-layout-v2');assert.equal(patch.decisionHistory[0].actor,'automatic');
 service.review('v',r.fileId,r.id,{updatedAt:stored.updatedAt,decisions:[{patchId:patch.id,decision:'rejected'}]});assert.equal(stored.reprocessed.text,input.original);assert.equal(stored.patches[0].decisionHistory.at(-1).actor,'user');assert.ok(stored.patches[0].autoAcceptance);
});

test('English source metadata never proves English passage language for balanced or minimal review',async()=>{
 const {evaluateEditorialAcceptance}=await import('../src/server/modules/source-reprocessing-risk.ts');
 for(const [original,replacement] of [['Veni  vidi vici','Veni vidi vici'],['Veni\nvidi vici','Veni vidi vici'],['Ordinary  prose','Ordinary prose']])for(const policy of ['balanced','minimal_review']){
  const input=await layoutPolicyInput(original,replacement);input.policy=policy;input.category='formatting';input.confidence=1;
  assert.equal(input.document.source.language,'en');const result=evaluateEditorialAcceptance(input);assert.equal(result.automatic,false);assert.match(result.reasons.join(' '),/Independent passage-language evidence is unavailable/);
 }
});

test('structured metadata validates publication scope, explicit roles and printed dates without trusting confidence',async()=>{
 const {extractSourceMetadata}=await import('../src/server/modules/source-metadata-extraction.ts');
 const text='Title: Synthetic Publication\nAuthor: Writer, Ada and Writer, Bea\nTranslator: Translator, Cee\nPublication year: 2024\nPublication date: 2024-02-29\nPublisher: Example Press\nDOI: 10.1234/source\nISBN: 978-0-306-40615-7\n\nIntroduction\nReferences\nTitle: Cited Work\nDOI: 10.1234/cited';
 const result=extractSourceMetadata(text,'Synthetic Publication');
 assert.equal(result.facts.length,8);assert.ok(result.facts.every(fact=>fact.validated));
 assert.equal(result.facts.find(fact=>fact.fieldKey==='bibliography:author').value,'Writer, Ada and Writer, Bea');
 assert.equal(result.facts.find(fact=>fact.fieldKey==='bibliography:translator').value,'Translator, Cee');
 assert.ok(result.facts.every(fact=>text.slice(fact.start,fact.end)===fact.excerpt&&!fact.excerpt.includes('Cited Work')));
 for(const bad of ['Publication year: circa 2024','Publication date: 2023-02-29','ISBN: 9780306406158','DOI: not-a-doi']){
  const candidate=extractSourceMetadata('Title: Synthetic Publication\n'+bad,'Synthetic Publication').facts.at(-1);
  assert.equal(candidate.validated,false,bad);
 }
 const unmatched=extractSourceMetadata('Title: Cited Work\nPublication year: 1920','Synthetic Publication');
 assert.ok(unmatched.facts.length);assert.ok(unmatched.facts.every(fact=>!fact.validated));
 assert.deepEqual(extractSourceMetadata('References\nTitle: Synthetic Publication\nDOI: 10.1234/cited','Synthetic Publication').facts,[]);
 assert.deepEqual(extractSourceMetadata('Title: Synthetic Publication\nA discussion of another work.\nPublication year: 1920','Synthetic Publication').facts.map(fact=>fact.fieldKey),['bibliography:title']);
 assert.ok(extractSourceMetadata('Title: Synthetic Publication\nPublication year: 1920\nPublication year: 1921','Synthetic Publication').facts.filter(fact=>fact.fieldKey==='bibliography:year').every(fact=>!fact.validated));
 assert.equal(extractSourceMetadata(text+'x'.repeat(100000),'Synthetic Publication').charactersExamined,12000);
});

test('document metadata cache and run provenance register independent structured candidates without provider calls',async()=>{
 const {SourceMetadataExtraction}=await import('../src/server/modules/source-metadata-extraction.ts');
 const cache=new Map(),received=[];
 const store={get(sql,...args){return sql.includes('extraction_cache')?cache.get(args[2]):undefined;},run(_sql,_vault,_file,key,payload){cache.set(key,{payload});}};
 const metadata={registerCandidate(_vault,_source,candidate){received.push(candidate);return {status:candidate.fieldKey==='bibliography:title'?'corroborated':'pending',registrationOutcome:candidate.fieldKey==='bibliography:title'?'satisfied':'pending'};}};
 const extraction=new SourceMetadataExtraction(store,metadata),r=fixture();
 r.original.text='Title: Synthetic Publication\nPublication year: 2024';r.original.document.source.title='Synthetic Publication';
 const first=extraction.process('v','s',r);assert.equal(first.cacheHit,false);assert.equal(first.candidateCount,2);assert.equal(first.corroborated,1);assert.equal(first.requiresReview,1);
 const second=extraction.process('v','s',{...r,id:'second-run'});assert.equal(second.cacheHit,true);assert.equal(cache.size,1);
 assert.equal(received.at(-1).runId,'second-run');assert.equal(received.at(-1).version,'canonical');
 assert.match(received.at(-1).revision,/^[a-f0-9]{64}$/);assert.match(received.at(-1).evidenceHash,/^[a-f0-9]{64}$/);
 r.original.text+='\nIntroduction\nUnrelated revised body';assert.equal(extraction.process('v','s',r).cacheHit,true);assert.equal(cache.size,1);
 r.report.metadata=first;r.reprocessed={...r.original,text:r.original.text.replace('2024','2025')};
 const derivative=extraction.process('v','s',r,'editorial');assert.equal(derivative.cacheHit,false);assert.equal(cache.size,2);
 assert.equal(received.at(-1).version,'editorial');assert.equal(received.at(-1).value,'2025');assert.equal(r.original.text.includes('2024'),true);
 assert.notEqual(received.at(-1).revision,received[0].revision);
 r.report.metadata=derivative;const before=received.length;assert.equal(extraction.process('v','s',r,'editorial').candidateCount,0);assert.equal(received.length,before);
 r.original.text=r.original.text.replace('2024','2026');assert.equal(extraction.process('v','s',r).cacheHit,false);assert.equal(cache.size,3);
 const [{openDatabase},{Store},{SourceMetadata}]=await Promise.all([import('../src/server/database.ts'),import('../src/server/store.ts'),import('../src/server/modules/source-metadata.ts')]);
 const db=openDatabase(':memory:'),realStore=new Store(db),service=new SourceMetadata(realStore);
 try{
  const text='\nTitle: Synthetic Publication\nPublication year: 2024',cleaned=text.slice(1);
  const {createHash}=await import('node:crypto'),hash=value=>createHash('sha256').update(value).digest('hex');
  realStore.run("INSERT INTO entities(id,vault_id,name,type,updated_at) VALUES('s','default','Display name','source','2026-01-01')");
  realStore.run("INSERT INTO source_files(id,vault_id,entity_id,name,size,status,text,created_at,format,admitted) VALUES('f','default','s','Synthetic.txt',1,'ready',?,'2026-01-01','txt',1)",text);
  realStore.run("INSERT INTO source_math_documents(file_id,raw_hash,algorithm_version,cleaned_text,uncertainty_json,updated_at) VALUES('f',?,2,?,'[]','2026-01-01')",hash(text),cleaned);
  service.setPolicy('default','s','fill_validated_empty');
  const run={...r,id:'run-1',fileId:'f',report:{...r.report,metadata:undefined},original:{...r.original,text:cleaned}};
  const firstReal=new SourceMetadataExtraction(realStore,service).process('default','s',run);assert.equal(firstReal.added,2);
  const rawEvidence=service.snapshot('default','s').fields.flatMap(field=>field.history)[0].evidence[0];assert.equal(rawEvidence.version,'canonical');assert.equal(rawEvidence.revision,hash(text));assert.equal(rawEvidence.start,1);
  // Replay after an interruption before the run summary was checkpointed: persisted facts must not be added twice.
  const restart=new SourceMetadataExtraction(realStore,new SourceMetadata(realStore));
  const replay=restart.process('default','s',run);assert.equal(replay.added,0);assert.equal(replay.corroborated,2);assert.equal(replay.cacheHit,true);
  assert.equal(realStore.get('SELECT count(*) n FROM property_proposals').n,2);
  assert.ok(service.snapshot('default','s').fields.flatMap(field=>field.history).every(proposal=>proposal.evidence.length===1));
  const next=restart.process('default','s',{...run,id:'run-2'});assert.equal(next.added,0);assert.equal(next.corroborated,2);
  assert.ok(service.snapshot('default','s').fields.flatMap(field=>field.history).every(proposal=>proposal.evidence.length===2));
  const derivativeRun={...run,report:{...run.report,metadata:firstReal},reprocessed:{...run.original,text:cleaned.replace('2024','2025')}};
  realStore.run("INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES('run-1','f','default','completed','2026-01-01','2026-01-01',?)",JSON.stringify(derivativeRun));
  const reviewed=restart.process('default','s',derivativeRun,'editorial');assert.equal(reviewed.added,0);assert.equal(reviewed.requiresReview,1);
  const year=service.snapshot('default','s').fields.find(field=>field.key==='bibliography:date');assert.equal(year.value,'2024');assert.equal(JSON.parse(realStore.get("SELECT fields_json FROM bibliographic_records WHERE source_id='s'").fields_json).year,'2024');
  assert.equal(year.proposals[0].evidence[0].version,'editorial');assert.equal(year.proposals[0].evidence[0].excerpt,derivativeRun.reprocessed.text);
  assert.equal(realStore.get("SELECT text FROM source_files WHERE id='f'").text,text);

 }finally{db.close();}

});

test('editorial execution checkpoints document metadata once and preserves separate decisions on resume',async()=>{
 const env=concurrentHarness(async()=>JSON.stringify({patches:[]}));let extractions=0;
 env.service.metadata={process(){extractions++;return {candidateCount:2,added:1,corroborated:0,requiresReview:1,cacheHit:false,evidenceHash:'a'.repeat(64)};}};
 await env.service.tick();assert.equal(extractions,1);assert.equal(env.stored.report.metadata.added,1);assert.equal(env.stored.patches.length,0);
 const original=env.stored.original;assert.deepEqual(env.stored.reprocessed,original);
 const {HttpError}=await import('../src/server/validation.ts'),ambiguous=concurrentHarness(async()=>JSON.stringify({patches:[]}));
 ambiguous.service.metadata={process(){throw new HttpError(409,'The supporting excerpt changed, disappeared, or is ambiguous.');}};
 await ambiguous.service.tick();assert.equal(ambiguous.stored.status,'completed');assert.match(ambiguous.stored.report.diagnostics.join(' '),/Metadata evidence requires review/);
});


test('accepting corrections beside page markers preserves separators and canonical source coordinates',async()=>{
 const {processedSourceDocument}=await import('../src/server/modules/source-document.ts');
 for(const [original,replacement] of [['>\n\n','>'],['text.\n\n','text.']]){
  const text='<!-- Page 1 -->\n\nFirst text.\n\n<!-- Page 2 -->\nSecond text.';
  const r=fixture();r.pipelineVersion=undefined;r.original={text,document:processedSourceDocument({id:'f',name:'Synthetic',format:'txt',text,structural_nodes:'[]',page_start_lines:'[]',enrichment_status:'completed'})};
  const start=text.indexOf(original);r.patches=[{id:'p',original,replacement,decision:'accepted',range:{startOffset:start,endOffset:start+original.length}}];
  materializeSourceRevision(r);assert.deepEqual(pageBoundaryDiagnostics(text,r.reprocessed.text),[]);assert.equal(r.original.text,text);assert.equal(r.patches[0].original,original);assert.ok(r.patches[0].userReplacement.endsWith('\n'));
 }
});


test('partial emphasis at a heading boundary preserves structure and rejects ambiguous alignment',()=>{
 const r=fixture(),node=headings(r.original)[0].node,start=node.range.startOffset;
 const original=r.original.text.slice(start,start+1);
 const make=(at,before,after)=>({id:'heading-'+at,nodeIds:[node.id],range:{startOffset:at,endOffset:at+before.length,startLine:1,endLine:1},original:before,replacement:after,category:'formatting',confidence:1,reason:'Supported formatting',riskReasons:[],decision:'accepted'});
 r.patches=[make(start,original,'**'+original)];
 materializeSourceRevision(r);
 assert.equal(headings(r.reprocessed).length,headings(r.original).length);
 assert.ok(r.nodeLinks.find(link=>link.originalNodeId===node.id).reprocessedNodeIds.length);
 const ambiguous=fixture();ambiguous.patches=[make(start,original,original+original)];
 assert.throws(()=>materializeSourceRevision(ambiguous),/cannot preserve the heading/);
});


test('proof labels remain mapped when their paragraph receives emphasis and mathematical markup',async()=>{
 const {processedSourceDocument}=await import('../src/server/modules/source-document.ts');
 const text='<!-- Page 1 -->\n\nProof. Let x be a variable and x = 2.\n';
 const r=fixture();r.pipelineVersion=undefined;r.original={text,document:processedSourceDocument({id:'f',name:'Synthetic',format:'txt',text,structural_nodes:JSON.stringify([{text:'Proof.',kind:'proof',startLine:3}]),page_start_lines:'[]',enrichment_status:'completed'})};
 const before='Proof. Let x',start=text.indexOf(before);r.patches=[{id:'p',original:before,replacement:'**Proof.** Let $x',decision:'accepted',range:{startOffset:start,endOffset:start+before.length}}];
 assert.ok(sourceDocumentEntries(r.original.document).some(({node})=>node.kind==='proof'));
 materializeSourceRevision(r);
 assert.ok(sourceDocumentEntries(r.reprocessed.document).some(({node})=>node.kind==='proof'));
 assert.match(r.reprocessed.text,/\*\*Proof\.\*\* Let \$x/);
});
