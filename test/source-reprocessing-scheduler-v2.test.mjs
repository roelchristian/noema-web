// Synthetic requests only: these tests never contact a model or transmit source files.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/server/store.ts';
import {SourceReprocessing,sourceRevisionBaseHash} from '../src/server/modules/source-reprocessing.ts';
import {processedSourceDocument} from '../src/server/modules/source-document.ts';
import {SourceReprocessingCheckpoints} from '../src/server/modules/source-reprocessing-checkpoints.ts';

function harness(t,{depth='balanced',text='A short synthetic scholarly passage.',pages=null,pageStartLines=[],provider=echo,evidenceService,omitConfiguration=false,evidenceOptions={originalPages:false,ocr:false,allowExternalTransmission:false}}={}) {
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE source_math_documents(file_id TEXT,raw_hash TEXT,cleaned_text TEXT,uncertainty_json TEXT,algorithm_version INTEGER);
 CREATE TABLE source_reprocessing(id TEXT PRIMARY KEY,file_id TEXT,vault_id TEXT,status TEXT,created_at TEXT,updated_at TEXT,payload TEXT);
 CREATE TABLE source_reprocessing_chunks(revision_id TEXT,chunk_index INTEGER,payload TEXT,PRIMARY KEY(revision_id,chunk_index));
 CREATE TABLE source_reprocessing_passes(revision_id TEXT,chunk_index INTEGER,pass_index INTEGER,payload TEXT,PRIMARY KEY(revision_id,chunk_index,pass_index));`);
 const store=new Store(db),file={id:'synthetic-file',entity_id:null,name:'Synthetic',original_filename:'Synthetic',format:'txt',language:'en',source_url:null,generated_name:null,text,pages,structural_nodes:'[]',page_start_lines:JSON.stringify(pageStartLines),enrichment_status:'completed',status:'ready',admitted:1};
 const original={text,document:processedSourceDocument(file)},selection={model:'gpt-5-mini',reasoningEffort:'low'},calls=[];
 let locked=false;
 const intelligence={editorialImageCapability:()=>true,editorialSelection:()=>selection,reeditSource:async(prompt,_instructions,signal,observe,_shape,images,consent)=>{const request=JSON.parse(prompt);calls.push(request);observe(20).usage({input_tokens:10,output_tokens:3,output_tokens_details:{reasoning_tokens:1},input_tokens_details:{cached_tokens:2}});return provider(request,{signal,images,consent,lock:()=>{locked=true;}});}};
 const activity={start:()=>1,request:()=>({}),finish:()=>{}};
 function service(){const result=new SourceReprocessing(store,{require:()=>file},intelligence,()=>{if(locked)throw Error('Vault is locked.');},activity,undefined,evidenceService);result.snapshot=()=>structuredClone(original);result.baseHash=()=>{if(locked)throw Error('Vault is locked.');return sourceRevisionBaseHash(original);};return result;}
 let worker=service();const revision=worker.start('vault',file.id,{pipelineVersion:2,...(omitConfiguration?{}:{configuration:{depth,reviewPolicy:'verified',evidence:evidenceOptions}})});
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

function syntheticEvidence(input,{withImage=false}={}) {
 const bytes=Buffer.from([137,80,78,71,13,10,26,10]),sha256=createHash('sha256').update(bytes).digest('hex');
 const value={version:1,canonicalText:input.text.slice(input.start,input.end),pageNumbers:[1],originalPages:{available:withImage,reason:'Synthetic fixture'},ocr:{available:true,reason:'Synthetic fixture'},independentlyVerified:false,externalTransmissionAllowed:input.options.allowExternalTransmission,diagnostics:[],pages:[{page:1,originalHash:'a'.repeat(64),admittedHash:'b'.repeat(64),imageHash:sha256,ocr:{engine:'Synthetic',version:'1',configuration:'mock',independent:false,lines:[{text:'SUPPLEMENTAL SECRET OCR',confidence:1,bounds:[0,0,1,1],alternatives:[]}],mapping:[]}}],...(withImage?{images:[{page:1,mimeType:'image/png',base64:bytes.toString('base64'),sha256}]}:{})};
 if(!input.options.ocr){delete value.pages[0].ocr;value.ocr.available=false;}
 return {...value,hash:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
}

test('OCR-only without external consent persists local evidence but omits supplemental text from both model passes',async t=>{
 let collected=0;const evidenceService={capabilities:()=>({originalPages:true,ocr:true,externalImages:true,reason:'synthetic'}),collect:async(_vault,_id,input)=>{collected++;return syntheticEvidence(input);},assertCurrent(){}};
 const env=harness(t,{pages:1,pageStartLines:[1],evidenceService,evidenceOptions:{originalPages:false,ocr:true,allowExternalTransmission:false},provider:(request,control)=>{assert.ok(!JSON.stringify(request).includes('SUPPLEMENTAL SECRET OCR'));assert.equal(control.images.length,0);return echo(request);}});
 await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(collected,1);assert.equal(env.calls.length,2);
 assert.equal(env.checkpoints.chunks(env.revision.id)[0].evidence.pages[0].ocr.lines[0].text,'SUPPLEMENTAL SECRET OCR');
});

test('original-page evidence is durable before requests and restart reuses the same evidence without native regeneration',async t=>{
 let collected=0,first=true;const evidenceService={capabilities:()=>({originalPages:true,ocr:true,externalImages:true,reason:'synthetic'}),collect:async(_vault,_id,input)=>{collected++;return syntheticEvidence(input,{withImage:true});},assertCurrent(){}};
 const env=harness(t,{pages:1,pageStartLines:[1],evidenceService,evidenceOptions:{originalPages:true,ocr:false,allowExternalTransmission:true},provider:(request,control)=>{assert.equal(control.images.length,1);assert.equal(control.consent,true);assert.ok(env.checkpoints.chunks(env.revision.id)[0].evidence.images.length);assert.ok(!JSON.stringify(request).includes(control.images[0].base64));if(first){first=false;control.lock();}return echo(request);}});
 await env.worker.tick();assert.equal(env.value.status,'failed');assert.equal(collected,1);assert.equal(env.calls.length,1);
 env.restart();env.worker.resume('vault',env.revision.fileId,env.revision.id);await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(collected,1);assert.equal(env.calls.length,2);
});

test('all local evidence is admitted before the first paid request and unsupported options reject at start',async t=>{
 let collected=0;const evidenceService={capabilities:()=>({originalPages:true,ocr:true,externalImages:true,reason:'synthetic'}),collect:async(_vault,_id,input)=>{if(++collected===2)throw Error('Synthetic second chunk lacks provenance.');return syntheticEvidence(input);},assertCurrent(){}};
 const env=harness(t,{text:'Synthetic prose '.repeat(800),pages:1,pageStartLines:[1],evidenceService,evidenceOptions:{originalPages:false,ocr:true,allowExternalTransmission:false}});await env.worker.tick();assert.equal(env.value.status,'failed');assert.equal(env.calls.length,0);assert.equal(collected,2);
 assert.throws(()=>harness(t,{evidenceOptions:{originalPages:false,ocr:true,allowExternalTransmission:false}}),/unavailable/);
});

test('Verified uses bound independent local OCR for a narrow extraction repair without transmitting OCR text',async t=>{
 const text='The rnodern prose passage remains faithful to its printed source.',replacement=text.replace('rnodern','modern');let currentTrust=true;
 const evidenceService={capabilities:()=>({originalPages:true,ocr:true,externalImages:true,reason:'synthetic'}),collect:async(_vault,_id,input)=>{
  const {hash:_hash,...snapshot}=syntheticEvidence(input);
  snapshot.pages[0].canonicalRanges=[{startOffset:0,endOffset:text.length}];snapshot.pages[0].canonicalRegions=[{startOffset:0,endOffset:text.length,bounds:[0,0,1,1]}];
  snapshot.pages[0].ocr={engine:'AppleVision',version:'synthetic-1',configuration:'languageCorrection=false',independent:true,lines:[{text:replacement,confidence:1,bounds:[0,0,1,1],alternatives:[]}],mapping:[]};
  return {...snapshot,hash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
 },assertCurrent(){},canTrustIndependentEvidence:()=>currentTrust};
 const env=harness(t,{text,pages:1,pageStartLines:[1],evidenceService,evidenceOptions:{originalPages:false,ocr:true,allowExternalTransmission:false},provider:request=>JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace('rnodern','modern')})),diagnostics:[],unresolved:false})});
 await env.worker.tick();const result=env.value;assert.equal(result.status,'completed');assert.equal(result.patches.length,1);assert.equal(result.patches[0].decision,'accepted');assert.equal(result.patches[0].autoAcceptance.policy,'verified');assert.equal(result.reprocessed.text,replacement);assert.equal(result.original.text,text);
 assert.ok(env.calls.every(request=>!JSON.stringify(request.availableEvidence).includes(replacement)));assert.equal(env.calls.length,2);
 currentTrust=false;const changedExtractor=harness(t,{text,pages:1,pageStartLines:[1],evidenceService,evidenceOptions:{originalPages:false,ocr:true,allowExternalTransmission:false},provider:request=>JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace('rnodern','modern')})),diagnostics:[],unresolved:false})});await changedExtractor.worker.tick();assert.equal(changedExtractor.value.status,'completed');assert.equal(changedExtractor.value.patches[0].decision,'pending');assert.equal(changedExtractor.value.reprocessed.text,text);
});

test('omitted V2 configuration defaults to available local OCR while explicit optout remains effective',async t=>{
 let collected=0;const evidenceService={capabilities:()=>({originalPages:true,ocr:true,externalImages:true,reason:'synthetic'}),collect:async(_vault,_id,input)=>{collected++;return syntheticEvidence(input);},assertCurrent(){}};
 const defaults=harness(t,{pages:1,pageStartLines:[1],evidenceService,omitConfiguration:true});assert.equal(defaults.revision.configuration.evidence.ocr,true);assert.equal(defaults.revision.configuration.evidence.allowExternalTransmission,false);
 await defaults.worker.tick();assert.equal(defaults.value.status,'completed');assert.equal(collected,1);
 const optedOut=harness(t,{pages:1,pageStartLines:[1],evidenceService});assert.equal(optedOut.revision.configuration.evidence.ocr,false);await optedOut.worker.tick();assert.equal(optedOut.value.status,'completed');assert.equal(collected,1);
});

test('local evidence progress is durable while the next chunk is collecting and before model dispatch',{timeout:2000},async t=>{
 let collected=0,release,entered;const held=new Promise(resolve=>{entered=resolve;});
 const evidenceService={capabilities:()=>({originalPages:true,ocr:true,externalImages:true,reason:'synthetic'}),collect:async(_vault,_id,input)=>{if(++collected===2)return new Promise(resolve=>{release=()=>resolve(syntheticEvidence(input));entered();});return syntheticEvidence(input);},assertCurrent(){}};
 const env=harness(t,{text:'Synthetic prose '.repeat(800),pages:1,pageStartLines:[1],evidenceService,evidenceOptions:{originalPages:false,ocr:true,allowExternalTransmission:false}}),work=env.worker.tick();
 await held;try{assert.deepEqual(env.value.report.evidencePreparation,{state:'collecting',preparedChunks:1,totalChunks:2});assert.equal(env.calls.length,0);}finally{release();}
 await work;assert.equal(env.value.status,'completed');assert.deepEqual(env.value.report.evidencePreparation,{state:'completed',preparedChunks:2,totalChunks:2});assert.equal(env.calls.length,4);
});
