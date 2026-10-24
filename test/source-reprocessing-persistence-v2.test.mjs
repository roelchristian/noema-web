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
