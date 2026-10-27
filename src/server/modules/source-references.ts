import {resolveSourceDocument} from './source-ingestion-document.js';
import {sourceDocumentEntries,sourceNodeLabel,sourceReferenceLocator} from '../../shared/source-document.js';
import {mathSource,sourceTextHash} from './source-math-text.js';
import {createHash, randomUUID} from 'node:crypto';
import type {Block, Segment, SourceFile} from '../../shared/domain.js';
import {sourcePageRange,sourceTextLines} from '../../shared/source-text.js';
import {Store} from '../store.js';
import {entityMentionName} from '../../shared/domain.js';

/** Only interpret legacy markers when the generating source is known. */
export function linkSourceReferences(blocks:Block[], file:SourceFile):Block[] {
  const lines=sourceTextLines(file.text), sourceHash=createHash('sha256').update(file.text).digest('hex');
  const convert=(content:Segment[]):Segment[]=>content.flatMap(segment=>{
    if(segment.text===undefined||segment.math||segment.code||segment.sourceReference)return [segment];
    const result:Segment[]=[];let offset=0;
    for(const match of (segment.text??'').matchAll(/\[L:\s*(\d+)(?:\s*-\s*(\d+))?\]/g)) {
      const startLine=Number(match[1]),endLine=Number(match[2]??match[1]);
      if(!file.entity_id||startLine<1||endLine<startLine||endLine>lines.length||endLine-startLine>=30)continue;
      if(match.index>offset)result.push({...segment,text:segment.text!.slice(offset,match.index)});
      result.push({...segment,text:match[0],sourceReference:{sourceNumber:1,id:randomUUID(),sourceId:file.entity_id,fileId:file.id,startLine,endLine,sourceHash,...referencePages(file,startLine,endLine),excerpt:lines.slice(startLine-1,endLine).join('\n')}});
      offset=match.index+match[0].length;
    }
    if(!offset)return [segment];
    if(offset<segment.text!.length)result.push({...segment,text:segment.text!.slice(offset)});
    return result;
  });
  return blocks.map(block=>({...block,content:convert(block.content),...(block.rows?{rows:block.rows.map(row=>row.map(convert))}:{})}));
}

