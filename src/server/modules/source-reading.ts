import {createReadingAnchor,resolveReadingAnchor,type ReadingAnchor,type ReadingLocation,type ReadingContinuity} from '../../shared/reading-continuity.js';
import {explanationPrompt} from './explanation-prompt.js';
import type {PageGenerationMetadata} from '../../shared/page-generation.js';
import {projectPageText} from '../../shared/page-text.js';
import {randomUUID} from 'node:crypto';
import {entityMentionName,type Block,type Page,type SourceFile,type SourceReference} from '../../shared/domain.js';
import {highlightColors,readingNoteMaxWords,readingNoteWordCount,readingExplanationFamiliarities,type ReadingExplanationOptions,type SourceHighlight,type ReadingNoteAnchor} from '../../shared/source-reading.js';
import {sourcePageLanguages} from '../../shared/source-page.js';
import {pageLanguage} from './page-language.js';
import {Store} from '../store.js';
import {HttpError,now,required,text} from '../validation.js';
import {mathSource,sourceTextHash} from './source-math-text.js';
import {processedSourceDocument} from './source-document.js';
import {sourceDocumentEntries,sourceReferenceLocator,sourceNodeLabel} from '../../shared/source-document.js';
import {sourcePageRange} from '../../shared/source-text.js';
import {PageEnrichmentState} from './page-enrichment-state.js';
import {Pages} from './pages.js';
import {Knowledge} from './knowledge.js';
import {syncReadingNotesCollection} from './reading-notes-collection.js';

