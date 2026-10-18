import {createHash,randomUUID} from 'node:crypto';
import type {SourceFile,SourceReference,SourceStructureNode} from '../../shared/domain.js';
import {sourcePageRange,sourceTextLines} from '../../shared/source-text.js';
import {Store} from '../store.js';
import {passageTokenCount} from '../passage-tokenizer.js';
import {mergeSourceStructure} from './source-structure.js';

const CHUNK_VERSION=2;
// Tokenizer-free sizing: three UTF-8 bytes per estimated token. This deliberately
// budgets less text than the common English four-byte estimate; token_count is
// an estimate, not an API token guarantee. The byte cap also bounds unusual text.
const ESTIMATED_BYTES_PER_TOKEN=3, TARGET_TOKENS=700, OVERLAP_TOKENS=80, MAX_PASSAGE_BYTES=6500;
const TARGET_BYTES=Math.min(MAX_PASSAGE_BYTES,TARGET_TOKENS*ESTIMATED_BYTES_PER_TOKEN);
const OVERLAP_BYTES=OVERLAP_TOKENS*ESTIMATED_BYTES_PER_TOKEN;
export interface SourcePassage {
  id:string;file_id:string;source_id:string;vault_id:string;ordinal:number;heading:string|null;text:string;
  start_line:number;end_line:number;start_offset:number;end_offset:number;source_hash:string;content_hash:string;
  start_page:number|null;end_page:number|null;token_count:number;
  generation_id:string;stable_id:string;estimated_token_count:number;actual_token_count:number|null;stale?:number;
}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Bound repeated heading context independently; the full heading remains in passage text. */
function headingContext(text:string):string {
  let end=0,bytes=0;
  for(const point of text) {
    const size=Buffer.byteLength(point,'utf8');
    if(bytes+size>1000)break;
    bytes+=size;end+=point.length;
  }
  return text.slice(0,end);
}
export function passageReference(row:SourcePassage):SourceReference {
  return {id:row.id,sourceId:row.source_id,fileId:row.file_id,startLine:row.start_line,endLine:row.end_line,
    sourceHash:row.source_hash,excerpt:row.text,startOffset:row.start_offset,endOffset:row.end_offset,
    generationId:row.generation_id,passageId:row.stable_id||row.id,stale:!!row.stale,
    ...(row.start_page===null?{}:{startPage:row.start_page}),...(row.end_page===null?{}:{endPage:row.end_page})};
}

/** UTF-16 offsets address canonical sourceTextLines().join('\n'), as in the source viewer.
 * Byte budgets avoid overflowing the embedding API for Unicode-heavy documents. */