/** Reconcile locations on every save; deleted tags disappear and moved tags retain identity. */
export function syncSourceReferences(store:Store,pageId:string,blocks:Block[],resolveName?: (id:string)=>string|undefined) {
  const names=new Map<string,string|undefined>();
  const name=(id:string)=>{
    if(!names.has(id))names.set(id,resolveName?resolveName(id):entityMentionName(store.get<{name:string;mentionCase:'canonical'|'lowercase'}>("SELECT e.name,e.mention_case AS mentionCase FROM entities e JOIN pages p ON p.vault_id=e.vault_id WHERE p.id=? AND e.id=?",pageId,id)));
    return names.get(id);
  };
  enrichCitationPages(store,blocks);
  store.run('DELETE FROM note_source_references WHERE page_id=?',pageId);
  const used=new Set<string>();
  const numbers=new Map(store.all<{file_id:string;number:number}>('SELECT file_id,number FROM note_source_files WHERE page_id=?',pageId).map(row=>[row.file_id,row.number]));
  const allocated=new Set(numbers.values());
  let nextNumber=Math.max(0,...allocated)+1;

  const record=(block:Block,content:Segment[],row:number=-1,col:number=-1)=>{
    // UTF-16 offsets in stored note text (citation marker text, not its display label).
    let offset=0;
    for(const segment of content) {
      const length=segment.text?.length??segment.mentionText?.length??(segment.entityId?name(segment.entityId)?.length??0:0);
      const ref=segment.sourceReference;
      if(ref) {
        let sourceNumber=numbers.get(ref.fileId);
        if(sourceNumber===undefined) {
          // Preserve surviving source numbers when restoring or copying a note.
          const preferred=ref.sourceNumber;
          sourceNumber=typeof preferred==='number'&&Number.isSafeInteger(preferred)&&preferred>0&&preferred<=1_000_000_000&&!allocated.has(preferred)?preferred:nextNumber;
          allocated.add(sourceNumber);nextNumber=Math.max(nextNumber,sourceNumber+1);numbers.set(ref.fileId,sourceNumber);
          store.run('INSERT INTO note_source_files (page_id,file_id,number) VALUES (?,?,?)',pageId,ref.fileId,sourceNumber);
        }
        ref.sourceNumber=sourceNumber;
        if(used.has(ref.id))ref.id=randomUUID();
        used.add(ref.id);
        store.run(`INSERT INTO note_source_references (id,page_id,source_id,file_id,block_id,row_index,col_index,start_offset,end_offset,start_line,end_line,source_hash,excerpt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,ref.id,pageId,ref.sourceId,ref.fileId,block.id,row,col,offset,offset+length,ref.startLine,ref.endLine,ref.sourceHash,ref.excerpt);
      }
      offset+=length;
    }
  };
  for(const block of blocks){record(block,block.content);block.rows?.forEach((row,r)=>row.forEach((cell,c)=>record(block,cell,r,c)));}
  // A file stays linked while any anchor cites it; removing the last one removes the link.
  store.run(`DELETE FROM note_source_files WHERE page_id=? AND NOT EXISTS (
    SELECT 1 FROM note_source_references WHERE page_id=note_source_files.page_id AND file_id=note_source_files.file_id
  )`,pageId);
}

function referencePages(file:SourceFile,startLine:number,endLine:number) {
  if(file.format!=='pdf')return;
  const starts=JSON.parse(file.page_start_lines??'[]') as number[];
  return sourcePageRange(starts.length?starts:file.pages===1?[1]:[],startLine,endLine);
}
/** Enrich older citations only against the exact source version they cite. */
export function enrichCitationPages(store:Store,blocks:Block[]) {
  const documents=new Map<string,ReturnType<typeof sourceDocumentEntries>>();
  const files=new Map<string,SourceFile|undefined>(),hashes=new Map<string,string>(),cleanedHashes=new Map<string,string>();
  for(const block of blocks)for(const segment of [block.content,...(block.rows??[]).flat() ].flat()) {
    const ref=segment.sourceReference;if(!ref)continue;
    if(!files.has(ref.fileId))files.set(ref.fileId,store.get<SourceFile>('SELECT * FROM source_files WHERE id=? AND entity_id=?',ref.fileId,ref.sourceId));
    const file=files.get(ref.fileId);if(!file){ref.stale=true;continue;}
    if(!hashes.has(file.id))hashes.set(file.id,createHash('sha256').update(file.text).digest('hex'));
    if(!cleanedHashes.has(file.id))cleanedHashes.set(file.id,sourceTextHash(mathSource(store,file).text));
    const matches=hashes.get(file.id)===ref.sourceHash||cleanedHashes.get(file.id)===ref.sourceHash;
    ref.stale=file.status!=='ready'||!file.admitted||!matches;
    if(matches&&!(ref.userLocator&&ref.startOffset===undefined)){
      Object.assign(ref,referencePages(file,ref.startLine,ref.endLine));
      const key=file.id+':'+ref.sourceHash;
      if(!documents.has(key))documents.set(key,sourceDocumentEntries(resolveSourceDocument(store,hashes.get(file.id)===ref.sourceHash?file:mathSource(store,file))));
      const entries=documents.get(key)!;
      const entry=ref.nodeId?entries.find(entry=>entry.node.id===ref.nodeId):entries.filter(({node})=>
        ref.startOffset!==undefined?node.range.startOffset<=ref.startOffset&&node.range.endOffset>(ref.startOffset):node.range.startLine<=ref.startLine&&node.range.endLine>=ref.startLine
      ).sort((a,b)=>(a.node.range.endOffset-a.node.range.startOffset)-(b.node.range.endOffset-b.node.range.startOffset))[0];
      if(entry){ref.contextLabel=sourceNodeLabel(entry.path);ref.appLocator=sourceReferenceLocator(entries,ref);}
    }
  }
  return blocks;
}