type HighlightRow={id:string;source_id:string;file_id:string;source_hash:string;start_offset:number;end_offset:number;excerpt:string;color:SourceHighlight['color'];reference_json:string;created_at:string};
function readingNoteRequestId(value:unknown) {
 const id=required(value,36);
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw new HttpError(400,'Invalid reading note request.');
 return id;
}
export class SourceReading {
 constructor(private store:Store) {}
 private file(vault:string,fileId:string) {
  const file=this.store.get<SourceFile>(`SELECT f.* FROM source_files f JOIN entities e ON e.id=f.entity_id AND e.vault_id=f.vault_id WHERE f.id=? AND f.vault_id=? AND e.type='source'`,fileId,vault);
  if(!file)throw new HttpError(404,'Source file not found in this vault');
  return file;
 }
 continuity(vault:string,fileId:string):ReadingContinuity {
  const file=mathSource(this.store,this.file(vault,fileId)),revision=sourceTextHash(file.text);
  const locations=this.store.all<{id:string;label:string;anchor_json:string}>('SELECT id,label,anchor_json FROM source_reading_locations WHERE vault_id=? AND file_id=? ORDER BY rowid',vault,fileId).map(row=>{
   const anchor=JSON.parse(row.anchor_json) as ReadingAnchor;
   return {id:row.id,label:row.label,anchor,resolution:resolveReadingAnchor(anchor,file.text,revision)} satisfies ReadingLocation;
  });
  return {resume:locations.find(item=>item.id==='resume')??null,bookmarks:locations.filter(item=>item.id!=='resume')};
 }
 saveLocation(vault:string,fileId:string,id:string,body:Record<string,unknown>) {
  const raw=this.file(vault,fileId),file=mathSource(this.store,raw),revision=sourceTextHash(file.text);
  if(file.status!=='ready'||file.admitted!==1||body.revision!==revision)throw new HttpError(409,'This source changed. Reopen it before saving a reading location.');
  if(!Number.isSafeInteger(body.offset)||(body.offset as number)<0||(body.offset as number)>file.text.length)throw new HttpError(400,'Invalid reading offset.');
  if(id!=='resume'&&!/^[a-f0-9-]{36}$/i.test(id))throw new HttpError(400,'Invalid bookmark ID.');
  const label=body.label===undefined?'':text(body.label,80).trim();
  const anchor=createReadingAnchor(fileId,revision,file.text,body.offset as number,processedSourceDocument(file),body.atEnd===true);
  if(!anchor.quote.trim())throw new HttpError(400,'This source has no readable passage.');
  this.store.run('INSERT INTO source_reading_locations (vault_id,file_id,id,label,anchor_json) VALUES (?,?,?,?,?) ON CONFLICT(vault_id,file_id,id) DO UPDATE SET label=excluded.label,anchor_json=excluded.anchor_json',vault,fileId,id,label,JSON.stringify(anchor));
  return {id,label,anchor,resolution:{status:'resolved',offset:anchor.offset}} satisfies ReadingLocation;
 }
 renameLocation(vault:string,fileId:string,id:string,body:Record<string,unknown>) {
  this.file(vault,fileId);
  if(id==='resume')throw new HttpError(400,'Choose a bookmark.');
  const result=this.store.run('UPDATE source_reading_locations SET label=? WHERE vault_id=? AND file_id=? AND id=?',text(body.label,80).trim(),vault,fileId,id);
  if(!result.changes)throw new HttpError(404,'Bookmark not found.');
  return {ok:true};
 }
 removeLocation(vault:string,fileId:string,id:string) {
  this.file(vault,fileId);
  this.store.run('DELETE FROM source_reading_locations WHERE vault_id=? AND file_id=? AND id=?',vault,fileId,id);
  return {ok:true};
 }
 private selection(vault:string,fileId:string,body:Record<string,unknown>):SourceReference {
  const raw=this.file(vault,fileId);
  if(raw.status!=='ready'||raw.admitted!==1)throw new HttpError(409,'Wait for this source to finish processing.');
  if(body.sourceId!==raw.entity_id||body.fileId!==fileId)throw new HttpError(400,'This passage does not belong to this source.');
  const hash=required(body.sourceHash);
  const file=sourceTextHash(raw.text)===hash?raw:mathSource(this.store,raw);
  if(sourceTextHash(file.text)!==hash)throw new HttpError(409,'This source changed. Reload it and select the passage again.');
  const start=body.startOffset,end=body.endOffset;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||(start as number)<0||(end as number)<=(start as number)||(end as number)>file.text.length)throw new HttpError(400,'Select a valid passage in the source.');
  const excerpt=text(body.excerpt,65536);
  if(!excerpt.trim()||file.text.slice(start as number,end as number)!==excerpt)throw new HttpError(400,'The selected passage does not match this source.');
  const startLine=file.text.slice(0,start as number).split('\n').length,endLine=startLine+excerpt.split('\n').length-1;
  const ref:SourceReference={id:randomUUID(),sourceId:raw.entity_id!,fileId,sourceHash:hash,startOffset:start as number,endOffset:end as number,startLine,endLine,excerpt};
  const entries=sourceDocumentEntries(processedSourceDocument(file));
  const node=typeof body.nodeId==='string'?entries.find(entry=>entry.node.id===body.nodeId&&entry.node.range.startOffset<=ref.startOffset!&&entry.node.range.endOffset>=ref.endOffset!):undefined;
  if(node){ref.nodeId=node.node.id;ref.contextLabel=sourceNodeLabel(node.path);}
  ref.appLocator=sourceReferenceLocator(entries,ref);
  const starts=JSON.parse(file.page_start_lines??'[]') as number[];
  if(file.format==='pdf')Object.assign(ref,sourcePageRange(starts.length?starts:file.pages===1?[1]:[],startLine,endLine));
  return ref;
 }
 private highlight(row:HighlightRow):SourceHighlight {
  const ref=JSON.parse(row.reference_json) as SourceReference;
  return {...ref,id:row.id,sourceId:row.source_id,fileId:row.file_id,sourceHash:row.source_hash,startOffset:row.start_offset,endOffset:row.end_offset,excerpt:row.excerpt,color:row.color,createdAt:row.created_at};
 }
 list(vault:string,fileId:string) {
  this.file(vault,fileId);
  return this.store.all<HighlightRow>('SELECT * FROM highlights WHERE vault_id=? AND file_id=? ORDER BY start_offset,created_at,id',vault,fileId).map(row=>this.highlight(row));
 }
 listReadingNotes(vault:string,fileId:string) {
  this.file(vault,fileId);
  const knowledge=new Knowledge(this.store);
  return this.store.all<ReadingNoteAnchor & {blocks:string}>(`SELECT n.page_id AS pageId,p.title,p.blocks,n.source_hash AS sourceHash,n.start_offset AS startOffset,n.end_offset AS endOffset
   FROM page_reading_notes n JOIN pages p ON p.id=n.page_id AND p.vault_id=n.vault_id
   WHERE n.vault_id=? AND n.file_id=? AND p.deleted_at IS NULL ORDER BY n.start_offset,n.created_at,n.page_id`,vault,fileId).map(({blocks,...note})=>({...note,text:projectPageText(JSON.parse(blocks) as Block[],id=>entityMentionName(knowledge.find(vault,id))).text}));
 }
 createHighlight(vault:string,fileId:string,body:Record<string,unknown>) {
  if(!highlightColors.includes(body.color as SourceHighlight['color']))throw new HttpError(400,'Choose one of the five highlight colors.');
  const ref=this.selection(vault,fileId,body),id=randomUUID(),createdAt=now();
  this.store.run('INSERT INTO highlights (id,vault_id,source_id,file_id,source_hash,start_offset,end_offset,excerpt,color,reference_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,vault,ref.sourceId,fileId,ref.sourceHash,ref.startOffset!,ref.endOffset!,ref.excerpt,body.color as string,JSON.stringify(ref),createdAt);
  return this.highlight(this.store.get<HighlightRow>('SELECT * FROM highlights WHERE id=?',id)!);
 }
 removeHighlight(vault:string,fileId:string,id:string) {
  this.file(vault,fileId);
  if(!this.store.get('SELECT 1 FROM highlights WHERE id=? AND vault_id=? AND file_id=?',id,vault,fileId))throw new HttpError(404,'Highlight not found');
  this.store.run('DELETE FROM highlights WHERE id=? AND vault_id=? AND file_id=?',id,vault,fileId);
  return {ok:true};
 }
 updateHighlight(vault:string,fileId:string,id:string,body:Record<string,unknown>) {
  this.file(vault,fileId);
  if(!highlightColors.includes(body.color as SourceHighlight['color']))throw new HttpError(400,'Choose one of the five highlight colors.');
  const row=this.store.get<HighlightRow>('SELECT * FROM highlights WHERE id=? AND vault_id=? AND file_id=?',id,vault,fileId);
  if(!row)throw new HttpError(404,'Highlight not found');
  this.store.run('UPDATE highlights SET color=? WHERE id=? AND vault_id=? AND file_id=?',body.color as string,id,vault,fileId);
  return this.highlight({...row,color:body.color as SourceHighlight['color']});
 }
 prepareExplanation(vault:string,fileId:string,body:Record<string,unknown>) {
  const ref=this.selection(vault,fileId,body),requestId=readingNoteRequestId(body.requestId);
  const language=body.language??'',familiarity=body.familiarity??'familiar';
  if(typeof language!=='string'||language!==''&&!sourcePageLanguages.some(value=>value===language))throw new HttpError(400,'Choose a supported explanation language.');
  if(typeof familiarity!=='string'||!Object.hasOwn(readingExplanationFamiliarities,familiarity))throw new HttpError(400,'Choose a reader familiarity.');
  if(Buffer.byteLength(ref.excerpt,'utf8')>24000)throw new HttpError(400,'Select a shorter passage (at most 24,000 bytes of text).');
  const options:ReadingExplanationOptions={language,familiarity:familiarity as ReadingExplanationOptions['familiarity']};
  let saved:Page|undefined;
  const existing=this.store.get<{vault_id:string}>('SELECT vault_id FROM page_reading_notes WHERE page_id=?',requestId);
  if(existing) {
   if(existing.vault_id!==vault)throw new HttpError(409,'This reading note request is already in use.');
   saved=new Pages(this.store,new Knowledge(this.store)).get(vault,requestId);
   const note=saved.readingNote;
   if(!note?.explanation||note.fileId!==fileId||note.sourceHash!==ref.sourceHash||note.startOffset!==ref.startOffset||note.endOffset!==ref.endOffset||note.explanation.language!==language||note.explanation.familiarity!==familiarity)throw new HttpError(409,'This reading note request is already in use.');
  }
  return {ref,options,requestId,saved};
 }
 createReadingNote(vault:string,fileId:string,body:Record<string,unknown>,explanation?:ReadingExplanationOptions):Page {
  const ref=this.selection(vault,fileId,body),content=text(body.text).trim();
  if(!content)throw new HttpError(400,'Write a reading note first.');
  if(readingNoteWordCount(content)>readingNoteMaxWords)throw new HttpError(400,'Reading notes can contain at most 200 words.');
  const pages=new Pages(this.store,new Knowledge(this.store));
  const requestId=body.requestId===undefined?undefined:readingNoteRequestId(body.requestId);
  const pageId=requestId??randomUUID(),createdAt=now();
  // A retry after a lost response returns the original note, without duplicating it.
  const existing=this.store.get<{vault_id:string;file_id:string|null;source_hash:string;start_offset:number;end_offset:number}>('SELECT vault_id,file_id,source_hash,start_offset,end_offset FROM page_reading_notes WHERE page_id=?',pageId);
  if(existing){
   if(existing.vault_id!==vault||existing.file_id!==fileId||existing.source_hash!==ref.sourceHash||existing.start_offset!==ref.startOffset||existing.end_offset!==ref.endOffset)throw new HttpError(409,'This reading note request is already in use.');
   const saved=pages.get(vault,pageId);
   if(projectPageText(saved.blocks,()=>undefined).text!==content.split(/\n\s*\n/).join('\n'))throw new HttpError(409,'The previous note was already saved. Open it from Pages to make further changes.');
   return saved;
  }
  const name=this.store.get<{name:string}>('SELECT name FROM entities WHERE id=?',ref.sourceId)!.name;
  const blocks=content.split(/\n\s*\n/).map(value=>({id:randomUUID(),type:'paragraph',checked:false,content:[{text:value}]}));
  const reference=explanation?{...ref,explanation}:ref;
  const language=explanation?pageLanguage(explanation.language||this.file(vault,fileId).language):null;
  this.store.transaction(()=>{
   this.store.run('INSERT INTO pages (id,title,blocks,updated_at,created_at,vault_id,ai_status,language) VALUES (?,?,?,?,?,?,?,?)',pageId,`${explanation?'AI explanation':'Reading note'} · ${name}`.slice(0,500),JSON.stringify(blocks),createdAt,createdAt,vault,explanation?'ai_generated':'regular',language);
   if(explanation){
    const metadata:PageGenerationMetadata={version:1,type:'reading_explanation',options:{...explanation},instructions:explanationPrompt(ref.excerpt,explanation).instructions};
    this.store.run('UPDATE pages SET generation_metadata=? WHERE id=? AND vault_id=?',JSON.stringify(metadata),pageId,vault);
   }
   this.store.run('INSERT INTO page_sources (page_id,source_id) VALUES (?,?)',pageId,ref.sourceId);
   new PageEnrichmentState(this.store).markManual(pageId,'title');
   this.store.run('INSERT INTO page_reading_notes (page_id,vault_id,source_id,file_id,source_hash,start_offset,end_offset,excerpt,reference_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',pageId,vault,ref.sourceId,fileId,ref.sourceHash,ref.startOffset!,ref.endOffset!,ref.excerpt,JSON.stringify(reference),createdAt);
   syncReadingNotesCollection(this.store,vault);
  });
  return pages.get(vault,pageId);
 }
}