function chunkSource(file:SourceFile,generationId:string,countTokens?:PassageTokenizer):SourcePassage[] {
  const lines=sourceTextLines(file.text),text=lines.join('\n'),sourceHash=hash(file.text),contentEnd=text.trimEnd().length;
  const lineStarts:number[]=[],headings:{offset:number;text:string}[]=[];
  let offset=0;
  for(const line of lines) {
    lineStarts.push(offset);
    offset+=line.length+1;
  }
  // Extraction owns structure; Markdown syntax remains a compatibility fallback.
  let explicit:SourceStructureNode[]=[];
  try {const parsed:unknown=JSON.parse(file.structural_nodes??'[]');if(Array.isArray(parsed))explicit=parsed;}catch{/* Legacy imports have no structural metadata. */}
  const nodes=mergeSourceStructure(file.text,explicit);
  for(const node of nodes)if(node&&typeof node.text==='string'&&Number.isSafeInteger(node.startLine)&&node.startLine>=1&&node.startLine<=lineStarts.length) {
    const nodeOffset=lineStarts[node.startLine-1]!;
    const existing=headings.find(heading=>heading.offset===nodeOffset);
    if(existing)existing.text=headingContext(node.text);
    else headings.push({offset:nodeOffset,text:headingContext(node.text)});
  }
  headings.sort((a,b)=>a.offset-b.offset);
  const lineAt=(position:number)=>{
    let lo=0,hi=lineStarts.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(lineStarts[mid]!<=position)lo=mid+1;else hi=mid;}
    return Math.max(1,lo);
  };
  let pageStarts:number[]=[];
  try {const parsed:unknown=JSON.parse(file.page_start_lines??'[]');if(Array.isArray(parsed))pageStarts=parsed.filter((n):n is number=>Number.isSafeInteger(n)&&n>0);}catch{/* Older imports can lack page metadata. */}
  if(file.format==='pdf'&&!pageStarts.length&&file.pages===1)pageStarts=[1];
  const passages:SourcePassage[]=[],occurrences=new Map<string,number>();let start=0,headingIndex=-1;
  while(start<contentEnd) {
    while(start<contentEnd&&/\s/u.test(text[start]!))start++;
    if(start>=contentEnd)break;
    while(headingIndex+1<headings.length&&headings[headingIndex+1]!.offset<=start)headingIndex++;
    const sectionEnd=Math.min(contentEnd,headings[headingIndex+1]?.offset??contentEnd);
    let end=start,bytes=0;
    while(end<sectionEnd) {
      const point=text.codePointAt(end)!,size=Buffer.byteLength(String.fromCodePoint(point),'utf8');
      if(bytes+size>TARGET_BYTES)break;
      bytes+=size;end+=point>0xffff?2:1;
    }
    if(end<sectionEnd) {
      const candidate=text.slice(start,end);
      // Sections never share a chunk; within a section prefer paragraph boundaries.
      let boundary=0;
      for(const match of candidate.matchAll(/\n[\t ]*\n/g))
        if(Buffer.byteLength(candidate.slice(0,match.index),'utf8')>=TARGET_BYTES/2)boundary=match.index+1;
      if(boundary)end=start+boundary;
      else {
        const lastWhitespace=candidate.search(/\s+\S*$/u);
        if(lastWhitespace>candidate.length/2)end=start+lastWhitespace;
      }
    }
    const reachedSectionEnd=end===sectionEnd;
    // Trim only edge whitespace; all substantive characters remain in at least one passage.
    while(end>start&&/\s/u.test(text[end-1]!))end--;
    if(end<=start)break;
    const heading=headings[headingIndex]?.text??null,body=text.slice(start,end);
    const startLine=lineAt(start),endLine=lineAt(end-1);
    const pageRange=file.format==='pdf'?sourcePageRange(pageStarts,startLine,endLine):undefined;
    const contentHash=hash(`1\n${heading??''}\n${body}`),ordinal=passages.length;
    const occurrence=occurrences.get(contentHash)??0;occurrences.set(contentHash,occurrence+1);
    // Repeated content is disambiguated independently of preceding unrelated chunks.
    const id=hash(`${file.id}\n${contentHash}\n${occurrence}`);
    const estimate=Math.ceil(Buffer.byteLength(body,'utf8')/ESTIMATED_BYTES_PER_TOKEN);
    const actual=countTokens?countTokens(body):null;
    if(actual!==null&&(!Number.isSafeInteger(actual)||actual<0))throw new Error('Tokenizer returned an invalid passage count.');
    passages.push({id,file_id:file.id,source_id:file.entity_id!,vault_id:file.vault_id,ordinal,heading,text:body,
      start_line:startLine,end_line:endLine,start_offset:start,end_offset:end,source_hash:sourceHash,content_hash:contentHash,
      start_page:pageRange?.startPage??null,end_page:pageRange?.endPage??null,
      generation_id:generationId,stable_id:id,estimated_token_count:estimate,actual_token_count:actual,
      token_count:estimate});
    if(reachedSectionEnd) {start=sectionEnd;continue;}
    let next=end,overlapBytes=0;
    while(next>start) {
      let previous=next-1;
      if(previous>0&&text.charCodeAt(previous)>=0xdc00&&text.charCodeAt(previous)<=0xdfff)previous--;
      const size=Buffer.byteLength(text.slice(previous,next),'utf8');
      if(overlapBytes+size>OVERLAP_BYTES)break;
      overlapBytes+=size;next=previous;
    }
    // Prefer a word boundary, stepping by complete code points. For a long
    // unbroken word retain the byte-bounded overlap instead of dropping it.
    const overlapStart=next;
    while(next<end&&next>0&&!/\s/u.test(text[next-1]!))next+=text.codePointAt(next)!>0xffff?2:1;
    if(next>=end)next=overlapStart;
    start=next>start?next:end;
  }
  return passages;
}

/** Allow a model-specific tokenizer override for alternate embedding backends.
 * Legacy token_count remains the byte estimate; it is never presented as an exact count. */
