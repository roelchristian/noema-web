import {createHash} from 'node:crypto';
import type {SourceFile,SourceReference} from '../../shared/domain.js';
import {sourcePageRange,sourceTextLines} from '../../shared/source-text.js';
import {Store} from '../store.js';

const CHUNK_VERSION=1;
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
    ...(row.start_page===null?{}:{startPage:row.start_page}),...(row.end_page===null?{}:{endPage:row.end_page})};
}

/** UTF-16 offsets address canonical sourceTextLines().join('\n'), as in the source viewer.
 * Byte budgets avoid overflowing the embedding API for Unicode-heavy documents. */
function chunkSource(file:SourceFile):SourcePassage[] {
  const lines=sourceTextLines(file.text),text=lines.join('\n'),sourceHash=hash(file.text),contentEnd=text.trimEnd().length;
  const lineStarts:number[]=[],headings:{offset:number;text:string}[]=[];
  let offset=0;
  for(const line of lines) {
    lineStarts.push(offset);
    const heading=/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if(heading)headings.push({offset,text:headingContext(heading[1]!)});
    offset+=line.length+1;
  }
  const lineAt=(position:number)=>{
    let lo=0,hi=lineStarts.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(lineStarts[mid]!<=position)lo=mid+1;else hi=mid;}
    return Math.max(1,lo);
  };
  let pageStarts:number[]=[];
  try {const parsed:unknown=JSON.parse(file.page_start_lines??'[]');if(Array.isArray(parsed))pageStarts=parsed.filter((n):n is number=>Number.isSafeInteger(n)&&n>0);}catch{/* Older imports can lack page metadata. */}
  if(file.format==='pdf'&&!pageStarts.length&&file.pages===1)pageStarts=[1];
  const passages:SourcePassage[]=[];let start=0,headingIndex=-1;
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
    const contentHash=hash(`${CHUNK_VERSION}\n${heading??''}\n${body}`),ordinal=passages.length;
    // An ordinal disambiguates repeated paragraphs without tying identity to source metadata.
    const id=hash(`${file.id}\n${ordinal}\n${contentHash}`);
    passages.push({id,file_id:file.id,source_id:file.entity_id!,vault_id:file.vault_id,ordinal,heading,text:body,
      start_line:startLine,end_line:endLine,start_offset:start,end_offset:end,source_hash:sourceHash,content_hash:contentHash,
      start_page:pageRange?.startPage??null,end_page:pageRange?.endPage??null,
      token_count:Math.ceil(Buffer.byteLength(body,'utf8')/ESTIMATED_BYTES_PER_TOKEN)});
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

export class SourcePassages {
  constructor(private readonly store:Store) {}
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
    try {
      this.store.transaction(()=>{
        const file=this.store.get<SourceFile>(`SELECT f.* FROM source_files f JOIN vaults v ON v.id=f.vault_id WHERE f.id=? AND v.locked=0`,fileId);
        if(!file)return;
        if(file.status!=='ready'||!file.admitted||!file.entity_id) {
          this.store.run('DELETE FROM source_passages WHERE file_id=?',fileId);
          this.store.run('DELETE FROM source_passage_state WHERE file_id=?',fileId);
          this.store.run('DELETE FROM source_passage_dirty WHERE file_id=?',fileId);return;
        }
        const sourceHash=hash(file.text),contextHash=hash(JSON.stringify([file.entity_id,file.vault_id,file.format,file.pages,file.page_start_lines]));
        const state=this.store.get<{source_hash:string;context_hash:string;chunk_version:number;status:string}>('SELECT * FROM source_passage_state WHERE file_id=?',fileId);
        if(state?.status==='completed'&&state.source_hash===sourceHash&&state.context_hash===contextHash&&state.chunk_version===CHUNK_VERSION) {
          this.store.run('DELETE FROM source_passage_dirty WHERE file_id=?',fileId);return;
        }
        const passages=chunkSource(file);
        this.store.run('DELETE FROM source_passages WHERE file_id=?',fileId);
        const insert=this.store.db.prepare(`INSERT INTO source_passages
          (id,file_id,source_id,vault_id,ordinal,heading,text,start_line,end_line,start_offset,end_offset,source_hash,content_hash,start_page,end_page,token_count)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        for(const p of passages)insert.run(p.id,p.file_id,p.source_id,p.vault_id,p.ordinal,p.heading,p.text,p.start_line,p.end_line,p.start_offset,p.end_offset,p.source_hash,p.content_hash,p.start_page,p.end_page,p.token_count);
        this.store.run(`INSERT INTO source_passage_state(file_id,source_hash,context_hash,chunk_version,status,error,updated_at) VALUES (?,?,?,?,'completed',NULL,?)
          ON CONFLICT(file_id) DO UPDATE SET source_hash=excluded.source_hash,context_hash=excluded.context_hash,chunk_version=excluded.chunk_version,status='completed',error=NULL,updated_at=excluded.updated_at`,
          fileId,sourceHash,contextHash,CHUNK_VERSION,new Date().toISOString());
        this.store.run('DELETE FROM source_passage_dirty WHERE file_id=?',fileId);
      });
    } catch(error) {
      // Keep the durable queue item for recovery; record failures without losing prior state.
      this.store.run(`INSERT INTO source_passage_state(file_id,status,error,updated_at) VALUES (?,'failed',?,?)
        ON CONFLICT(file_id) DO UPDATE SET status='failed',error=excluded.error,updated_at=excluded.updated_at`,fileId,error instanceof Error?error.message:String(error),new Date().toISOString());
    }
  }
}
