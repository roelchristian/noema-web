import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
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
 const r=fixture(),restored=restoreSourceRevision(r,r.id,r.fileId,'restored','restored-file');
 const p1=pass(r),p2={...pass(r),index:2,kind:'verify',status:'running',result:null,finishedAt:null};
 const result=restoreReprocessingCheckpoints(restored,r.id,r.baseHash,[chunk(r)],[p2,p1]);assert.equal(result.chunks[0].baseHash,restored.baseHash);assert.equal(result.passes[0].outcomeUncertain,true);assert.equal(result.passes[1].result,p1.result);assert.equal(result.passes[1].inputTokens,10);assert.ok(result.passes.every(p=>p.revisionId==='restored'));
 assert.throws(()=>restoreReprocessingCheckpoints(restored,r.id,r.baseHash,[{...chunk(r),status:'completed'}],[p1]),/invalid source editorial/);
 assert.throws(()=>restoreReprocessingCheckpoints(restored,r.id,r.baseHash,[chunk(r)],[{...p1,configuration:{...configuration,depth:'light'}}]),/invalid source editorial/);
 const legacy=structuredClone(r);delete legacy.pipelineVersion;delete legacy.configuration;assert.throws(()=>restoreReprocessingCheckpoints(legacy,r.id,r.baseHash,[chunk(r)],[p1]),/invalid source editorial/);
});

test('compressed vault backup exports and restores interrupted V2 checkpoints without starting paid work',async()=>{
 const {openDatabase}=await import('../src/server/database.ts');const {Vaults}=await import('../src/server/modules/vaults.ts');const {Knowledge}=await import('../src/server/modules/knowledge.ts');const {SourceFiles}=await import('../src/server/modules/source-files.ts');const {VaultBackups}=await import('../src/server/modules/vault-backups.ts');const {sourceRevisionBaseHash}=await import('../src/server/modules/source-reprocessing.ts');
 const db=openDatabase(':memory:');try{
 const store=new Store(db),vault=new Vaults(store).create({name:'Checkpoint backup'}),files=new SourceFiles(store),r=fixture();
 const file=files.add(vault.id,'synthetic.txt',Buffer.from('Synthetic text'));new Knowledge(store).create(vault.id,{name:'Checkpoint source',type:'source',subtypes:[],attachmentIds:[file.id]});
 r.fileId=file.id;r.original.document.source.fileId=file.id;r.baseHash=sourceRevisionBaseHash(r.original);r.reprocessed=structuredClone(r.original);
 store.run('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)',r.id,file.id,vault.id,r.status,r.createdAt,r.updatedAt,JSON.stringify(r));
 const checkpoints=new SourceReprocessingCheckpoints(store);checkpoints.saveChunk(chunk(r));checkpoints.savePass(pass(r));checkpoints.savePass({...pass(r),index:2,kind:'verify',status:'running',result:null,finishedAt:null});
 const backups=new VaultBackups(store),archive=await backups.export(vault.id),restored=await backups.import(archive.bytes);
 const row=store.get('SELECT id,payload FROM source_reprocessing WHERE vault_id=?',restored.id),passes=checkpoints.passes(row.id);assert.equal(passes.length,2);assert.equal(passes[0].result,pass(r).result);assert.equal(passes[1].status,'interrupted');assert.equal(passes[1].outcomeUncertain,true);assert.equal(JSON.parse(row.payload).configuration.depth,'balanced');assert.equal(checkpoints.chunks(row.id)[0].revisionId,row.id);
 }finally{db.close();}
});

test('backup ID remapping resumes cached successful reconstruction and calls only missing verification',async()=>{
 const {openDatabase}=await import('../src/server/database.ts');const {Vaults}=await import('../src/server/modules/vaults.ts');const {Knowledge}=await import('../src/server/modules/knowledge.ts');const {SourceFiles}=await import('../src/server/modules/source-files.ts');const {VaultBackups}=await import('../src/server/modules/vault-backups.ts');const {sourceRevisionBaseHash}=await import('../src/server/modules/source-reprocessing.ts');const {processedSourceDocument}=await import('../src/server/modules/source-document.ts');const {executeReconstruction,reconstructionPromptVersion}=await import('../src/server/modules/source-reprocessing-pass.ts');
 const db=openDatabase(':memory:');try{
 const store=new Store(db),vault=new Vaults(store).create({name:'Cache restore'}),files=new SourceFiles(store),file=files.add(vault.id,'synthetic.txt',Buffer.from('Synthetic scholarly prose.'));new Knowledge(store).create(vault.id,{name:'Synthetic source',type:'source',subtypes:[],attachmentIds:[file.id]});
 const r=fixture(),text='Synthetic scholarly prose.';r.fileId=file.id;r.original={text,document:processedSourceDocument({...file,text,format:'txt',enrichment_status:'completed'})};r.baseHash=sourceRevisionBaseHash(r.original);r.reprocessed=structuredClone(r.original);r.report.promptVersion=reconstructionPromptVersion;r.report.charactersTotal=text.length;r.status='failed';
 store.run('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)',r.id,file.id,vault.id,r.status,r.createdAt,r.updatedAt,JSON.stringify(r));
 let calls=0,guards=0;const intelligence={reeditSource:async request=>{calls++;return JSON.stringify({blocks:JSON.parse(request).blocks,diagnostics:[],unresolved:false});}},activity={start:()=>1,finish:()=>{}};
 const input=revision=>({store,revision,intelligence,activity,vault:vault.id,signal:new AbortController().signal,guard:()=>{},save:()=>store.run('UPDATE source_reprocessing SET payload=? WHERE id=?',JSON.stringify(revision),revision.id),range:(start,end)=>({startOffset:start,endOffset:end,startLine:1,endLine:1,startPage:null,endPage:null}),materialize:()=>{}});
 await assert.rejects(executeReconstruction({...input(r),guard:()=>{if(++guards===4)throw new Error('synthetic stop before verification');}}),/synthetic stop/);assert.equal(calls,1);
 const backups=new VaultBackups(store),archive=await backups.export(vault.id),newVault=await backups.import(archive.bytes),restored=JSON.parse(store.get('SELECT payload FROM source_reprocessing WHERE vault_id=?',newVault.id).payload);assert.notEqual(restored.baseHash,r.baseHash);
 await executeReconstruction({...input(restored),vault:newVault.id});assert.equal(calls,2);assert.equal(restored.report.chunksCompleted,1);assert.equal(new SourceReprocessingCheckpoints(store).passes(restored.id).filter(p=>p.status==='completed').length,2);
 }finally{db.close();}
});