export type PassageTokenizer=(text:string)=>number;
export class SourcePassages {
  constructor(private readonly store:Store,private readonly countTokens:PassageTokenizer=passageTokenCount) {}
  /** Search callers can drain only their vault; no source text is loaded unless dirty. */
  synchronize(vault?:string):void {
    for(const row of this.store.all<{file_id:string}>(`SELECT d.file_id FROM source_passage_dirty d
      JOIN vaults v ON v.id=d.vault_id WHERE v.locked=0 ${vault?'AND d.vault_id=?':''} ORDER BY d.queued_at,d.file_id`,...(vault?[vault]:[])))this.process(row.file_id);
  }
  /** One file per background tick; replacement and queue acknowledgement commit together. */
  tick():void {
    const row=this.store.get<{file_id:string}>(`SELECT d.file_id FROM source_passage_dirty d
      JOIN vaults v ON v.id=d.vault_id WHERE v.locked=0 ORDER BY d.queued_at,d.file_id LIMIT 1`);
    if(row)this.process(row.file_id);
  }
  private process(fileId:string):void {
    const file=this.store.get<SourceFile>(`SELECT f.* FROM source_files f JOIN vaults v ON v.id=f.vault_id WHERE f.id=? AND v.locked=0`,fileId);
    if(!file)return;
    const updatedAt=new Date().toISOString();
    try {
      if(!file.admitted||!file.entity_id) {
        this.store.transaction(()=>{
          this.store.run('DELETE FROM source_passages WHERE file_id=?',fileId);
          this.store.run(`INSERT INTO source_passage_state(file_id,status,updated_at) VALUES (?,'disabled',?)
            ON CONFLICT(file_id) DO UPDATE SET status='disabled',active_generation_id=NULL,error=NULL,updated_at=excluded.updated_at`,fileId,updatedAt);
          this.store.run('DELETE FROM source_passage_dirty WHERE file_id=?',fileId);
        });return;
      }
      if(file.status!=='ready') {
        // An extraction retry or failure does not retire the last usable generation.
        this.store.run(`INSERT INTO source_passage_state(file_id,status,error,updated_at) VALUES (?,?,?,?)
          ON CONFLICT(file_id) DO UPDATE SET status=excluded.status,error=excluded.error,updated_at=excluded.updated_at`,
          fileId,file.status==='failed'?'failed':'preparing',file.error,updatedAt);
        this.store.run('DELETE FROM source_passage_dirty WHERE file_id=?',fileId);return;
      }
      const sourceHash=hash(file.text),contextHash=hash(JSON.stringify([file.entity_id,file.vault_id,file.format,file.pages,file.page_start_lines,file.structural_nodes]));
      const state=this.store.get<{source_hash:string;context_hash:string;chunk_version:number;status:string;active_generation_id:string|null}>('SELECT * FROM source_passage_state WHERE file_id=?',fileId);
      if(state?.active_generation_id&&state.source_hash===sourceHash&&state.context_hash===contextHash&&state.chunk_version===CHUNK_VERSION) {
        this.store.run("UPDATE source_passage_state SET status='completed',error=NULL WHERE file_id=?",fileId);
        this.store.run('DELETE FROM source_passage_dirty WHERE file_id=?',fileId);return;
      }
      const generationId=randomUUID();
      // Construction and validation finish before touching the active passage set.
      const passages=chunkSource(file,generationId,this.countTokens);
      const previous=this.store.all<SourcePassage>('SELECT * FROM source_passages WHERE file_id=? ORDER BY ordinal',fileId);
      const identities=new Map<string,SourcePassage[]>();
      for(const row of previous) {
        const key=JSON.stringify([row.heading,row.text]);
        const matches=identities.get(key)??[];matches.push(row);identities.set(key,matches);
      }
      for(const passage of passages) {
        const preserved=identities.get(JSON.stringify([passage.heading,passage.text]))?.shift();
        if(preserved){passage.id=preserved.id;passage.stable_id=preserved.stable_id||preserved.id;}
      }
      const canonical=sourceTextLines(file.text).join('\n'),ids=new Set<string>();
      if(canonical.trim()&&!passages.length)throw new Error('Segmentation produced no passages for nonempty source text.');
      for(const p of passages) {
        if(ids.has(p.id)||p.ordinal!==ids.size||p.start_offset<0||p.end_offset<=p.start_offset||canonical.slice(p.start_offset,p.end_offset)!==p.text||Buffer.byteLength(p.text,'utf8')>MAX_PASSAGE_BYTES)
          throw new Error('Replacement passage generation failed validation.');
        ids.add(p.id);
      }
      this.store.transaction(()=>{
        // Recheck the extraction snapshot before publishing a replacement.
        const current=this.store.get<SourceFile>('SELECT * FROM source_files WHERE id=?',fileId);
        if(!current||current.status!=='ready'||current.admitted!==1||current.text!==file.text||
          JSON.stringify([current.entity_id,current.vault_id,current.format,current.pages,current.page_start_lines,current.structural_nodes])!==JSON.stringify([file.entity_id,file.vault_id,file.format,file.pages,file.page_start_lines,file.structural_nodes]))return;
        // Preserve the pre-migration generation too. Subsequent generations were
        // already recorded when they were published.
        if(previous.length) {
          const oldId=previous[0]!.generation_id==='legacy'?`legacy:${fileId}`:previous[0]!.generation_id;
          this.store.run(`INSERT OR IGNORE INTO source_passage_generations(id,file_id,source_hash,context_hash,chunk_version,passage_count,passages,created_at) VALUES (?,?,?,?,?,?,?,?)`,
            oldId,fileId,previous[0]!.source_hash,state?.context_hash??'',state?.chunk_version??1,previous.length,JSON.stringify(previous),updatedAt);
        }
        this.store.run(`INSERT INTO source_passage_generations(id,file_id,source_hash,context_hash,chunk_version,passage_count,passages,created_at) VALUES (?,?,?,?,?,?,?,?)`,
          generationId,fileId,sourceHash,contextHash,CHUNK_VERSION,passages.length,JSON.stringify(passages),updatedAt);
        // Active rows are a projection of the selected generation. Cache vectors
        // survive replacement; unchanged passages recover them in this transaction.
        this.store.run(`INSERT OR IGNORE INTO source_passage_embedding_cache(vault_id,source_id,content_hash,model,dimensions,vector,tokens,updated_at)
          SELECT p.vault_id,p.source_id,b.content_hash,b.model,b.dimensions,b.vector,b.tokens,b.updated_at
          FROM source_passages p JOIN source_passage_embeddings b ON b.passage_id=p.id WHERE p.file_id=?`,fileId);
        this.store.run(`UPDATE source_passage_embedding_jobs SET status='skipped',finished_at=?,error='Passage generation superseded.' WHERE file_id=? AND status IN ('queued','running')`,updatedAt,fileId);
        this.store.run('DELETE FROM source_passages WHERE file_id=?',fileId);
        const insert=this.store.db.prepare(`INSERT INTO source_passages
          (id,file_id,source_id,vault_id,ordinal,heading,text,start_line,end_line,start_offset,end_offset,source_hash,content_hash,start_page,end_page,token_count,generation_id,stable_id,estimated_token_count,actual_token_count)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        for(const p of passages)insert.run(p.id,p.file_id,p.source_id,p.vault_id,p.ordinal,p.heading,p.text,p.start_line,p.end_line,p.start_offset,p.end_offset,p.source_hash,p.content_hash,p.start_page,p.end_page,p.token_count,p.generation_id,p.stable_id,p.estimated_token_count,p.actual_token_count);
        this.store.run(`INSERT OR IGNORE INTO source_passage_embeddings(passage_id,model,dimensions,content_hash,vector,tokens,updated_at)
          SELECT p.id,c.model,c.dimensions,p.content_hash,c.vector,c.tokens,c.updated_at FROM source_passages p
          JOIN source_passage_embedding_cache c ON c.vault_id=p.vault_id AND c.source_id=p.source_id AND c.content_hash=p.content_hash WHERE p.file_id=?`,fileId);
        this.store.run(`INSERT INTO source_passage_state(file_id,source_hash,context_hash,chunk_version,status,error,updated_at,active_generation_id) VALUES (?,?,?,?,'completed',NULL,?,?)
          ON CONFLICT(file_id) DO UPDATE SET source_hash=excluded.source_hash,context_hash=excluded.context_hash,chunk_version=excluded.chunk_version,status='completed',error=NULL,updated_at=excluded.updated_at,active_generation_id=excluded.active_generation_id`,
          fileId,sourceHash,contextHash,CHUNK_VERSION,updatedAt,generationId);
        this.store.run('DELETE FROM source_passage_dirty WHERE file_id=?',fileId);
      });
    } catch(error) {
      // Rollback leaves both the previous projection and its vectors intact.
      this.store.run(`INSERT INTO source_passage_state(file_id,status,error,updated_at) VALUES (?,'failed',?,?)
        ON CONFLICT(file_id) DO UPDATE SET status='failed',error=excluded.error,updated_at=excluded.updated_at`,fileId,error instanceof Error?error.message:String(error),updatedAt);
    }
  }
}
