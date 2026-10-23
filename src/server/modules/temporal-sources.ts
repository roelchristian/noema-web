import {createHash} from 'node:crypto';
import type {SourceReference} from '../../shared/domain.js';
import {extractTemporal,temporalExtractorVersion,type TemporalExpression,type TemporalSourceEvidence} from '../../shared/temporal.js';
import {Store} from '../store.js';
import {Vaults} from './vaults.js';
import type {SourcePassage} from './source-passages.js';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export const currentTemporalSources=`FROM temporal_source_mentions m JOIN source_files f ON f.id=m.file_id AND f.entity_id=m.source_id AND f.vault_id=m.vault_id JOIN entities e ON e.id=m.source_id AND e.vault_id=m.vault_id
 JOIN source_passages sp ON sp.file_id=f.id AND sp.generation_id=m.generation_id AND sp.stable_id=m.passage_id AND sp.content_hash=m.passage_hash
 JOIN source_passage_state s ON s.file_id=f.id JOIN temporal_source_state t ON t.file_id=f.id
 WHERE m.vault_id=? AND m.date_id=? AND m.stale=0 AND f.status='ready' AND f.admitted=1 AND e.archived_at IS NULL AND e.inactive=0
 AND s.status='completed' AND s.active_generation_id=m.generation_id AND s.source_hash=m.source_hash AND t.generation_id=m.generation_id AND t.complete=1
 AND NOT EXISTS(SELECT 1 FROM source_passage_dirty d WHERE d.file_id=f.id) AND NOT EXISTS(SELECT 1 FROM temporal_source_dirty d WHERE d.file_id=f.id)`;
