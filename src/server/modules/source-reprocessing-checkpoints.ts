import {Store} from '../store.js';
import type {SourceDocumentSynthesis} from './source-reprocessing-context.js';
import type {SourceReprocessingChunk,SourceReprocessingPass,SourceEditorialUsage,SourceReprocessingConfiguration} from '../../shared/source-reprocessing.js';

export interface SynthesisEvidenceReview extends SourceEditorialUsage {status:'running'|'completed'|'failed'|'interrupted';requestHash:string;promptVersion:string;result:string|null;error:string|null;startedAt:string;finishedAt:string|null;outcomeUncertain:boolean}

export interface SourceReprocessingSynthesisCheckpoint extends SourceEditorialUsage { review?:SynthesisEvidenceReview; revisionId:string;status:'running'|'completed'|'failed'|'interrupted';requestHash:string;promptVersion:string;model:string;reasoningEffort:SourceReprocessingPass['reasoningEffort'];configuration:SourceReprocessingConfiguration;result:string|null;register:SourceDocumentSynthesis|null;failureKind?:SourceReprocessingPass['failureKind'];validation?:string[];startedAt:string;finishedAt:string|null;error:string|null;outcomeUncertain:boolean }

export interface SourceReprocessingRepairCheckpoint extends Omit<SourceReprocessingPass,'index'|'kind'> {repairId:string;passIndex:1|2|3;kind:'repair';originalRequestHash:string;originalResultHash:string}

/** Durable model requests are reserved before transmission and never inferred from a chunk summary. */
export class SourceReprocessingCheckpoints {
 constructor(private store:Store) {}
 private synthesisTable(){this.store.run('CREATE TABLE IF NOT EXISTS source_reprocessing_synthesis (revision_id TEXT PRIMARY KEY REFERENCES source_reprocessing(id) ON DELETE CASCADE,payload TEXT NOT NULL CHECK(json_valid(payload)))');}
 private repairTable(){this.store.run('CREATE TABLE IF NOT EXISTS source_reprocessing_repairs (revision_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,pass_index INTEGER NOT NULL,repair_id TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),PRIMARY KEY(revision_id,repair_id),FOREIGN KEY(revision_id,chunk_index) REFERENCES source_reprocessing_chunks(revision_id,chunk_index) ON DELETE CASCADE)');}
 repairs(revisionId:string,chunkIndex?:number,passIndex?:number):SourceReprocessingRepairCheckpoint[]{this.repairTable();return this.store.all<{payload:string}>('SELECT payload FROM source_reprocessing_repairs WHERE revision_id=? ORDER BY repair_id',revisionId).map(row=>JSON.parse(row.payload) as SourceReprocessingRepairCheckpoint).filter(repair=>(chunkIndex===undefined||repair.chunkIndex===chunkIndex)&&(passIndex===undefined||repair.passIndex===passIndex));}
 saveRepair(value:SourceReprocessingRepairCheckpoint){this.repairTable();this.store.run('INSERT INTO source_reprocessing_repairs(revision_id,chunk_index,pass_index,repair_id,payload) VALUES(?,?,?,?,?) ON CONFLICT(revision_id,repair_id) DO UPDATE SET payload=excluded.payload',value.revisionId,value.chunkIndex,value.passIndex,value.repairId,JSON.stringify(value));}
 synthesis(revisionId:string):SourceReprocessingSynthesisCheckpoint|undefined {this.synthesisTable();const row=this.store.get<{payload:string}>('SELECT payload FROM source_reprocessing_synthesis WHERE revision_id=?',revisionId);return row?JSON.parse(row.payload) as SourceReprocessingSynthesisCheckpoint:undefined;}
 saveSynthesis(value:SourceReprocessingSynthesisCheckpoint){this.synthesisTable();this.store.run('INSERT INTO source_reprocessing_synthesis(revision_id,payload) VALUES(?,?) ON CONFLICT(revision_id) DO UPDATE SET payload=excluded.payload',value.revisionId,JSON.stringify(value));}

