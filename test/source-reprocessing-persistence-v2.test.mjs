import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Store} from '../src/server/store.ts';
import {SourceReprocessingCheckpoints} from '../src/server/modules/source-reprocessing-checkpoints.ts';
import {setupSourceReprocessingCheckpointSchema} from '../src/server/source-reprocessing-checkpoint-schema.ts';
import {restoreReprocessingCheckpoints,restoreSourceRevision} from '../src/server/modules/source-reprocessing-backup.ts';
import {defaultSourceReprocessingConfiguration as configuration} from '../src/shared/source-reprocessing.ts';
const fixture=()=>{const r=JSON.parse(readFileSync(new URL('./fixtures/dante-editorial-revision.json',import.meta.url),'utf8'));r.patches=[];r.status='failed';r.pipelineVersion=2;r.configuration=structuredClone(configuration);r.report.excerpts=undefined;r.report.completedChunkIndexes=[];r.report.chunksCompleted=0;r.report.chunksTotal=1;r.report.charactersReviewed=0;return r;};
const chunk=r=>({revisionId:r.id,index:0,startOffset:0,endOffset:r.original.text.length,baseHash:r.baseHash,evidenceHash:'a'.repeat(64),difficulty:'ordinary',difficultyReason:null,requiredPassCount:2,status:'pending'});
const pass=r=>({revisionId:r.id,chunkIndex:0,index:1,status:'completed',kind:'reconstruct',model:r.report.model,reasoningEffort:r.report.reasoningEffort,promptVersion:r.report.promptVersion,configuration:r.configuration,requestHash:'b'.repeat(64),result:'{"blocks":[]}',validation:[],startedAt:r.createdAt,finishedAt:r.updatedAt,error:null,outcomeUncertain:false,inputTokens:10,outputTokens:5,reasoningTokens:null,cachedInputTokens:null});

test('additive checkpoint schema preserves V1 payloads and restart marks only outstanding requests uncertain',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec('PRAGMA foreign_keys=ON; CREATE TABLE source_reprocessing(id TEXT PRIMARY KEY,payload TEXT);');const r=fixture();db.prepare('INSERT INTO source_reprocessing VALUES(?,?)').run(r.id,'{"legacy":true}');
 setupSourceReprocessingCheckpointSchema(db);setupSourceReprocessingCheckpointSchema(db);const checkpoints=new SourceReprocessingCheckpoints(new Store(db));
 checkpoints.saveChunk({...chunk(r),status:'running'});checkpoints.savePass(pass(r));checkpoints.savePass({...pass(r),index:2,kind:'verify',status:'running',result:null,finishedAt:null});
 checkpoints.interruptRunning();assert.equal(checkpoints.passes(r.id)[0].result,'{"blocks":[]}');assert.equal(checkpoints.passes(r.id)[1].outcomeUncertain,true);assert.equal(checkpoints.passes(r.id)[1].status,'interrupted');assert.equal(checkpoints.chunks(r.id)[0].status,'interrupted');assert.equal(db.prepare('SELECT payload FROM source_reprocessing').get().payload,'{"legacy":true}');
 db.prepare('DELETE FROM source_reprocessing').run();assert.deepEqual(checkpoints.passes(r.id),[]);assert.deepEqual(checkpoints.chunks(r.id),[]);
 }finally{db.close();}
});

