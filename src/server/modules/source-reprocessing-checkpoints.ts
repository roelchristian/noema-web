import {Store} from '../store.js';
import type {SourceReprocessingChunk,SourceReprocessingPass} from '../../shared/source-reprocessing.js';

/** Durable model requests are reserved before transmission and never inferred from a chunk summary. */
export class SourceReprocessingCheckpoints {
 constructor(private store:Store) {}
 chunks(revisionId:string):SourceReprocessingChunk[]{return this.store.all<{payload:string}>('SELECT payload FROM source_reprocessing_chunks WHERE revision_id=? ORDER BY chunk_index',revisionId).map(row=>JSON.parse(row.payload) as SourceReprocessingChunk);}
 passes(revisionId:string,chunkIndex?:number):SourceReprocessingPass[]{return (chunkIndex===undefined?this.store.all<{payload:string}>('SELECT payload FROM source_reprocessing_passes WHERE revision_id=? ORDER BY chunk_index,pass_index',revisionId):this.store.all<{payload:string}>('SELECT payload FROM source_reprocessing_passes WHERE revision_id=? AND chunk_index=? ORDER BY pass_index',revisionId,chunkIndex)).map(row=>JSON.parse(row.payload) as SourceReprocessingPass);}
 saveChunk(chunk:SourceReprocessingChunk){this.store.run('INSERT INTO source_reprocessing_chunks(revision_id,chunk_index,payload) VALUES(?,?,?) ON CONFLICT(revision_id,chunk_index) DO UPDATE SET payload=excluded.payload',chunk.revisionId,chunk.index,JSON.stringify(chunk));}
 savePass(pass:SourceReprocessingPass){this.store.run('INSERT INTO source_reprocessing_passes(revision_id,chunk_index,pass_index,payload) VALUES(?,?,?,?) ON CONFLICT(revision_id,chunk_index,pass_index) DO UPDATE SET payload=excluded.payload',pass.revisionId,pass.chunkIndex,pass.index,JSON.stringify(pass));}
 interruptRunning(revisionId?:string){
  const rows=revisionId===undefined?this.store.all<{payload:string}>('SELECT payload FROM source_reprocessing_passes'):this.store.all<{payload:string}>('SELECT payload FROM source_reprocessing_passes WHERE revision_id=?',revisionId);
  for(const row of rows){const pass=JSON.parse(row.payload) as SourceReprocessingPass;if(pass.status!=='running')continue;pass.status='interrupted';pass.outcomeUncertain=true;pass.finishedAt=new Date().toISOString();pass.error='Application stopped during a request. Provider outcome is unknown; this request must not be repeated automatically.';this.savePass(pass);}
  const chunks=revisionId===undefined?this.store.all<{payload:string}>('SELECT payload FROM source_reprocessing_chunks'):this.store.all<{payload:string}>('SELECT payload FROM source_reprocessing_chunks WHERE revision_id=?',revisionId);
  for(const row of chunks){const chunk=JSON.parse(row.payload) as SourceReprocessingChunk;if(chunk.status==='running'){chunk.status='interrupted';this.saveChunk(chunk);}}
 }
}
