import {randomUUID} from 'node:crypto';
import {embeddingModel,embeddingDimensions,type EmbeddingNote,type SemanticSearchResult} from '../../shared/embeddings.js';
import {makeSearchSnippet} from '../../shared/search-snippets.js';
import {Store} from '../store.js';
import {now} from '../validation.js';
import {CachedVectorSearch} from '../vector-search.js';
import {pageSegmentReference,type PageSegment} from './page-segments.js';

const current=`p.deleted_at IS NULL AND s.revision=p.revision AND NOT EXISTS (SELECT 1 FROM page_index_dirty d WHERE d.page_id=p.id) AND (SELECT body_characters FROM page_index_state WHERE page_id=p.id)>=coalesce((SELECT min_characters FROM embedding_settings WHERE vault_id=p.vault_id),20)`;
export class PageSegmentIndex {
 private vectors=new CachedVectorSearch();
 constructor(private store:Store) {}
 close(){this.vectors.clear();}
 notes(vault:string):EmbeddingNote[] {
  return this.store.all<{id:string;title:string;strategy:EmbeddingNote['strategy'];total:number;indexed:number;failed:number;dirty:number;characters:number;minimum:number;automatic:number;error:string|null}>(`SELECT p.id,p.title,i.strategy,
   count(s.id) AS total,sum(CASE WHEN b.content_hash=s.content_hash THEN 1 ELSE 0 END) AS indexed,
   sum(CASE WHEN b.segment_id IS NULL AND (SELECT j.status FROM embedding_jobs j WHERE j.segment_id=s.id AND j.content_hash=s.content_hash ORDER BY j.rowid DESC LIMIT 1) IN ('failed','interrupted') THEN 1 ELSE 0 END) AS failed,
   EXISTS(SELECT 1 FROM page_index_dirty d WHERE d.page_id=p.id) AS dirty,
   coalesce(i.body_characters,0) AS characters,coalesce(settings.min_characters,20) AS minimum,coalesce(settings.automatic,1) AS automatic,
   (SELECT error FROM page_index_dirty WHERE page_id=p.id) AS error
   FROM pages p LEFT JOIN page_index_state i ON i.page_id=p.id LEFT JOIN page_segments s ON s.page_id=p.id
   LEFT JOIN page_segment_embeddings b ON b.segment_id=s.id AND b.model=? AND b.dimensions=?
   LEFT JOIN embedding_settings settings ON settings.vault_id=p.vault_id WHERE p.vault_id=? AND p.deleted_at IS NULL GROUP BY p.id`,embeddingModel,embeddingDimensions,vault).map(row=>{
    const indexed=row.indexed??0,failed=row.failed??0,pending=Math.max(0,row.total-indexed-failed),eligible=row.total>0&&row.characters>=row.minimum;
    return {pageId:row.id,kind:'page',title:row.title,strategy:row.strategy,totalPassages:row.total,indexedPassages:indexed,failedPassages:failed,pendingPassages:pending,eligible,
     reason:row.error??(row.dirty?'Preparing Page segments.':!eligible?'Page body is too short.':`${indexed} of ${row.total} segments indexed; ${pending} pending; ${failed} failed`),
     indexingStatus:row.error?'failed':row.dirty?'preparing':!eligible?'disabled':indexed===row.total?'ready':indexed>0?'partial':failed>0&&!pending?'failed':!row.automatic?'disabled':'indexing',
     state:!eligible?'ineligible':row.dirty?'stale':indexed===row.total?'indexed':indexed>0?'partial':'missing'};
   });
 }
 enqueue(vault:string,pageId?:string,reason='save',delay=0,force=false) {
  return this.store.transaction(()=>{
   const rows=this.store.all<PageSegment>(`SELECT s.* FROM page_segments s JOIN pages p ON p.id=s.page_id
    LEFT JOIN embedding_settings settings ON settings.vault_id=s.vault_id
    LEFT JOIN page_segment_embeddings b ON b.segment_id=s.id AND b.content_hash=s.content_hash AND b.model=? AND b.dimensions=?
    WHERE s.vault_id=? AND ${current} AND b.segment_id IS NULL ${pageId?'AND s.page_id=?':''}
     AND (SELECT body_characters FROM page_index_state WHERE page_id=p.id)>=coalesce(settings.min_characters,20)
     AND NOT EXISTS(SELECT 1 FROM embedding_jobs j WHERE j.segment_id=s.id AND (j.status IN ('queued','running') ${force?'':"OR (j.content_hash=s.content_hash AND j.model=? AND j.dimensions=? AND j.status IN ('failed','interrupted'))"}))`,embeddingModel,embeddingDimensions,vault,...(pageId?[pageId]:[]),...(force?[]:[embeddingModel,embeddingDimensions]));
   for(const row of rows)this.store.run(`INSERT INTO embedding_jobs(id,vault_id,page_id,segment_id,content_hash,status,reason,created_at,next_attempt_at,model,dimensions) VALUES(?,?,?,?,?,'queued',?,?,?,?,?)`,randomUUID(),vault,row.page_id,row.id,row.content_hash,reason,now(),new Date(Date.now()+delay).toISOString(),embeddingModel,embeddingDimensions);
   return rows.length;
  });
 }
 get(vault:string,id:string) {return this.store.get<PageSegment>(`SELECT s.* FROM page_segments s JOIN pages p ON p.id=s.page_id WHERE s.id=? AND s.vault_id=? AND ${current}`,id,vault);}
 fresh(segment:PageSegment){return !!this.store.get('SELECT 1 FROM page_segment_embeddings WHERE segment_id=? AND content_hash=? AND model=? AND dimensions=?',segment.id,segment.content_hash,embeddingModel,embeddingDimensions);}
 save(segment:PageSegment,vector:number[],tokens:number) {
  const serialized=JSON.stringify(vector);
  this.store.run(`INSERT INTO page_segment_cache VALUES (?,?,?,?,?,?,?) ON CONFLICT(page_id,content_hash,model,dimensions) DO UPDATE SET vector=excluded.vector,tokens=excluded.tokens,updated_at=excluded.updated_at`,segment.page_id,segment.content_hash,embeddingModel,embeddingDimensions,serialized,tokens,now());
  this.store.run(`INSERT INTO page_segment_embeddings VALUES (?,?,?,?,?,?,?) ON CONFLICT(segment_id,model,dimensions) DO UPDATE SET content_hash=excluded.content_hash,vector=excluded.vector,tokens=excluded.tokens,updated_at=excluded.updated_at`,segment.id,embeddingModel,embeddingDimensions,segment.content_hash,serialized,tokens,now());
 }
 hasSearchable(vault:string){return !!this.store.get(`SELECT 1 FROM page_segments s JOIN pages p ON p.id=s.page_id JOIN page_segment_embeddings b ON b.segment_id=s.id AND b.content_hash=s.content_hash WHERE s.vault_id=? AND ${current} AND b.model=? AND b.dimensions=? LIMIT 1`,vault,embeddingModel,embeddingDimensions);}
 search(vault:string,query:string,vector:number[]):SemanticSearchResult[] {
  return this.store.all<PageSegment & {title:string;updated_at:string;vector:string}>(`SELECT s.*,p.title,p.updated_at,b.vector FROM page_segments s JOIN pages p ON p.id=s.page_id JOIN page_segment_embeddings b ON b.segment_id=s.id AND b.content_hash=s.content_hash WHERE s.vault_id=? AND ${current} AND b.model=? AND b.dimensions=?`,vault,embeddingModel,embeddingDimensions).flatMap(row=>{
   const score=this.vectors.score(`page-segment:${row.id}`,row.vector,vector,embeddingDimensions);
   return score===undefined?[]:[{id:row.page_id,kind:'page' as const,passageId:row.id,title:row.title,snippet:makeSearchSnippet(row.text,query),score,updated_at:row.updated_at,pageReference:pageSegmentReference(row)}];
  });
 }
}