test('backup restoration retains completed pass1 and uncertain pass2 with ID remapping, rejecting false completed chunks',()=>{
 const r=fixture();r.versionNumber=7;const restored=restoreSourceRevision(r,r.id,r.fileId,'restored','restored-file');assert.equal(restored.versionNumber,7);
 const p1=pass(r),p2={...pass(r),index:2,kind:'verify',status:'running',result:null,finishedAt:null};
 const result=restoreReprocessingCheckpoints(restored,r.id,r.baseHash,[{...chunk(r),evidenceTrusted:true}],[p2,p1]);assert.equal(result.chunks[0].baseHash,restored.baseHash);assert.equal(result.chunks[0].evidenceTrusted,false);assert.equal(result.passes[0].outcomeUncertain,true);assert.equal(result.passes[1].result,p1.result);assert.equal(result.passes[1].inputTokens,10);assert.ok(result.passes.every(p=>p.revisionId==='restored'));
 assert.throws(()=>restoreReprocessingCheckpoints(restored,r.id,r.baseHash,[{...chunk(r),status:'completed'}],[p1]),/invalid source editorial/);
 assert.throws(()=>restoreReprocessingCheckpoints(restored,r.id,r.baseHash,[chunk(r)],[{...p1,configuration:{...configuration,depth:'light'}}]),/invalid source editorial/);
 const legacy=structuredClone(r);delete legacy.pipelineVersion;delete legacy.configuration;assert.throws(()=>restoreReprocessingCheckpoints(legacy,r.id,r.baseHash,[chunk(r)],[p1]),/invalid source editorial/);
});

test('backup restores completed Balanced footnote repair passes while preserving depth limits',()=>{
 const r=fixture();r.status='completed';r.report.completedChunkIndexes=[0];r.report.chunksCompleted=1;r.report.charactersReviewed=r.original.text.length;
 const restored=restoreSourceRevision(r,r.id,r.fileId,'balanced-repair-restored','balanced-repair-file');
 const repairedChunk={...chunk(r),status:'completed',difficulty:'difficult',difficultyReason:'Local validation requires footnote repair: New missing footnote definition p1-1.',requiredPassCount:3};
 const passes=[pass(r),{...pass(r),index:2,kind:'verify'},{...pass(r),index:3,kind:'resolve'}];
 const result=restoreReprocessingCheckpoints(restored,r.id,r.baseHash,[repairedChunk],passes);
 assert.equal(result.chunks[0].requiredPassCount,3);assert.equal(result.chunks[0].difficultyReason,repairedChunk.difficultyReason);
 assert.deepEqual(result.passes.map(value=>value.kind),['reconstruct','verify','resolve']);assert.ok(result.passes.every(value=>value.revisionId===restored.id));
 assert.throws(()=>restoreReprocessingCheckpoints(restored,r.id,r.baseHash,[{...repairedChunk,difficultyReason:null}],passes),/invalid source editorial/);
 assert.throws(()=>restoreReprocessingCheckpoints(restored,r.id,r.baseHash,[{...repairedChunk,requiredPassCount:1}],passes),/invalid source editorial/);
 for(const depth of ['light','deep']){
  const revision={...restored,configuration:{...restored.configuration,depth}};
  const matchingPasses=passes.map(value=>({...value,configuration:revision.configuration}));
  if(depth==='light')assert.throws(()=>restoreReprocessingCheckpoints(revision,r.id,r.baseHash,[repairedChunk],matchingPasses),/invalid source editorial/);
  else assert.equal(restoreReprocessingCheckpoints(revision,r.id,r.baseHash,[repairedChunk],matchingPasses).passes.length,3);
 }
});

