import type {SourceFile,SourceReference} from '../../shared/domain.js';
import type {SourceSelection} from '../../shared/source-reading.js';
import type {SourceReprocessingRevision} from '../../shared/source-reprocessing.js';
import {createSourceAnnotationMapper} from '../../shared/source-annotation-mapping.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {sourceTextHash} from './source-math-text.js';
import {materializeSourceRevision} from './source-reprocessing.js';
import {resolveSourceDocument} from './source-ingestion-document.js';
import {sourceDocumentEntries,sourceReferenceLocator} from '../../shared/source-document.js';

/** Annotation storage stays on the original; projections never rewrite evidence. */
export function sourceReadingRevision(store:Store,vault:string,file:SourceFile,revisionId?:unknown) {
 let revision:SourceReprocessingRevision|undefined;
 if(revisionId!==undefined){
  if(typeof revisionId!=='string'||!revisionId)throw new HttpError(400,'Choose a valid reading version.');
  const row=store.get<{payload:string}>('SELECT payload FROM source_reprocessing WHERE vault_id=? AND file_id=? AND id=?',vault,file.id,revisionId);
  if(!row)throw new HttpError(404,'Editorial pass not found.');
  revision=JSON.parse(row.payload) as SourceReprocessingRevision;
  if(revision.status!=='completed'||revision.original.text!==file.text||revision.report.chunksCompleted<revision.report.chunksTotal)throw new HttpError(409,'This reading version changed or is incomplete. Reopen it before annotating.');
  materializeSourceRevision(revision);
 }
 const text=revision?.reprocessed.text??file.text,hash=sourceTextHash(text),originalHash=sourceTextHash(file.text);
 const forward=createSourceAnnotationMapper(file.text,text,revision?.patches);
 const reverse=createSourceAnnotationMapper(file.text,text,revision?.patches,true);
 const document=revision?.reprocessed.document??resolveSourceDocument(store,file);
 function project<T extends {sourceHash:string;startOffset:number;endOffset:number}>(value:T):T|null {
  if(value.sourceHash===hash)return {...value};
  // Only known original coordinates can be projected. Historical evidence is kept intact.
  if(value.sourceHash!==originalHash)return null;
  const range=forward(value);if(!range)return null;
  return {...value,...range,sourceHash:hash};
 }
 function reference(ref:SourceSelection & {id:string;startPage?:number;endPage?:number}):SourceReference|null {
  const mapped=project(ref);
  if(!mapped)return null;
  const start=mapped.startOffset,end=mapped.endOffset;
  const entries=sourceDocumentEntries(document),node=entries.filter(({node})=>node.range.startOffset<=start&&node.range.endOffset>=end).at(-1)?.node;
  const {nodeId:_nodeId,contextLabel:_contextLabel,appLocator:_locator,startPage:_startPage,endPage:_endPage,...base}=mapped;
  const page=(offset:number)=>document.physical.pages.find(page=>page.range.startOffset<=offset&&page.range.endOffset>offset)?.number;
  return {...base,excerpt:text.slice(start,end),startLine:text.slice(0,start).split('\n').length,endLine:text.slice(0,end).split('\n').length,...(node?{nodeId:node.id}:{}),appLocator:sourceReferenceLocator(entries,{...mapped,startLine:text.slice(0,start).split('\n').length,endLine:text.slice(0,end).split('\n').length}),startPage:page(start),endPage:page(Math.max(start,end-1))};
 }
 return {text,hash,document,forward,reverse,project,reference};
}