type State={generation_id:string;extractor_version:string;cursor:number;complete:number};
type Generation={active_generation_id:string;source_hash:string;context_hash:string;status:string};
export interface TemporalSourceSnapshot {vault:string;fileId:string;sourceId:string;generation:Generation;previous:State|null;passages:{passage:SourcePassage;expressions:TemporalExpression[];cached:boolean}[];hasMore:boolean}
export class TemporalSources {
 constructor(private store:Store) {}
 prepare(vault:string,fileId:string,limit=25):TemporalSourceSnapshot|null {
  new Vaults(this.store).requireOpen(vault);
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid temporal source batch');
  const file=this.store.get<{entity_id:string}>(`SELECT f.entity_id FROM source_files f JOIN entities e ON e.id=f.entity_id AND e.vault_id=f.vault_id WHERE f.id=? AND f.vault_id=? AND f.status='ready' AND f.admitted=1 AND e.archived_at IS NULL AND e.inactive=0`,fileId,vault);
  const generation=this.store.get<Generation>(`SELECT * FROM source_passage_state WHERE file_id=? AND status='completed' AND active_generation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_passage_dirty WHERE file_id=?)`,fileId,fileId);
  if(!file||!generation)return null;
  const previous=this.store.get<State>('SELECT * FROM temporal_source_state WHERE file_id=?',fileId)??null;
  const cursor=previous?.generation_id===generation.active_generation_id&&previous.extractor_version===temporalExtractorVersion?previous.cursor:0;
  const rows=this.store.all<SourcePassage>('SELECT * FROM source_passages WHERE file_id=? AND generation_id=? ORDER BY ordinal LIMIT ? OFFSET ?',fileId,generation.active_generation_id,limit+1,cursor);
  const passages=rows.slice(0,limit).map(passage=>{const cache=this.store.get<{expressions:string}>('SELECT expressions FROM temporal_source_cache WHERE file_id=? AND content_hash=? AND extractor_version=?',fileId,passage.content_hash,temporalExtractorVersion);return {passage,expressions:cache?JSON.parse(cache.expressions) as TemporalExpression[]:extractTemporal(passage.text),cached:!!cache};});
  return {vault,fileId,sourceId:file.entity_id,generation,previous,passages,hasMore:rows.length>limit};
 }
 commit(snapshot:TemporalSourceSnapshot):boolean {
  const {vault,fileId,sourceId,generation,previous}=snapshot;new Vaults(this.store).requireOpen(vault);
  this.store.db.exec('SAVEPOINT temporal_source_refresh');
  try {
   const current=this.store.get<Generation>('SELECT * FROM source_passage_state WHERE file_id=?',fileId),state=this.store.get<State>('SELECT * FROM temporal_source_state WHERE file_id=?',fileId)??null;
   const sameState=(a:State|null,b:State|null)=>a?.generation_id===b?.generation_id&&a?.cursor===b?.cursor&&a?.extractor_version===b?.extractor_version;
   if(!current||current.status!=='completed'||current.active_generation_id!==generation.active_generation_id||current.source_hash!==generation.source_hash||current.context_hash!==generation.context_hash||!sameState(state,previous)||this.store.get('SELECT 1 FROM source_passage_dirty WHERE file_id=?',fileId)||!this.store.get(`SELECT 1 FROM source_files f JOIN entities e ON e.id=f.entity_id AND e.vault_id=f.vault_id WHERE f.id=? AND f.vault_id=? AND f.entity_id=? AND f.status='ready' AND f.admitted=1 AND e.archived_at IS NULL AND e.inactive=0`,fileId,vault,sourceId)) {this.store.db.exec('RELEASE temporal_source_refresh');return false;}
   if(snapshot.passages.some(({passage})=>{const live=this.store.get<SourcePassage>('SELECT * FROM source_passages WHERE file_id=? AND id=? AND generation_id=?',fileId,passage.id,generation.active_generation_id);return !live||live.text!==passage.text||live.content_hash!==passage.content_hash||live.start_offset!==passage.start_offset||live.end_offset!==passage.end_offset;})){this.store.db.exec('RELEASE temporal_source_refresh');return false;}
   const continuing=previous?.generation_id===generation.active_generation_id&&previous.extractor_version===temporalExtractorVersion;
   if(!continuing)this.store.run('UPDATE temporal_source_mentions SET stale=1 WHERE file_id=?',fileId);
   for(const {passage,expressions,cached} of snapshot.passages) {
    if(!cached)this.store.run('INSERT OR REPLACE INTO temporal_source_cache VALUES (?,?,?,?)',fileId,passage.content_hash,temporalExtractorVersion,JSON.stringify(expressions));
    for(const expression of expressions) {
     const start=passage.start_offset+expression.start,end=passage.start_offset+expression.end;
     // Overlap duplicates are the same source span. Prefer a full date over a
     // partial month/year recognized at a chunk edge; never redirect old evidence.
     const overlaps=this.store.all<{id:string;start_offset:number;end_offset:number}>(`SELECT id,start_offset,end_offset FROM temporal_source_mentions WHERE file_id=? AND generation_id=? AND stale=0 AND start_offset<? AND end_offset>?`,fileId,generation.active_generation_id,end,start);
     if(overlaps.some(old=>old.end_offset-old.start_offset>=end-start))continue;
     for(const old of overlaps)this.store.run('UPDATE temporal_source_mentions SET stale=1 WHERE id=?',old.id);
     if(expression.date)this.store.run('INSERT OR IGNORE INTO temporal_dates VALUES (?,?,?,?,?)',vault,expression.date.id,expression.date.value,expression.date.precision,expression.date.calendar);
     const id=hash(JSON.stringify([vault,fileId,generation.active_generation_id,temporalExtractorVersion,start,end]));
     const startLine=passage.start_line+passage.text.slice(0,expression.start).split('\n').length-1,endLine=startLine+expression.text.split('\n').length-1;
     this.store.run(`INSERT OR IGNORE INTO temporal_source_mentions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,id,vault,fileId,sourceId,passage.stable_id||passage.id,generation.active_generation_id,generation.source_hash,passage.content_hash,start,end,startLine,endLine,expression.text,expression.date?.id??null,expression.reason);
    }
   }
   const cursor=(continuing?previous!.cursor:0)+snapshot.passages.length;
   this.store.run('INSERT OR REPLACE INTO temporal_source_state VALUES (?,?,?,?,?,?)',fileId,vault,generation.active_generation_id,temporalExtractorVersion,cursor,snapshot.hasMore?0:1);
   if(!snapshot.hasMore)this.store.run('DELETE FROM temporal_source_dirty WHERE file_id=?',fileId);
   this.store.db.exec('RELEASE temporal_source_refresh');return true;
  }catch(error){this.store.db.exec('ROLLBACK TO temporal_source_refresh; RELEASE temporal_source_refresh');throw error;}
 }
 refresh(vault:string,limit=25) {
  new Vaults(this.store).requireOpen(vault);let processed=0;
  for(const row of this.store.all<{file_id:string}>(`SELECT d.file_id FROM temporal_source_dirty d JOIN source_files f ON f.id=d.file_id LEFT JOIN entities e ON e.id=f.entity_id WHERE d.vault_id=? AND (f.status<>'ready' OR f.admitted<>1 OR f.entity_id IS NULL OR e.archived_at IS NOT NULL OR e.inactive<>0 OR EXISTS(SELECT 1 FROM source_passage_state s WHERE s.file_id=d.file_id AND s.status='completed' AND NOT EXISTS(SELECT 1 FROM source_passage_dirty p WHERE p.file_id=d.file_id))) ORDER BY d.file_id LIMIT 10`,vault)) {
   const file=this.store.get<{entity_id:string|null;admitted:number}>('SELECT entity_id,admitted FROM source_files WHERE id=?',row.file_id);
   if(!file?.entity_id||file.admitted!==1||!this.store.get("SELECT 1 FROM source_files f JOIN entities e ON e.id=f.entity_id WHERE f.id=? AND f.status='ready' AND e.archived_at IS NULL AND e.inactive=0",row.file_id)){this.store.run('DELETE FROM temporal_source_dirty WHERE file_id=?',row.file_id);continue;}
   const snapshot=this.prepare(vault,row.file_id,limit-processed);if(snapshot&&this.commit(snapshot))processed+=snapshot.passages.length;
   if(processed>=limit)break;
  }
  return processed;
 }
 resolve(vault:string,id:string):TemporalSourceEvidence {
  new Vaults(this.store).requireOpen(vault);
  const row=this.store.get<{file_id:string;source_id:string;generation_id:string;passage_id:string;source_hash:string;passage_hash:string;start_offset:number;end_offset:number;start_line:number;end_line:number;original_text:string;date_id:string|null;reason:string|null;stale:number}>('SELECT * FROM temporal_source_mentions WHERE vault_id=? AND id=?',vault,id);
  if(!row||!this.store.get(`SELECT 1 FROM source_files f JOIN entities e ON e.id=f.entity_id AND e.vault_id=f.vault_id WHERE f.id=? AND f.entity_id=? AND f.vault_id=? AND f.admitted=1 AND e.archived_at IS NULL AND e.inactive=0`,row?.file_id??'',row?.source_id??'',vault))return {status:'unavailable',reason:'Source is deleted, archived or inaccessible'};
  const current=this.store.get<SourcePassage>(`SELECT p.* FROM source_passages p JOIN source_files f ON f.id=p.file_id JOIN source_passage_state s ON s.file_id=f.id WHERE p.file_id=? AND p.vault_id=? AND p.stable_id=? AND p.generation_id=? AND p.source_hash=? AND p.content_hash=? AND f.status='ready' AND s.status='completed' AND s.active_generation_id=p.generation_id AND NOT EXISTS(SELECT 1 FROM source_passage_dirty d WHERE d.file_id=f.id)`,row.file_id,vault,row.passage_id,row.generation_id,row.source_hash,row.passage_hash);
  if(row.stale||!current||current.text.slice(row.start_offset-current.start_offset,row.end_offset-current.start_offset)!==row.original_text)return {status:'stale',reason:'Original passage generation or date span has changed'};
  const sourceReference:SourceReference={id,sourceId:row.source_id,fileId:row.file_id,generationId:row.generation_id,passageId:row.passage_id,sourceHash:row.source_hash,startOffset:row.start_offset,endOffset:row.end_offset,startLine:row.start_line,endLine:row.end_line,excerpt:row.original_text,strictTemporal:true};
  return {status:row.date_id?'current':'unresolved',reason:row.reason,sourceReference};
 }
}