test('compressed vault backup exports and restores interrupted V2 checkpoints without starting paid work',async()=>{
 const {openDatabase}=await import('../src/server/database.ts');const {Vaults}=await import('../src/server/modules/vaults.ts');const {Knowledge}=await import('../src/server/modules/knowledge.ts');const {SourceFiles}=await import('../src/server/modules/source-files.ts');const {VaultBackups}=await import('../src/server/modules/vault-backups.ts');const {sourceRevisionBaseHash}=await import('../src/server/modules/source-reprocessing.ts');
 const db=openDatabase(':memory:');try{
 const store=new Store(db),vault=new Vaults(store).create({name:'Checkpoint backup'}),files=new SourceFiles(store),r=fixture();
 const file=files.add(vault.id,'synthetic.txt',Buffer.from('Synthetic text'));new Knowledge(store).create(vault.id,{name:'Checkpoint source',type:'source',subtypes:[],attachmentIds:[file.id]});
 r.fileId=file.id;r.original.document.source.fileId=file.id;r.baseHash=sourceRevisionBaseHash(r.original);r.reprocessed=structuredClone(r.original);
 store.run('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)',r.id,file.id,vault.id,r.status,r.createdAt,r.updatedAt,JSON.stringify(r));
 r.versionNumber=JSON.parse(store.get('SELECT payload FROM source_reprocessing WHERE id=?',r.id).payload).versionNumber;
 const checkpoints=new SourceReprocessingCheckpoints(store);checkpoints.saveChunk(chunk(r));checkpoints.savePass(pass(r));checkpoints.savePass({...pass(r),index:2,kind:'verify',status:'running',result:null,finishedAt:null});
 const {synthesisPromptVersion}=await import('../src/server/modules/source-reprocessing-context.ts');
 checkpoints.saveSynthesis({...pass(r),promptVersion:synthesisPromptVersion,status:'running',result:null,register:null,finishedAt:null});
 const repair={...pass(r),repairId:'explicit-repair',passIndex:1,kind:'repair',originalRequestHash:pass(r).requestHash,originalResultHash:createHash('sha256').update(pass(r).result).digest('hex'),status:'running',result:null,finishedAt:null};delete repair.index;checkpoints.saveRepair(repair);
 const backups=new VaultBackups(store),archive=await backups.export(vault.id),restored=await backups.import(archive.bytes);
 const row=store.get('SELECT id,payload FROM source_reprocessing WHERE vault_id=?',restored.id),passes=checkpoints.passes(row.id);assert.equal(passes.length,2);assert.equal(passes[0].result,pass(r).result);assert.equal(passes[1].status,'interrupted');assert.equal(passes[1].outcomeUncertain,true);assert.equal(JSON.parse(row.payload).configuration.depth,'balanced');assert.equal(checkpoints.chunks(row.id)[0].revisionId,row.id);assert.equal(checkpoints.synthesis(row.id).status,'interrupted');assert.equal(checkpoints.synthesis(row.id).outcomeUncertain,true);assert.equal(checkpoints.repairs(row.id)[0].status,'interrupted');assert.equal(checkpoints.repairs(row.id)[0].originalRequestHash,pass(r).requestHash);
 }finally{db.close();}
});

