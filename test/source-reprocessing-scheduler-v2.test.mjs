// Synthetic requests only: these tests never contact a model or transmit source files.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/server/store.ts';
import {SourceReprocessing,sourceRevisionBaseHash} from '../src/server/modules/source-reprocessing.ts';
import {processedSourceDocument} from '../src/server/modules/source-document.ts';
import {SourceReprocessingCheckpoints} from '../src/server/modules/source-reprocessing-checkpoints.ts';

function harness(t,{depth='balanced',text='A short synthetic scholarly passage.',pages=null,pageStartLines=[],provider=echo}={}) {
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE source_reprocessing(id TEXT PRIMARY KEY,file_id TEXT,vault_id TEXT,status TEXT,created_at TEXT,updated_at TEXT,payload TEXT);
 CREATE TABLE source_reprocessing_chunks(revision_id TEXT,chunk_index INTEGER,payload TEXT,PRIMARY KEY(revision_id,chunk_index));
 CREATE TABLE source_reprocessing_passes(revision_id TEXT,chunk_index INTEGER,pass_index INTEGER,payload TEXT,PRIMARY KEY(revision_id,chunk_index,pass_index));`);
 const store=new Store(db),file={id:'synthetic-file',entity_id:null,name:'Synthetic',original_filename:'Synthetic',format:'txt',language:'en',source_url:null,generated_name:null,text,pages,structural_nodes:'[]',page_start_lines:JSON.stringify(pageStartLines),enrichment_status:'completed',status:'ready',admitted:1};
 const original={text,document:processedSourceDocument(file)},selection={model:'gpt-5-mini',reasoningEffort:'low'},calls=[];
 let locked=false;
 const intelligence={editorialSelection:()=>selection,reeditSource:async(prompt,_instructions,signal,observe)=>{const request=JSON.parse(prompt);calls.push(request);observe(20).usage({input_tokens:10,output_tokens:3,output_tokens_details:{reasoning_tokens:1},input_tokens_details:{cached_tokens:2}});return provider(request,{signal,lock:()=>{locked=true;}});}};
 const activity={start:()=>1,request:()=>({}),finish:()=>{}};
 function service(){const result=new SourceReprocessing(store,{require:()=>file},intelligence,()=>{if(locked)throw Error('Vault is locked.');},activity);result.snapshot=()=>structuredClone(original);result.baseHash=()=>{if(locked)throw Error('Vault is locked.');return sourceRevisionBaseHash(original);};return result;}
 let worker=service();const revision=worker.start('vault',file.id,{pipelineVersion:2,configuration:{depth,reviewPolicy:'verified',evidence:{originalPages:false,ocr:false,allowExternalTransmission:false}}});
 return {store,calls,revision,checkpoints:new SourceReprocessingCheckpoints(store),get worker(){return worker;},get value(){return JSON.parse(store.get('SELECT payload FROM source_reprocessing WHERE id=?',revision.id).payload);},restart(){locked=false;worker=service();return worker;}};
}
function echo(request){return JSON.stringify({blocks:request.blocks,diagnostics:[],unresolved:false});}

for(const [depth,count] of [['light',1],['balanced',2],['deep',2]])test(`actual V2 ${depth} scheduler performs ${count} successful model requests on unchanged text`,async t=>{
 const env=harness(t,{depth});await env.worker.tick();const result=env.value;
 assert.equal(result.status,'completed');assert.equal(env.calls.length,count);assert.equal(result.report.chunksCompleted,1);assert.equal(result.patches.length,0);
 assert.deepEqual(env.calls.map(call=>call.kind),depth==='light'?['clean']:['reconstruct','verify']);
 const passes=env.checkpoints.passes(result.id);assert.equal(passes.length,count);assert.ok(passes.every(pass=>pass.status==='completed'&&pass.result&&pass.configuration.depth===depth&&pass.requestHash));
 assert.equal(result.report.inputTokens,count*10);assert.equal(result.report.outputTokens,count*3);assert.equal(result.report.excerpts[0].passesCompleted,count);assert.equal(result.reprocessed.text,result.original.text);
});

test('pass 2 failure never publishes a pass 1 reconstruction and uncertain requests cannot resume',async t=>{
 const env=harness(t,{provider:request=>{if(request.kind==='verify')throw Error('Connection closed after request transmission.');return JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace('short','changed')}))});}});
 await env.worker.tick();const result=env.value;
 assert.equal(result.status,'failed');assert.equal(env.calls.length,2);assert.equal(result.patches.length,0);assert.equal(result.reprocessed.text,result.original.text);
 assert.equal(env.checkpoints.passes(result.id)[0].status,'completed');assert.equal(env.checkpoints.passes(result.id)[1].outcomeUncertain,true);
 env.restart();assert.throws(()=>env.worker.resume('vault',result.fileId,result.id),/uncertain.*not be replayed/);assert.equal(env.calls.length,2);
});

test('invalid successful pass output remains durable and is not charged again on resume',async t=>{
 const env=harness(t,{provider:request=>request.kind==='verify'?'not JSON':echo(request)});await env.worker.tick();const failed=env.value;
 assert.equal(failed.status,'failed');assert.equal(env.calls.length,2);assert.equal(env.checkpoints.passes(failed.id)[1].result,'not JSON');
 assert.equal(env.checkpoints.passes(failed.id)[1].status,'completed');assert.equal(env.checkpoints.passes(failed.id)[1].outcomeUncertain,false);
 env.restart();env.worker.resume('vault',failed.fileId,failed.id);await env.worker.tick();assert.equal(env.calls.length,2);assert.equal(env.value.status,'failed');assert.equal(env.value.patches.length,0);
});

test('Deep invokes a third request only with persisted difficulty or unresolved verification',async t=>{
 for(const [text,unresolved] of [['The expression $x=1$ is preserved.',false],['An ordinary passage needing comparison.',true]]){
  const env=harness(t,{depth:'deep',text,provider:request=>JSON.stringify({blocks:request.blocks,unresolved:request.kind==='verify'&&unresolved})});
  await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(env.calls.length,3);assert.equal(env.calls[2].kind,'resolve');
  const chunk=env.checkpoints.chunks(env.revision.id)[0];assert.equal(chunk.requiredPassCount,3);assert.ok(chunk.difficultyReason);assert.equal(chunk.difficulty,'difficult');assert.ok(env.calls[2].difficultyReason);
 }
});

test('a restart reuses the actual completed pass 1 checkpoint and sends only verification',async t=>{
 let first=true;
 const env=harness(t,{provider:(request,control)=>{if(first){first=false;control.lock();}return echo(request);}});
 await env.worker.tick();assert.equal(env.value.status,'failed');assert.equal(env.calls.length,1);assert.equal(env.checkpoints.passes(env.revision.id)[0].status,'completed');assert.equal(env.value.patches.length,0);
 env.restart();env.worker.resume('vault',env.revision.fileId,env.revision.id);await env.worker.tick();
 assert.equal(env.value.status,'completed');assert.deepEqual(env.calls.map(call=>call.kind),['reconstruct','verify']);assert.equal(env.value.report.inputTokens,20);assert.equal(env.checkpoints.passes(env.revision.id).length,2);
});

test('Verified reconstruction preserves canonical citation coordinates and leaves unsupported scholarly changes pending',async t=>{
 const text='A quotation “first reading” and equation $x=1$ cite Doe, 1999.';
 const env=harness(t,{text,provider:request=>JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace('first reading','second reading').replace('$x=1$','$x=2$').replace('1999','2000')}))})});
 const before=structuredClone(env.revision.original);await env.worker.tick();const result=env.value;
 assert.equal(result.status,'completed');assert.equal(result.patches.length,1);assert.equal(result.patches[0].decision,'pending');assert.equal(result.reprocessed.text,text);assert.deepEqual(result.original,before);
 const patch=result.patches[0];assert.equal(text.slice(patch.range.startOffset,patch.range.endOffset),patch.original);assert.equal(patch.baseHash,sourceRevisionBaseHash(before));assert.ok(patch.riskReasons.length);
});

test('cancellation marks the reserved paid request uncertain and never advances to verification',{timeout:2000},async t=>{
 let entered;const started=new Promise(resolve=>{entered=resolve;});
 const env=harness(t,{provider:(_request,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('Synthetic cancellation')),{once:true});entered();})});
 const work=env.worker.tick();await started;env.worker.cancel('vault',env.revision.fileId,env.revision.id);await work;
 assert.equal(env.value.status,'interrupted');assert.equal(env.calls.length,1);assert.equal(env.value.patches.length,0);assert.equal(env.checkpoints.passes(env.revision.id)[0].outcomeUncertain,true);
 env.restart();assert.throws(()=>env.worker.resume('vault',env.revision.fileId,env.revision.id),/uncertain/);assert.equal(env.calls.length,1);
});

test('V2 start and persisted completion retain reversible furniture candidates over three physical pages',async t=>{
 const text=Array.from({length:3},(_,index)=>`<!-- Page ${index+1} -->\nRecurring journal header\nDistinct passage ${index+1}.\n`).join('');
 const env=harness(t,{text,pages:3,pageStartLines:[1,4,7]});
 assert.equal(env.revision.furniture.length,3);assert.ok(env.revision.furniture.every(candidate=>candidate.hidden===false&&candidate.text==='Recurring journal header'));
 await env.worker.tick();const result=env.value;assert.equal(result.status,'completed');assert.equal(env.calls.length,6);
 assert.deepEqual(result.furniture,env.revision.furniture);assert.equal(result.original.text,text);assert.equal(result.reprocessed.text,text);
 for(const candidate of result.furniture)assert.equal(text.slice(candidate.startOffset,candidate.endOffset),candidate.text);
});
