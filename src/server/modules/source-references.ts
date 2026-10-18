import {createHash, randomUUID} from 'node:crypto';
import type {Block, Segment, SourceFile} from '../../shared/domain.js';
import {sourceTextLines} from '../../shared/source-text.js';
import {Store} from '../store.js';

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
      result.push({...segment,text:match[0],sourceReference:{sourceNumber:1,id:randomUUID(),sourceId:file.entity_id,fileId:file.id,startLine,endLine,sourceHash,excerpt:lines.slice(startLine-1,endLine).join('\n')}});
      offset=match.index+match[0].length;
    }
    if(!offset)return [segment];
    if(offset<segment.text!.length)result.push({...segment,text:segment.text!.slice(offset)});
    return result;
  });
  return blocks.map(block=>({...block,content:convert(block.content),...(block.rows?{rows:block.rows.map(row=>row.map(convert))}:{})}));
}

/** Reconcile locations on every save; deleted tags disappear and moved tags retain identity. */
export function syncSourceReferences(store:Store,pageId:string,blocks:Block[]) {
  store.run('DELETE FROM note_source_references WHERE page_id=?',pageId);
  const used=new Set<string>();
  const numbers=new Map(store.all<{file_id:string;number:number}>('SELECT file_id,number FROM note_source_files WHERE page_id=?',pageId).map(row=>[row.file_id,row.number]));
  const allocated=new Set(numbers.values());
  let nextNumber=Math.max(0,...allocated)+1;

  const record=(block:Block,content:Segment[],row:number=-1,col:number=-1)=>{
    // UTF-16 offsets in stored note text (citation marker text, not its display label).
    let offset=0;
    for(const segment of content) {
      const length=segment.text?.length??segment.mentionText?.length??(segment.entityId?store.get<{name:string}>("SELECT CASE WHEN mention_case='lowercase' THEN lower(name) ELSE name END AS name FROM entities WHERE id=?",segment.entityId)?.name.length??0:0);
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
}