test('backup ID remapping resumes cached reconstruction and calls only missing synthesis and verification',async()=>{
 const {openDatabase}=await import('../src/server/database.ts');const {Vaults}=await import('../src/server/modules/vaults.ts');const {Knowledge}=await import('../src/server/modules/knowledge.ts');const {SourceFiles}=await import('../src/server/modules/source-files.ts');const {VaultBackups}=await import('../src/server/modules/vault-backups.ts');const {sourceRevisionBaseHash}=await import('../src/server/modules/source-reprocessing.ts');const {processedSourceDocument}=await import('../src/server/modules/source-document.ts');const {executeReconstruction,reconstructionPromptVersion}=await import('../src/server/modules/source-reprocessing-pass.ts');
 const db=openDatabase(':memory:');try{
 const store=new Store(db),vault=new Vaults(store).create({name:'Cache restore'}),files=new SourceFiles(store),file=files.add(vault.id,'synthetic.txt',Buffer.from('Synthetic scholarly prose.'));new Knowledge(store).create(vault.id,{name:'Synthetic source',type:'source',subtypes:[],attachmentIds:[file.id]});
 const r=fixture(),text='The rnodern scholarly prose remains faithful to the printed source.';r.fileId=file.id;r.original={text,document:processedSourceDocument({...file,text,format:'pdf',pages:1,page_start_lines:'[1]',enrichment_status:'completed'})};r.configuration.architectureVersion=1;r.configuration.evidence={originalPages:true,ocr:true,allowExternalTransmission:true};r.baseHash=sourceRevisionBaseHash(r.original);r.reprocessed=structuredClone(r.original);r.report.promptVersion=reconstructionPromptVersion;r.report.charactersTotal=text.length;r.status='failed';
 store.run('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)',r.id,file.id,vault.id,r.status,r.createdAt,r.updatedAt,JSON.stringify(r));
 r.versionNumber=JSON.parse(store.get('SELECT payload FROM source_reprocessing WHERE id=?',r.id).payload).versionNumber;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'),digest=value=>createHash('sha256').update(value).digest('hex');
 const payload={version:1,canonicalText:text,pageNumbers:[1],originalPages:{available:true,reason:'Synthetic consented page'},ocr:{available:true,reason:'Synthetic OCR'},independentlyVerified:false,externalTransmissionAllowed:true,diagnostics:[],images:[{page:1,mimeType:'image/png',base64:png.toString('base64'),sha256:digest(png)}],pages:[{page:1,originalHash:'a'.repeat(64),admittedHash:'b'.repeat(64),imageHash:digest(png),canonicalRanges:[{startOffset:0,endOffset:text.length}],canonicalRegions:[{startOffset:0,endOffset:text.length,bounds:[0,0,1,1]}],ocr:{engine:'AppleVision',version:'synthetic-1',configuration:'languageCorrection=false',independent:true,lines:[{text:text.replace('rnodern','modern'),confidence:1,bounds:[0,0,1,1],alternatives:[]}],mapping:[]}}]},evidence={...payload,hash:digest(JSON.stringify(payload))};
 new SourceReprocessingCheckpoints(store).saveChunk({...chunk(r),evidence,evidenceHash:evidence.hash,evidenceTrusted:true});
 let calls=0;const requestKinds=[];const intelligence={reeditSource:async request=>{calls++;const value=JSON.parse(request);requestKinds.push(value.kind??'synthesis');return value.blocks?JSON.stringify({blocks:value.blocks.map(block=>({...block,text:block.text.replace('rnodern','modern')})),diagnostics:[],unresolved:false}):JSON.stringify({observations:[]});}},activity={start:()=>1,finish:()=>{}};
 const input=revision=>({store,revision,intelligence,activity,evidenceService:{collect:()=>{throw new Error('Cached native evidence must not regenerate');},assertCurrent:()=>{},canTrustIndependentEvidence:()=>true},vault:vault.id,signal:new AbortController().signal,guard:()=>{},save:()=>store.run('UPDATE source_reprocessing SET payload=? WHERE id=?',JSON.stringify(revision),revision.id),range:(start,end)=>({startOffset:start,endOffset:end,startLine:1,endLine:1,startPage:1,endPage:1}),materialize:()=>{}});
 await assert.rejects(executeReconstruction({...input(r),guard:()=>{if(calls===1)throw new Error('synthetic stop before verification');}}),/synthetic stop/);assert.equal(calls,1);
 const backups=new VaultBackups(store),archive=await backups.export(vault.id),newVault=await backups.import(archive.bytes),restored=JSON.parse(store.get('SELECT payload FROM source_reprocessing WHERE vault_id=?',newVault.id).payload);assert.notEqual(restored.baseHash,r.baseHash);assert.deepEqual(new SourceReprocessingCheckpoints(store).chunks(restored.id)[0].evidence,evidence);assert.equal(new SourceReprocessingCheckpoints(store).chunks(restored.id)[0].evidenceTrusted,false);
 await executeReconstruction({...input(restored),vault:newVault.id});assert.equal(calls,3);assert.deepEqual(requestKinds,['reconstruct','synthesis','verify']);assert.equal(restored.report.chunksCompleted,1);assert.equal(restored.patches.length,1);assert.equal(restored.patches[0].replacement,'m');assert.equal(restored.patches[0].decision,'pending');assert.equal(restored.reprocessed.text,text);const {evaluateV2Acceptance}=await import('../src/server/modules/source-reprocessing-risk.ts');assert.equal(evaluateV2Acceptance({text,document:r.original.document,start:text.indexOf('rn'),end:text.indexOf('rn')+2,original:'rn',replacement:'m',category:'ocr',policy:'verified',evidence}).automatic,true);assert.equal(new SourceReprocessingCheckpoints(store).passes(restored.id).filter(p=>p.status==='completed').length,2);
 }finally{db.close();}
});

