// Synthetic requests only: these tests never contact a model or transmit source files.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/server/store.ts';
import {SourceReprocessing,sourceRevisionBaseHash} from '../src/server/modules/source-reprocessing.ts';
import {processedSourceDocument} from '../src/server/modules/source-document.ts';
import {repairReconstructionPass} from '../src/server/modules/source-reprocessing-pass.ts';
import {SourceReprocessingCheckpoints} from '../src/server/modules/source-reprocessing-checkpoints.ts';

function harness(t,{depth='balanced',text='A short synthetic scholarly passage.',pages=null,pageStartLines=[],provider=echo,synthesisProvider=()=>JSON.stringify({observations:[]}),synthesisReviewProvider=request=>JSON.stringify({reviews:request.rejected.map(issue=>({index:issue.index,classification:'unsupported',explanation:'The supplied source does not support this observation.',observation:null}))}),evidenceService,omitConfiguration=false,evidenceOptions={originalPages:false,ocr:false,allowExternalTransmission:false}}={}) {
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE source_math_documents(file_id TEXT,raw_hash TEXT,cleaned_text TEXT,uncertainty_json TEXT,algorithm_version INTEGER);
 CREATE TABLE source_reprocessing(id TEXT PRIMARY KEY,file_id TEXT,vault_id TEXT,status TEXT,created_at TEXT,updated_at TEXT,payload TEXT);
 CREATE TABLE source_reprocessing_chunks(revision_id TEXT,chunk_index INTEGER,payload TEXT,PRIMARY KEY(revision_id,chunk_index));
 CREATE TABLE source_reprocessing_passes(revision_id TEXT,chunk_index INTEGER,pass_index INTEGER,payload TEXT,PRIMARY KEY(revision_id,chunk_index,pass_index));`);
 const store=new Store(db),file={id:'synthetic-file',entity_id:null,name:'Synthetic',original_filename:'Synthetic',format:'txt',language:'en',source_url:null,generated_name:null,text,pages,structural_nodes:'[]',page_start_lines:JSON.stringify(pageStartLines),enrichment_status:'completed',status:'ready',admitted:1};
 const original={text,document:processedSourceDocument(file)},selection={model:'gpt-5-mini',reasoningEffort:'low'},calls=[],prompts=[];
 let locked=false;
 const intelligence={editorialImageCapability:()=>true,editorialSelection:()=>selection,reeditSource:async(prompt,_instructions,signal,observe,_shape,images,consent,outputTokenBudget)=>{const request=JSON.parse(prompt);calls.push(request);prompts.push(_instructions);observe(20).usage({input_tokens:10,output_tokens:3,output_tokens_details:{reasoning_tokens:1},input_tokens_details:{cached_tokens:2}});if(_shape==='synthesis')return synthesisProvider(request);if(_shape==='synthesisReview')return synthesisReviewProvider(request);return provider(request,{signal,images,consent,outputTokenBudget,lock:()=>{locked=true;}});}};
 const activity={start:()=>1,request:()=>({}),finish:()=>{}};
 function service(){const result=new SourceReprocessing(store,{require:()=>file},intelligence,()=>{if(locked)throw Error('Vault is locked.');},activity,undefined,evidenceService);result.snapshot=()=>structuredClone(original);result.baseHash=()=>{if(locked)throw Error('Vault is locked.');return sourceRevisionBaseHash(original);};return result;}
 let worker=service();const revision=worker.start('vault',file.id,{pipelineVersion:2,...(omitConfiguration?{}:{configuration:{depth,reviewPolicy:'verified',evidence:evidenceOptions}})});
 return {store,calls,prompts,revision,intelligence,activity,checkpoints:new SourceReprocessingCheckpoints(store),get worker(){return worker;},get value(){return JSON.parse(store.get('SELECT payload FROM source_reprocessing WHERE id=?',revision.id).payload);},restart(){locked=false;worker=service();return worker;}};
}
function echo(request){return JSON.stringify({blocks:request.blocks,diagnostics:[],unresolved:false});}

test('resume recovers a unique unchanged block ID without repeating completed excerpts or synthesis',async t=>{
 const text='<!-- Page 1 -->\nFirst preserved page.\n\n<!-- Page 2 -->\nSecond preserved page.\n';
 const env=harness(t,{text,pages:2,pageStartLines:[1,4],provider:request=>JSON.stringify({blocks:request.blocks.map((block,index)=>request.kind==='reconstruct'&&request.chunkIndex===1&&index===0?{id:'f'.repeat(24),text:block.text+'changed'}:block),diagnostics:[],unresolved:false})});
 await env.worker.tick();assert.equal(env.value.status,'failed');assert.equal(env.value.report.chunksCompleted,1);
 const synthesis=structuredClone(env.checkpoints.synthesis(env.revision.id)),firstCompleted=structuredClone(env.checkpoints.passes(env.revision.id,0));
 const failed=env.checkpoints.passes(env.revision.id,1)[0],raw=JSON.parse(failed.result);raw.blocks[0].text=raw.blocks[0].text.slice(0,-'changed'.length);failed.result=JSON.stringify(raw);env.checkpoints.savePass(failed);
 const retainedRaw=failed.result;env.calls.length=0;env.restart();env.worker.resume('vault',env.revision.fileId,env.revision.id);await env.worker.tick();
 assert.equal(env.value.status,'completed');assert.equal(env.value.report.chunksCompleted,2);assert.deepEqual(env.calls.map(call=>call.kind),['verify']);
 assert.deepEqual(env.checkpoints.passes(env.revision.id,0),firstCompleted);assert.equal(env.checkpoints.passes(env.revision.id,1)[0].result,retainedRaw);
 assert.equal(env.checkpoints.synthesis(env.revision.id).register.hash,synthesis.register.hash);assert.equal(env.checkpoints.synthesis(env.revision.id).result,synthesis.result);
 assert.ok(env.value.report.diagnostics.some(message=>message.includes('Recovered mistyped block ID')));
});

test('resume reviews a saved bad summary quotation without replaying first passes or synthesis',async t=>{
 const env=harness(t,{text:'An original discussion of Austronesian lan- guages.',synthesisReviewProvider:request=>JSON.stringify({reviews:request.rejected.map(issue=>({index:issue.index,classification:'extraction_fix',explanation:'The original quote was silently dehyphenated; the repaired evidence retains original spelling.',observation:{...issue.observation,evidence:[{blockId:request.canonicalBlocks[0].id,quote:'Austronesian lan- guages'}]}}))})});
 await env.worker.tick();const r=env.value,synthesis=env.checkpoints.synthesis(r.id),pass1=env.checkpoints.passes(r.id)[0];
 const block=JSON.parse(pass1.result).blocks[0];
 const raw=JSON.stringify({observations:[{kind:'pattern',reading:'Discusses Austronesian languages.',alternatives:[],evidence:[{blockId:block.id,quote:'Austronesian languages'}],resolutionNeed:'Compare original extraction.'}]});
 // Reproduce the legacy stop: reconstruction and returned synthesis are durable,
 // but synthesis validation prevented verification from ever starting.
 env.store.run('DELETE FROM source_reprocessing_passes WHERE revision_id=? AND pass_index=2',r.id);
 synthesis.result=raw;synthesis.register=null;synthesis.error='Invalid document synthesis: evidence must quote its canonical block exactly.';synthesis.failureKind='validation';env.checkpoints.saveSynthesis(synthesis);
 r.status='failed';r.report.contextHash=undefined;r.report.chunksCompleted=0;r.report.completedChunkIndexes=[];r.report.charactersReviewed=0;r.report.error=synthesis.error;r.patches=[];
 env.store.run('UPDATE source_reprocessing SET status=?,payload=? WHERE id=?','failed',JSON.stringify(r),r.id);
 env.calls.length=0;env.restart();env.worker.resume('vault',r.fileId,r.id);await env.worker.tick();
 assert.equal(env.value.status,'completed');assert.deepEqual(env.calls.map(call=>call.kind),['synthesis_evidence_review','verify']);
 assert.equal(env.checkpoints.synthesis(r.id).result,raw);assert.deepEqual(env.checkpoints.passes(r.id)[0],pass1);
 assert.equal(env.value.report.summaryValidation.accepted,1);assert.equal(env.value.report.summaryValidation.unresolved,0);assert.match(env.value.report.summaryValidation.diagnostics[0],/silently dehyphenated/);
 const completedReview=structuredClone(env.checkpoints.synthesis(r.id).review);
 const {restoreReprocessingSynthesis,validateReprocessingConfiguration}=await import('../src/server/modules/source-reprocessing-backup.ts');
 const archiveRevision={...env.value,configuration:validateReprocessingConfiguration(env.value.configuration)};
 const record=env.checkpoints.synthesis(r.id);assert.deepEqual(restoreReprocessingSynthesis(record,archiveRevision,r.id,r.baseHash,env.checkpoints.passes(r.id)).review,completedReview);
 assert.throws(()=>restoreReprocessingSynthesis({...record,review:{...record.review,result:record.review.result.replace('original spelling','invented spelling')}},archiveRevision,r.id,r.baseHash,env.checkpoints.passes(r.id)),/invalid source editorial/);
 // Resume once more: the completed review and every paid pass are reused.
 const retained=env.value;retained.status='interrupted';env.store.run('UPDATE source_reprocessing SET status=?,payload=? WHERE id=?','interrupted',JSON.stringify(retained),r.id);
 env.calls.length=0;env.restart();env.worker.resume('vault',r.fileId,r.id);await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(env.calls.length,0);assert.deepEqual(env.checkpoints.synthesis(r.id).review,completedReview);
});

test('unsupported summary claims stay visible and cannot stop verification or become canonical evidence',async t=>{
 const env=harness(t,{synthesisProvider:request=>JSON.stringify({observations:[{kind:'pattern',reading:'An unsupported claim.',evidence:[{blockId:request.findings[0].canonicalPassages[0].blockId,quote:'not in the original'}]}]})});
 await env.worker.tick();assert.equal(env.value.status,'completed');assert.deepEqual(env.calls.map(call=>call.kind),['reconstruct','synthesis','synthesis_evidence_review','verify']);
 assert.equal(env.value.report.summaryValidation.unresolved,1);assert.match(env.value.report.summaryValidation.diagnostics[0],/unsupported/);
 const register=env.checkpoints.synthesis(env.revision.id).register;assert.equal(register.observations.length,0);assert.equal(register.rejectedObservations.length,1);assert.equal(env.value.report.inputTokens,40);
});

test('a failed summary evidence review is visible and is not repeated on resume',async t=>{
 const env=harness(t,{synthesisProvider:()=>JSON.stringify({observations:[{kind:'pattern',reading:'unsupported',evidence:[]}]}),synthesisReviewProvider:()=>{throw Error('Review connection lost.');}});
 await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(env.value.report.summaryValidation.state,'unavailable');assert.match(env.value.report.summaryValidation.diagnostics[0],/connection lost/);
 assert.equal(env.checkpoints.synthesis(env.revision.id).review.outcomeUncertain,true);
});

for(const [depth,count] of [['light',1],['balanced',3],['deep',3]])test(`actual V2 ${depth} scheduler performs ${count} successful model requests on unchanged text`,async t=>{
 const env=harness(t,{depth});await env.worker.tick();const result=env.value;
 assert.equal(result.status,'completed');assert.equal(env.calls.length,count);assert.equal(result.report.chunksCompleted,1);assert.equal(result.patches.length,0);
 assert.deepEqual(env.calls.map(call=>call.kind),depth==='light'?['clean']:['reconstruct','synthesis','verify']);
 const passes=env.checkpoints.passes(result.id);assert.equal(passes.length,depth==='light'?1:2);assert.ok(passes.every(pass=>pass.status==='completed'&&pass.result&&pass.configuration.depth===depth&&pass.requestHash));
 assert.equal(result.report.inputTokens,count*10);assert.equal(result.report.outputTokens,count*3);assert.equal(result.report.excerpts[0].passesCompleted,depth==='light'?1:2);assert.equal(result.reprocessed.text,result.original.text);
});

test('pass 2 failure never publishes a pass 1 reconstruction and uncertain requests cannot resume',async t=>{
 const env=harness(t,{provider:request=>{if(request.kind==='verify')throw Error('Connection closed after request transmission.');return JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace('short','changed')}))});}});
 await env.worker.tick();const result=env.value;
 assert.equal(result.status,'failed');assert.equal(env.calls.length,3);assert.equal(result.patches.length,0);assert.equal(result.reprocessed.text,result.original.text);
 assert.equal(env.checkpoints.passes(result.id)[0].status,'completed');assert.equal(env.checkpoints.passes(result.id)[1].outcomeUncertain,true);
 env.restart();assert.throws(()=>env.worker.resume('vault',result.fileId,result.id),/uncertain.*not be replayed/);assert.equal(env.calls.length,3);
});

test('invalid successful pass output remains durable and is not charged again on resume',async t=>{
 const env=harness(t,{provider:request=>request.kind==='verify'?'not JSON':echo(request)});await env.worker.tick();const failed=env.value;
 assert.equal(failed.status,'failed');assert.equal(env.calls.length,3);assert.equal(env.checkpoints.passes(failed.id)[1].result,'not JSON');
 assert.equal(env.checkpoints.passes(failed.id)[1].status,'completed');assert.equal(env.checkpoints.passes(failed.id)[1].outcomeUncertain,false);
 env.restart();env.worker.resume('vault',failed.fileId,failed.id);await env.worker.tick();assert.equal(env.calls.length,3);assert.equal(env.value.status,'failed');assert.equal(env.value.patches.length,0);
});

test('Deep invokes a third request only with persisted difficulty or unresolved verification',async t=>{
 for(const [text,unresolved] of [['The expression $x=1$ is preserved.',false],['An ordinary passage needing comparison.',true]]){
  const env=harness(t,{depth:'deep',text,provider:request=>JSON.stringify({blocks:request.blocks,unresolved:request.kind==='verify'&&unresolved})});
  await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(env.calls.length,4);assert.equal(env.calls[3].kind,'resolve');
  const chunk=env.checkpoints.chunks(env.revision.id)[0];assert.equal(chunk.requiredPassCount,3);assert.ok(chunk.difficultyReason);assert.equal(chunk.difficulty,'difficult');assert.ok(env.calls[3].difficultyReason);
 }
});

test('a restart reuses the actual completed pass 1 checkpoint and sends only verification',async t=>{
 let first=true;
 const env=harness(t,{provider:(request,control)=>{if(first){first=false;control.lock();}return echo(request);}});
 await env.worker.tick();assert.equal(env.value.status,'failed');assert.equal(env.calls.length,1);assert.equal(env.checkpoints.passes(env.revision.id)[0].status,'completed');assert.equal(env.value.patches.length,0);
 env.restart();env.worker.resume('vault',env.revision.fileId,env.revision.id);await env.worker.tick();
 assert.equal(env.value.status,'completed');assert.deepEqual(env.calls.map(call=>call.kind),['reconstruct','synthesis','verify']);assert.equal(env.value.report.inputTokens,30);assert.equal(env.checkpoints.passes(env.revision.id).length,2);
});

test('Verified reconstruction preserves canonical citation coordinates and leaves unsupported scholarly changes pending',async t=>{
 const text='A quotation “first reading” and equation $x=1$ cite Doe, 1999.';
 const env=harness(t,{text,provider:request=>JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace('first reading','second reading').replace('$x=1$','$x=2$').replace('1999','2000')}))})});
 const before=structuredClone(env.revision.original);await env.worker.tick();const result=env.value;
 assert.equal(result.status,'completed');assert.ok(result.patches.length>=1);assert.ok(result.patches.every(patch=>patch.decision==='pending'));assert.equal(result.reprocessed.text,text);assert.deepEqual(result.original,before);
 const patch=result.patches[0];assert.equal(text.slice(patch.range.startOffset,patch.range.endOffset),patch.original);assert.equal(patch.baseHash,sourceRevisionBaseHash(before));assert.ok(patch.riskReasons.length);
});

test('cancellation marks the reserved paid request uncertain and never advances to verification',{timeout:2000},async t=>{
 let entered;const started=new Promise(resolve=>{entered=resolve;});
 const env=harness(t,{provider:(_request,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('Synthetic cancellation')),{once:true});entered();})});
 const work=env.worker.tick();await started;env.worker.cancel('vault',env.revision.fileId,env.revision.id);await work;
 assert.equal(env.value.status,'interrupted');assert.equal(env.calls.length,1);assert.equal(env.value.patches.length,0);assert.equal(env.checkpoints.passes(env.revision.id)[0].outcomeUncertain,true);
 env.restart();assert.throws(()=>env.worker.resume('vault',env.revision.fileId,env.revision.id),/uncertain/);assert.equal(env.calls.length,1);
});

test('V2 publishes only AI-verified reversible furniture nominations over three physical pages',async t=>{
 const text=Array.from({length:3},(_,index)=>`<!-- Page ${index+1} -->\nRecurring journal header\nDistinct passage ${index+1}.\n`).join('');
 const env=harness(t,{text,pages:3,pageStartLines:[1,4,7],provider:request=>JSON.stringify({blocks:request.blocks,pageFurniture:request.pageBoundaryCandidates.map(({blockId,quote,kind})=>({blockId,quote,kind})),unresolved:false})});
 assert.equal(env.revision.furniture.length,0);
 await env.worker.tick();const result=env.value;assert.equal(result.status,'completed');assert.equal(env.calls.length,7);
 assert.equal(result.furniture.length,3);assert.ok(result.furniture.every(candidate=>candidate.hidden===false&&candidate.text==='Recurring journal header'));assert.equal(result.original.text,text);assert.equal(result.reprocessed.text,text);
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
 await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(collected,1);assert.equal(env.calls.length,3);
 assert.equal(env.checkpoints.chunks(env.revision.id)[0].evidence.pages[0].ocr.lines[0].text,'SUPPLEMENTAL SECRET OCR');
});

test('original-page evidence is durable before requests and restart reuses the same evidence without native regeneration',async t=>{
 let collected=0,first=true;const evidenceService={capabilities:()=>({originalPages:true,ocr:true,externalImages:true,reason:'synthetic'}),collect:async(_vault,_id,input)=>{collected++;return syntheticEvidence(input,{withImage:true});},assertCurrent(){}};
 const env=harness(t,{pages:1,pageStartLines:[1],evidenceService,evidenceOptions:{originalPages:true,ocr:false,allowExternalTransmission:true},provider:(request,control)=>{assert.equal(control.images.length,1);assert.equal(control.consent,true);assert.ok(env.checkpoints.chunks(env.revision.id)[0].evidence.images.length);assert.ok(!JSON.stringify(request).includes(control.images[0].base64));if(first){first=false;control.lock();}return echo(request);}});
 await env.worker.tick();assert.equal(env.value.status,'failed');assert.equal(collected,1);assert.equal(env.calls.length,1);
 env.restart();env.worker.resume('vault',env.revision.fileId,env.revision.id);await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(collected,1);assert.equal(env.calls.length,3);
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
 assert.ok(env.calls.every(request=>!JSON.stringify(request.availableEvidence??{}).includes(replacement)));assert.equal(env.calls.length,3);
 currentTrust=false;const changedExtractor=harness(t,{text,pages:1,pageStartLines:[1],evidenceService,evidenceOptions:{originalPages:false,ocr:true,allowExternalTransmission:false},provider:request=>JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace('rnodern','modern')})),diagnostics:[],unresolved:false})});await changedExtractor.worker.tick();assert.equal(changedExtractor.value.status,'completed');assert.equal(changedExtractor.value.patches[0].decision,'pending');assert.equal(changedExtractor.value.reprocessed.text,text);
});

test('omitted V2 configuration starts from existing text without invoking optional local OCR',async t=>{
 let collected=0;const evidenceService={capabilities:()=>({originalPages:true,ocr:true,externalImages:true,reason:'synthetic'}),collect:async(_vault,_id,input)=>{collected++;return syntheticEvidence(input);},assertCurrent(){}};
 const defaults=harness(t,{pages:1,pageStartLines:[1],evidenceService,omitConfiguration:true});assert.equal(defaults.revision.configuration.evidence.ocr,false);assert.equal(defaults.revision.configuration.evidence.allowExternalTransmission,false);
 await defaults.worker.tick();assert.equal(defaults.value.status,'completed');assert.equal(collected,0);
 const optedOut=harness(t,{pages:1,pageStartLines:[1],evidenceService});assert.equal(optedOut.revision.configuration.evidence.ocr,false);await optedOut.worker.tick();assert.equal(optedOut.value.status,'completed');assert.equal(collected,0);
});

test('local evidence progress is durable while the next chunk is collecting and before model dispatch',{timeout:2000},async t=>{
 let collected=0,release,entered;const held=new Promise(resolve=>{entered=resolve;});
 const evidenceService={capabilities:()=>({originalPages:true,ocr:true,externalImages:true,reason:'synthetic'}),collect:async(_vault,_id,input)=>{if(++collected===2)return new Promise(resolve=>{release=()=>resolve(syntheticEvidence(input));entered();});return syntheticEvidence(input);},assertCurrent(){}};
 const env=harness(t,{text:'Synthetic prose '.repeat(800),pages:1,pageStartLines:[1],evidenceService,evidenceOptions:{originalPages:false,ocr:true,allowExternalTransmission:false}}),work=env.worker.tick();
 await held;try{assert.deepEqual(env.value.report.evidencePreparation,{state:'collecting',preparedChunks:1,totalChunks:2});assert.equal(env.calls.length,0);}finally{release();}
 await work;assert.equal(env.value.status,'completed');assert.deepEqual(env.value.report.evidencePreparation,{state:'completed',preparedChunks:2,totalChunks:2});assert.equal(env.calls.length,5);
});

test('document stages finish every first pass before synthesis and supply bounded frozen context to verification',async t=>{
 const env=harness(t,{text:'Chapter I\n\nA synthetic definition and quotation.\n\n'.repeat(400)});await env.worker.tick();
 const result=env.value,count=result.report.chunksTotal;assert.equal(result.status,'completed');assert.ok(count>1);
 assert.deepEqual(env.calls.map(call=>call.kind),[...Array(count).fill('reconstruct'),'synthesis',...Array(count).fill('verify')]);
 const synthesis=env.checkpoints.synthesis(result.id);assert.equal(synthesis.status,'completed');assert.equal(synthesis.register.constituentHashes.length,count);assert.equal(synthesis.register.missingChunkIndexes.length,0);assert.equal(result.report.contextHash,synthesis.register.hash);
 for(const call of env.calls.filter(call=>call.kind==='verify')){assert.ok(call.documentContext);assert.ok(call.adjacentContext);assert.ok(JSON.stringify(call.documentContext).length<16000);}
 assert.equal(env.calls.length,count*2+1);assert.equal(result.report.inputTokens,(count*2+1)*10);
});

test('failed first-pass output retains successful siblings and synthesis records explicit incomplete coverage',async t=>{
 const env=harness(t,{text:'Synthetic canonical passage. '.repeat(800),provider:request=>request.kind==='reconstruct'&&request.chunkIndex===0?'malformed JSON':echo(request)});await env.worker.tick();
 const result=env.value;assert.equal(result.status,'failed');assert.ok(result.report.chunksTotal>1);assert.deepEqual(result.report.coverage.incompleteChunkIndexes,[0]);
 const synthesis=env.checkpoints.synthesis(result.id);assert.deepEqual(synthesis.register.missingChunkIndexes,[0]);
 assert.ok(env.checkpoints.passes(result.id).some(pass=>pass.chunkIndex===1&&pass.index===2&&pass.status==='completed'));
 assert.ok(!env.calls.some(call=>call.chunkIndex===0&&call.kind==='verify'));assert.ok(env.calls.some(call=>call.chunkIndex===1&&call.kind==='verify'));
 const before=env.calls.length;env.restart();env.worker.resume('vault',result.fileId,result.id);await env.worker.tick();assert.equal(env.calls.length,before);
 for(const index of env.value.report.completedChunkIndexes)assert.equal(env.checkpoints.chunks(result.id).find(chunk=>chunk.index===index).status,'completed');
});

test('interrupted synthesis is reserved durably and cannot be silently replayed',async t=>{
 const env=harness(t);await env.worker.tick();const synthesis=env.checkpoints.synthesis(env.revision.id);synthesis.status='running';synthesis.result=null;synthesis.register=null;env.checkpoints.saveSynthesis(synthesis);
 env.checkpoints.interruptRunning(env.revision.id);const interrupted=env.checkpoints.synthesis(env.revision.id);assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.outcomeUncertain,true);
 const row=env.value;row.status='failed';env.store.run('UPDATE source_reprocessing SET status=?,payload=? WHERE id=?','failed',JSON.stringify(row),row.id);env.restart();assert.throws(()=>env.worker.resume('vault',row.fileId,row.id),/uncertain/);
});

test('two stage workers settle all admitted siblings and never overlap reconstruction with verification',async t=>{
 let active=0,maximum=0,firstCompleted=0;
 const env=harness(t,{text:'Synthetic prose for a bounded concurrency fixture. '.repeat(700),provider:async request=>{
  active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,2));
  if(request.kind==='reconstruct')firstCompleted++;
  if(request.kind==='verify')assert.equal(firstCompleted,env.value.report.chunksTotal);
  active--;return echo(request);
 }});
 await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(maximum,2);assert.equal(active,0);assert.equal(env.value.report.concurrency,2);
});

test('known local admission failure is distinguished from uncertain transport and not silently resubmitted',async t=>{
 const error=Object.assign(new Error('Editorial AI capacity busy'),{name:'GenerationAdmissionError'});
 const env=harness(t,{provider:()=>{throw error;}});await env.worker.tick();const pass=env.checkpoints.passes(env.revision.id)[0];assert.equal(pass.failureKind,'admission');assert.equal(pass.outcomeUncertain,false);assert.equal(env.value.report.excerpts[0].errorCode,'admission');
 env.restart();env.worker.resume('vault',env.revision.fileId,env.revision.id);await env.worker.tick();assert.equal(env.calls.length,1);assert.equal(env.checkpoints.passes(env.revision.id)[0].status,'failed');
});

function repair(env,overrides={}){
 const revision=env.value;
 return repairReconstructionPass({store:env.store,revision,chunkIndex:0,passIndex:2,allowAdditionalRequest:true,intelligence:env.intelligence,activity:env.activity,vault:'vault',signal:new AbortController().signal,guard:()=>{},save:()=>env.store.run('UPDATE source_reprocessing SET payload=? WHERE id=?',JSON.stringify(revision),revision.id),...overrides});
}

test('explicit schema repair is a separately durable paid request consumed on resume without altering original output',async t=>{
 const env=harness(t,{provider:request=>request.kind==='verify'?'not JSON':echo(request)});await env.worker.tick();const original=structuredClone(env.checkpoints.passes(env.revision.id)[1]);assert.equal(original.failureKind,'invalid_output');
 const record=await repair(env);assert.equal(record.kind,'repair');assert.equal(record.status,'completed');assert.equal(record.originalRequestHash,original.requestHash);assert.equal(env.calls.length,4);assert.deepEqual(env.checkpoints.passes(env.revision.id)[1],original);
 env.restart();env.worker.resume('vault',env.revision.fileId,env.revision.id);await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(env.calls.length,4);assert.equal(env.checkpoints.repairs(env.revision.id).length,1);assert.deepEqual(env.checkpoints.passes(env.revision.id)[1],original);assert.equal(env.value.report.inputTokens,40);assert.equal(env.value.report.excerpts[0].attempts,3);
});

test('repair requires explicit additional request consent and cannot change frozen first-pass synthesis',async t=>{
 const env=harness(t,{text:'Synthetic canonical passage. '.repeat(800),provider:request=>request.kind==='reconstruct'&&request.chunkIndex===0?'invalid JSON':echo(request)});await env.worker.tick();const count=env.calls.length;
 await assert.rejects(repair(env,{allowAdditionalRequest:false}),/explicit consent/);await assert.rejects(repair(env,{passIndex:1}),/frozen document synthesis/);assert.equal(env.calls.length,count);assert.equal(env.checkpoints.repairs(env.revision.id).length,0);
});

test('uncertain repair is never replayed and prevents ordinary resume',async t=>{
 const env=harness(t,{provider:request=>{if(request.kind==='verify')return 'invalid JSON';if(request.kind==='repair')throw Error('Lost paid repair connection');return echo(request);}});await env.worker.tick();
 await assert.rejects(repair(env),/Lost paid repair/);assert.equal(env.checkpoints.repairs(env.revision.id)[0].outcomeUncertain,true);
 const before=env.calls.length;await assert.rejects(repair(env),/uncertain/);env.restart();assert.throws(()=>env.worker.resume('vault',env.revision.fileId,env.revision.id),/uncertain/);assert.equal(env.calls.length,before);
});

test('explicit first-pass repair before synthesis freezes the effective repair result as a constituent',async t=>{
 const env=harness(t,{provider:request=>request.kind==='reconstruct'?'not JSON':echo(request)});await env.worker.tick();assert.equal(env.value.status,'failed');assert.equal(env.checkpoints.synthesis(env.revision.id),undefined);
 const record=await repair(env,{passIndex:1});env.restart();env.worker.resume('vault',env.revision.fileId,env.revision.id);await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(env.calls.length,4);assert.equal(env.checkpoints.synthesis(env.revision.id).register.constituentHashes[0].requestHash,record.requestHash);assert.equal(env.checkpoints.passes(env.revision.id)[0].result,'not JSON');
});

test('crash recovery materializes compact committed accepted patches before uncertain requests block resume',async t=>{
 const env=harness(t,{depth:'light',text:'Synthetic  passage.',provider:request=>JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace('  ',' ')}))})});await env.worker.tick();const pending=env.value;const completed=env.worker.review('vault',pending.fileId,pending.id,{updatedAt:pending.updatedAt,decisions:pending.patches.map(patch=>({patchId:patch.id,decision:'accepted'}))});
 assert.equal(completed.status,'completed');assert.ok(completed.patches.some(patch=>patch.decision==='accepted'));assert.equal(completed.reprocessed.text,'Synthetic passage.');
 const stale=structuredClone(completed);stale.status='running';stale.reprocessed=structuredClone(stale.original);env.store.run('UPDATE source_reprocessing SET status=?,payload=? WHERE id=?','running',JSON.stringify(stale),stale.id);
 const pass=env.checkpoints.passes(stale.id)[0];pass.status='running';pass.outcomeUncertain=false;env.checkpoints.savePass(pass);env.restart();
 assert.equal(env.value.status,'interrupted');assert.equal(env.value.reprocessed.text,'Synthetic passage.');assert.equal(env.checkpoints.passes(stale.id)[0].outcomeUncertain,true);assert.throws(()=>env.worker.resume('vault',stale.fileId,stale.id),/uncertain/);
});

test('invalid synthesis preserves actual durable output with separate schema versus JSON failure categories and no replay',async t=>{
 for(const [raw,failureKind] of [['not JSON','invalid_output'],['{"observations":null}','validation']]){
  const env=harness(t,{synthesisProvider:()=>raw});await env.worker.tick();const synthesis=env.checkpoints.synthesis(env.revision.id);assert.equal(env.value.status,'failed');assert.equal(synthesis.status,'completed');assert.equal(synthesis.result,raw);assert.equal(synthesis.outcomeUncertain,false);assert.equal(synthesis.failureKind,failureKind);assert.equal(synthesis.validation.length,1);assert.equal(env.calls.length,2);assert.equal(env.value.report.inputTokens,20);
  env.restart();env.worker.resume('vault',env.revision.fileId,env.revision.id);await env.worker.tick();assert.equal(env.value.status,'failed');assert.equal(env.calls.length,2);assert.equal(env.checkpoints.synthesis(env.revision.id).result,raw);
 }
});


test('final deterministic audit remains durable when review rematerializes a derivative',async t=>{
 const env=harness(t,{text:'A preserved quote “original” and equation $x=1$.',provider:request=>{if(request.kind==='synthesis')return JSON.stringify({observations:[]});return JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace('$x=1$','$x=2$')})),diagnostics:[],unresolved:false});}});
 await env.worker.tick();const result=env.value;assert.equal(result.status,'completed');
 const audit=structuredClone(result.report.documentAudit);assert.equal(audit.version,1);assert.equal(audit.contextHash,result.report.contextHash);assert.ok(audit.findings.some(value=>value.includes('scholarly-preservation')));
 env.worker.review('vault',result.fileId,result.id,{updatedAt:result.updatedAt,decisions:result.patches.map(patch=>({patchId:patch.id,decision:'rejected'}))});assert.deepEqual(env.value.report.documentAudit,audit);assert.equal(env.value.reprocessed.text,result.original.text);
});

test('large scholarly audit stays within the restorable finding budget and records truncation',async t=>{
 // References and definitions occupy separate physical pages/chunks. Each
 // chunk remains locally valid, so the final document-wide audit must catch loss.
 const text='<!-- Page 1 -->\n'+Array.from({length:1100},(_,index)=>`Reference [^${index}].\n`).join('')+'<!-- Page 2 -->\n'+Array.from({length:1100},(_,index)=>`[^${index}]: printed definition.\n`).join('');
 const env=harness(t,{text,pages:2,pageStartLines:[1,1102],provider:request=>request.kind==='synthesis'?JSON.stringify({observations:[]}):JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace(/^\[\^\d+\]: printed definition\.\n/gm,'')})),diagnostics:[],unresolved:false})});
 await env.worker.tick();assert.equal(env.value.status,'completed');const audit=env.value.report.documentAudit;assert.equal(audit.findings.length,1000);assert.match(audit.findings.at(-1),/omitted/);assert.deepEqual(env.value.report.validationDiagnostics,audit.findings);
});


test('unrepaired footnotes retain the canonical excerpt with a visible warning and complete',async t=>{
 const text='Reference [^note].\n\n[^note]: printed definition.\n';
 const env=harness(t,{text,provider:request=>JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace(/^\[\^note\]: printed definition\.\n/gm,'')})),diagnostics:[],unresolved:false})});
 await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(env.value.report.error,null);
 assert.ok(env.value.report.diagnostics.some(message=>/Original excerpt retained/.test(message)));
 assert.deepEqual(env.calls.map(call=>call.kind),['reconstruct','synthesis','verify','resolve']);
 assert.equal(env.value.patches.length,0);assert.equal(env.value.reprocessed.text,text);
 assert.ok(!env.value.report.validationDiagnostics.some(message=>/missing-reference/.test(message)));
 const audit=structuredClone(env.value.report.documentAudit),retained=env.value;retained.status='interrupted';
 env.store.run('UPDATE source_reprocessing SET status=?,payload=? WHERE id=?','interrupted',JSON.stringify(retained),retained.id);
 env.calls.length=0;env.restart();env.worker.resume('vault',retained.fileId,retained.id);await env.worker.tick();
 assert.equal(env.value.status,'completed');assert.equal(env.calls.length,0);assert.deepEqual(env.value.report.documentAudit,audit);
});


test('explicit resume recovers incomplete first-pass output and retains completed siblings and frozen synthesis',async t=>{
 const {GenerationResponseError}=await import('../src/server/modules/intelligence.ts');let fail=true;const budgets=[];
 const env=harness(t,{text:'Synthetic canonical passage. '.repeat(800),provider:(request,control)=>{
  if(request.kind==='reconstruct'&&request.chunkIndex===0){budgets.push(control.outputTokenBudget);if(fail)throw new GenerationResponseError('provider_output_limit');}
  return echo(request);
 }});await env.worker.tick();const stopped=env.value;
 assert.equal(stopped.status,'failed');assert.equal(stopped.report.errorCode,'provider_output_limit');assert.deepEqual(stopped.report.coverage.incompleteChunkIndexes,[0]);
 const sibling=structuredClone(env.checkpoints.passes(stopped.id,1)),synthesis=structuredClone(env.checkpoints.synthesis(stopped.id)),before=env.calls.length;
 assert.equal(env.checkpoints.passes(stopped.id,0)[0].outcomeUncertain,false);
 fail=false;env.restart();env.worker.resume('vault',stopped.fileId,stopped.id);await env.worker.tick();
 assert.equal(env.value.status,'completed');assert.deepEqual(env.calls.slice(before).map(call=>[call.kind,call.chunkIndex]),[['reconstruct',0],['verify',0]]);
 assert.deepEqual(env.checkpoints.passes(stopped.id,1),sibling);assert.deepEqual(env.checkpoints.synthesis(stopped.id),synthesis);assert.deepEqual(budgets,[undefined,32000]);
 const recovered=env.checkpoints.passes(stopped.id,0)[0];assert.equal(recovered.responseAttempts.length,1);assert.match(recovered.responseAttempts[0].error,/token limit/);assert.equal(recovered.responseAttempts[0].inputTokens,10);
 assert.equal(env.value.report.coverage.firstPassCompleted,env.value.report.chunksTotal);
 assert.equal(env.value.report.inputTokens,env.calls.length*10);assert.equal(env.value.report.excerpts[0].inputTokens,30);
 await assertRecoveryArchive(env);
});

for(const phase of ['verify','synthesis'])test(`explicit resume recovers incomplete ${phase} without replaying completed requests`,async t=>{
 const {GenerationResponseError}=await import('../src/server/modules/intelligence.ts');let fail=true;const budgets=[];
 const env=harness(t,{provider:(request,control)=>{if(request.kind===phase){budgets.push(control.outputTokenBudget);if(fail)throw new GenerationResponseError('provider_empty_output');}return echo(request);},synthesisProvider:()=>{if(phase==='synthesis'&&fail)throw new GenerationResponseError('provider_output_limit');return JSON.stringify({observations:[]});}});
 await env.worker.tick();const stopped=env.value;assert.equal(stopped.status,'failed');const firstPass=structuredClone(env.checkpoints.passes(stopped.id)[0]),before=env.calls.length;
 fail=false;env.restart();env.worker.resume('vault',stopped.fileId,stopped.id);await env.worker.tick();assert.equal(env.value.status,'completed');
 assert.deepEqual(env.checkpoints.passes(stopped.id)[0],firstPass);assert.deepEqual(env.calls.slice(before).map(call=>call.kind),phase==='verify'?['verify']:['synthesis','verify']);
 const checkpoint=phase==='verify'?env.checkpoints.passes(stopped.id)[1]:env.checkpoints.synthesis(stopped.id);assert.equal(checkpoint.outputTokenBudget,32000);assert.equal(checkpoint.responseAttempts.length,1);
 assert.equal(env.value.report.inputTokens,env.calls.length*10);await assertRecoveryArchive(env);
});

test('legacy incomplete response checkpoints recover on explicit resume with bounded retry budgets',async t=>{
 const env=harness(t,{depth:'light',provider:()=>{throw Error('OpenAI returned an incomplete response. Try a lower reasoning effort or a shorter page.');}});
 await env.worker.tick();assert.equal(env.value.report.errorCode,'provider_incomplete_output');
 for(const budget of [32000,64000]){env.restart();env.worker.resume('vault',env.revision.fileId,env.revision.id);await env.worker.tick();assert.equal(env.checkpoints.passes(env.revision.id)[0].outputTokenBudget,budget);}
 const before=env.calls.length;env.restart();env.worker.resume('vault',env.revision.fileId,env.revision.id);await env.worker.tick();assert.equal(env.calls.length,before);assert.equal(env.value.status,'failed');assert.notEqual(env.value.report.errorCode,'configuration');
});


async function assertRecoveryArchive(env){
 const {restoreReprocessingCheckpoints,restoreReprocessingSynthesis,validateReprocessingConfiguration}=await import('../src/server/modules/source-reprocessing-backup.ts');
 const r=env.value;r.configuration=validateReprocessingConfiguration(r.configuration);
 const passes=env.checkpoints.passes(r.id),chunks=env.checkpoints.chunks(r.id);
 const restored=restoreReprocessingCheckpoints(r,r.id,r.baseHash,chunks,passes);assert.deepEqual(restored.passes,passes);
 const synthesis=env.checkpoints.synthesis(r.id);if(synthesis)assert.deepEqual(restoreReprocessingSynthesis(synthesis,r,r.id,r.baseHash,passes),synthesis);
 const altered=structuredClone(passes);altered[0].outputTokenBudget=999999;
 assert.throws(()=>restoreReprocessingCheckpoints(r,r.id,r.baseHash,chunks,altered),/invalid source editorial/);
}


test('Balanced materializes restored paragraphs and paired printed footnotes without a separate OCR run',async t=>{
 const text='The first paragraph has a printed note1 and a hard\nline wrap. Another paragraph begins here.\n\n1. The printed note preserves its exact wording.';
 const restore=text=>text.replace('note1','note[^p1-1]').replace('hard\nline','hard line').replace('. Another','.\n\nAnother').replace(/^1\. /m,'[^p1-1]: ');
 const env=harness(t,{text,pages:1,pageStartLines:[1],provider:request=>JSON.stringify({blocks:request.blocks.map(block=>({...block,text:restore(block.text)})),diagnostics:[],unresolved:false})});
 await env.worker.tick();const result=env.value;
 assert.equal(result.status,'completed');assert.equal(result.original.text,text);assert.equal(result.reprocessed.text,restore(text));
 assert.ok(result.patches.some(patch=>patch.category==='footnote'&&patch.decision==='accepted'));
 assert.ok(result.patches.every(patch=>patch.decision==='accepted'));assert.equal(result.configuration.evidence.ocr,false);
 const {sourceDocumentEntries}=await import('../src/shared/source-document.ts');const nodes=sourceDocumentEntries(result.reprocessed.document);
 assert.ok(nodes.some(({node})=>node.kind==='footnote'));assert.ok(nodes.filter(({node})=>node.kind==='paragraph').length>=2);
 await assertRecoveryArchive(env);
 assert.match(env.prompts[0],/actively restore readable paragraph boundaries/);assert.match(env.prompts.at(-1),/verification must not revert useful layout/);
 assert.deepEqual(env.calls[0].physicalPages,{startPage:1,endPage:1});assert.equal(env.calls.length,3);
 const before=structuredClone(result.patches);result.status='interrupted';env.store.run('UPDATE source_reprocessing SET status=?,payload=? WHERE id=?','interrupted',JSON.stringify(result),result.id);
 env.restart();env.worker.resume('vault',result.fileId,result.id);await env.worker.tick();assert.equal(env.calls.length,3);assert.deepEqual(env.value.patches,before);
});

test('legacy reconstruction checkpoints keep their prompt and request hashes during incomplete-response recovery',async t=>{
 const {GenerationResponseError}=await import('../src/server/modules/intelligence.ts');let fail=true;
 const env=harness(t,{depth:'light',provider:request=>{if(fail)throw new GenerationResponseError('provider_output_limit');return echo(request);}});
 const r=env.value;r.report.promptVersion='source-reconstruction-v2-3';env.store.run('UPDATE source_reprocessing SET payload=? WHERE id=?',JSON.stringify(r),r.id);
 await env.worker.tick();const hash=env.checkpoints.passes(r.id)[0].requestHash;fail=false;
 env.restart();env.worker.resume('vault',r.fileId,r.id);await env.worker.tick();assert.equal(env.value.status,'completed');assert.equal(env.checkpoints.passes(r.id)[0].requestHash,hash);
 assert.equal(env.checkpoints.passes(r.id)[0].promptVersion,'source-reconstruction-v2-3');assert.equal(env.calls[0].physicalPages,undefined);assert.doesNotMatch(env.prompts[0],/actively restore/);
});

for(const depth of ['balanced','deep'])test(`${depth} uses a bounded AI pass to repair a verification-dropped footnote`,async t=>{
 const text='Reference1.\n\n1 printed definition.\n';
 const paired=blocks=>blocks.map(block=>({...block,text:block.text.replace('Reference1.','Reference[^p1-1].').replace('1 printed definition.','[^p1-1]: printed definition.')}));
 const env=harness(t,{depth,text,pages:1,pageStartLines:[1],provider:request=>{
  if(request.kind==='resolve'){
   assert.match(request.difficultyReason,/footnote repair.*p1-1/);
   assert.ok(request.previous.blocks.some(block=>block.text.includes('Reference[^p1-1].')));
   assert.ok(!request.previous.blocks.some(block=>block.text.includes('[^p1-1]:')));
  }
  return JSON.stringify({blocks:request.kind==='verify'?paired(request.blocks).map(block=>({...block,text:block.text.replace('[^p1-1]: printed definition.','')})):paired(request.blocks),diagnostics:[],unresolved:false});
 }});
 await env.worker.tick();const result=env.value;
 assert.equal(result.status,'completed');assert.equal(result.report.chunksCompleted,1);
 assert.deepEqual(env.calls.map(call=>call.kind),['reconstruct','synthesis','verify','resolve']);
 assert.equal(result.report.excerpts[0].requiredPassCount,3);assert.match(result.reprocessed.text,/\[\^p1-1\]: printed definition/);
 assert.ok(!result.report.validationDiagnostics.some(message=>/missing-reference/.test(message)));
 // Reproduce an existing failed revision: all paid responses remain durable,
 // but the final correction has not been requested yet.
 env.store.run('DELETE FROM source_reprocessing_passes WHERE revision_id=? AND pass_index=3',result.id);
 result.status='failed';result.report.chunksCompleted=0;result.report.completedChunkIndexes=[];result.report.charactersReviewed=0;result.patches=[];
 env.store.run('UPDATE source_reprocessing SET status=?,payload=? WHERE id=?','failed',JSON.stringify(result),result.id);
 env.calls.length=0;env.restart();env.worker.resume('vault',result.fileId,result.id);await env.worker.tick();
 assert.equal(env.value.status,'completed');assert.deepEqual(env.calls.map(call=>call.kind),['resolve']);
 assert.equal(env.value.report.inputTokens,50);assert.match(env.value.reprocessed.text,/\[\^p1-1\]: printed definition/);
});

test('final AI verification rejects initial furniture proposals and clears provisional chunk annotations',async t=>{
 const text=Array.from({length:3},(_,i)=>`<!-- Page ${i+1} -->\nRecurring journal header\nDistinct body ${i+1}.\n`).join('');
 const env=harness(t,{text,pages:3,pageStartLines:[1,4,7],provider:request=>JSON.stringify({blocks:request.blocks,pageFurniture:request.kind==='verify'?[]:request.pageBoundaryCandidates.map(({blockId,quote,kind})=>({blockId,quote,kind}))})});
 // Previously seeded suggestions must not survive the verification decision.
 const r=env.value;r.furniture=[{id:'old-provisional',startOffset:17,endOffset:41,page:1,text:text.slice(17,41),kind:'header',hidden:false,reason:'Provisional'}];
 env.store.run('UPDATE source_reprocessing SET payload=? WHERE id=?',JSON.stringify(r),r.id);
 await env.worker.tick();assert.equal(env.value.status,'completed');assert.deepEqual(env.value.furniture,[]);
 assert.equal(env.calls.length,7);assert.deepEqual(env.value.original.text,text);
});