 chunks(revisionId:string):SourceReprocessingChunk[]{return this.store.all<{payload:string}>('SELECT payload FROM source_reprocessing_chunks WHERE revision_id=? ORDER BY chunk_index',revisionId).map(row=>JSON.parse(row.payload) as SourceReprocessingChunk);}
 passes(revisionId:string,chunkIndex?:number):SourceReprocessingPass[]{return (chunkIndex===undefined?this.store.all<{payload:string}>('SELECT payload FROM source_reprocessing_passes WHERE revision_id=? ORDER BY chunk_index,pass_index',revisionId):this.store.all<{payload:string}>('SELECT payload FROM source_reprocessing_passes WHERE revision_id=? AND chunk_index=? ORDER BY pass_index',revisionId,chunkIndex)).map(row=>JSON.parse(row.payload) as SourceReprocessingPass);}
 saveChunk(chunk:SourceReprocessingChunk){this.store.run('INSERT INTO source_reprocessing_chunks(revision_id,chunk_index,payload) VALUES(?,?,?) ON CONFLICT(revision_id,chunk_index) DO UPDATE SET payload=excluded.payload',chunk.revisionId,chunk.index,JSON.stringify(chunk));}
 savePass(pass:SourceReprocessingPass){this.store.run('INSERT INTO source_reprocessing_passes(revision_id,chunk_index,pass_index,payload) VALUES(?,?,?,?) ON CONFLICT(revision_id,chunk_index,pass_index) DO UPDATE SET payload=excluded.payload',pass.revisionId,pass.chunkIndex,pass.index,JSON.stringify(pass));}
 interruptRepairs(revisionId?:string){
  this.repairTable();
  const repairRows=revisionId===undefined?this.store.all<{payload:string}>("SELECT payload FROM source_reprocessing_repairs WHERE json_extract(payload,'$.status')='running'"):this.store.all<{payload:string}>("SELECT payload FROM source_reprocessing_repairs WHERE revision_id=? AND json_extract(payload,'$.status')='running'",revisionId);
  for(const row of repairRows){const value=JSON.parse(row.payload) as SourceReprocessingRepairCheckpoint;value.status='interrupted';value.outcomeUncertain=true;value.finishedAt=new Date().toISOString();value.error='Application stopped during explicit repair; provider outcome is unknown and must not be replayed.';this.saveRepair(value);}
 }
 interruptRunning(revisionId?:string){
  this.synthesisTable();this.interruptRepairs(revisionId);
  const synthesisRows=revisionId===undefined?this.store.all<{payload:string}>("SELECT payload FROM source_reprocessing_synthesis WHERE (json_extract(payload,'$.status')='running' OR json_extract(payload,'$.review.status')='running')"):this.store.all<{payload:string}>("SELECT payload FROM source_reprocessing_synthesis WHERE revision_id=? AND (json_extract(payload,'$.status')='running' OR json_extract(payload,'$.review.status')='running')",revisionId);
  for(const row of synthesisRows){const value=JSON.parse(row.payload) as SourceReprocessingSynthesisCheckpoint;if(value.review?.status==='running'){value.review.status='interrupted';value.review.outcomeUncertain=true;value.review.finishedAt=new Date().toISOString();value.review.error='Application stopped during summary evidence review; provider outcome is unknown.';}else{value.status='interrupted';value.outcomeUncertain=true;value.finishedAt=new Date().toISOString();value.error='Application stopped during synthesis; provider outcome is unknown and must not be replayed.';}this.saveSynthesis(value);}

  const rows=revisionId===undefined?this.store.all<{payload:string}>("SELECT payload FROM source_reprocessing_passes WHERE json_extract(payload,'$.status')='running' "):this.store.all<{payload:string}>("SELECT payload FROM source_reprocessing_passes WHERE revision_id=? AND json_extract(payload,'$.status')='running'",revisionId);
  for(const row of rows){const pass=JSON.parse(row.payload) as SourceReprocessingPass;if(pass.status!=='running')continue;pass.status='interrupted';pass.outcomeUncertain=true;pass.finishedAt=new Date().toISOString();pass.error='Application stopped during a request. Provider outcome is unknown; this request must not be repeated automatically.';this.savePass(pass);}
  const chunks=revisionId===undefined?this.store.all<{payload:string}>("SELECT payload FROM source_reprocessing_chunks WHERE json_extract(payload,'$.status')='running' "):this.store.all<{payload:string}>("SELECT payload FROM source_reprocessing_chunks WHERE revision_id=? AND json_extract(payload,'$.status')='running'",revisionId);
  for(const row of chunks){const chunk=JSON.parse(row.payload) as SourceReprocessingChunk;if(chunk.status==='running'){chunk.status='interrupted';this.saveChunk(chunk);}}
 }
}