test('synthesis archive preserves actual result and frozen constituents while rejecting tampering',async()=>{
 const {createSynthesisInput,parseDocumentSynthesis,synthesisPromptVersion}=await import('../src/server/modules/source-reprocessing-context.ts');
 const {planReprocessingChunks}=await import('../src/server/modules/source-reprocessing-planner.ts');
 const {restoreReprocessingSynthesis}=await import('../src/server/modules/source-reprocessing-backup.ts');
 const r=fixture();r.configuration.architectureVersion=1;
 const chunks=planReprocessingChunks(r.original.text,r.original.document,8000,true);
 const passes=chunks.map(c=>({...pass(r),chunkIndex:c.index,result:JSON.stringify({blocks:c.blocks.map(({id,text})=>({id,text})),diagnostics:[],unresolved:false})}));
 const input=createSynthesisInput({revisionId:r.id,baseHash:r.baseHash,text:r.original.text,title:r.original.document.source.title,chunks,firstPasses:passes.map(p=>({chunkIndex:p.chunkIndex,result:p.result,requestHash:p.requestHash}))});
 const result=JSON.stringify({observations:[]}),register=parseDocumentSynthesis(input,result);
 r.report.contextHash=register.hash;
 const record={revisionId:r.id,status:'completed',requestHash:createHash('sha256').update(input.request).digest('hex'),promptVersion:synthesisPromptVersion,model:r.report.model,reasoningEffort:r.report.reasoningEffort,configuration:r.configuration,result,register,startedAt:r.createdAt,finishedAt:r.updatedAt,error:null,outcomeUncertain:false,inputTokens:100,outputTokens:20,reasoningTokens:5,cachedInputTokens:0};
 const restored=restoreSourceRevision(r,r.id,r.fileId,'restored-context','restored-context-file');
 const actual=restoreReprocessingSynthesis(record,restored,r.id,r.baseHash,passes);
 assert.equal(actual.revisionId,restored.id);assert.deepEqual(actual.register,register);assert.equal(actual.result,result);assert.equal(actual.inputTokens,100);
 assert.throws(()=>restoreReprocessingSynthesis({...record,register:{...register,hash:'a'.repeat(64)}},restored,r.id,r.baseHash,passes),/invalid source editorial/);
 assert.throws(()=>restoreReprocessingSynthesis({...record,promptVersion:'invented'},restored,r.id,r.baseHash,passes),/invalid source editorial/);
 assert.throws(()=>restoreReprocessingSynthesis(record,restored,r.id,r.baseHash,passes.map(p=>({...p,result:p.result+' '}))),/invalid source editorial/);
});

test('deleting a revision cascades its durable requests while retaining other revisions',async()=>{
 const {SourceReprocessing}=await import('../src/server/modules/source-reprocessing.ts');const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE source_reprocessing(id TEXT PRIMARY KEY,file_id TEXT,vault_id TEXT,status TEXT,created_at TEXT,updated_at TEXT,payload TEXT);');setupSourceReprocessingCheckpointSchema(db);
  const store=new Store(db),service=new SourceReprocessing(store,{require:()=>({text:'Canonical source retained.'})},{},()=>{},{}),r=fixture();
  for(const id of [r.id,'keep'])store.run('INSERT INTO source_reprocessing VALUES(?,?,?,?,?,?,?)',id,r.fileId,'vault','failed',r.createdAt,r.updatedAt,JSON.stringify({...r,id}));
  const checkpoints=new SourceReprocessingCheckpoints(store);checkpoints.saveChunk(chunk(r));checkpoints.savePass(pass(r));checkpoints.saveSynthesis({...pass(r),register:null});checkpoints.saveRepair({...pass(r),repairId:'repair',passIndex:1,kind:'repair',originalRequestHash:'b'.repeat(64),originalResultHash:'c'.repeat(64)});
  assert.deepEqual(service.remove('vault',r.fileId,r.id),{deleted:true});
  for(const table of ['source_reprocessing_chunks','source_reprocessing_passes','source_reprocessing_synthesis','source_reprocessing_repairs'])assert.equal(store.get(`SELECT count(*) n FROM ${table}`).n,0);
  assert.equal(store.get('SELECT count(*) n FROM source_reprocessing').n,1);assert.equal(store.get('SELECT id FROM source_reprocessing').id,'keep');
 }finally{db.close();}
});
