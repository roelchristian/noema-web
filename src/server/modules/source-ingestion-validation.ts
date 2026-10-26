import {sourceIngestionBlockNotes} from '../../shared/source-evidence.js';
import {sourceMathAnnotations} from '../../shared/source-math-annotations.js';
import {SOURCE_INGESTION_DIAGRAM_SCHEMA,validateSourceIngestionDiagram} from './source-ingestion-diagram.js';
import {SOURCE_INGESTION_MAX_CHARACTERS,type SourceIngestionDocument} from '../../shared/source-ingestion.js';
import {wellFormedUnicode} from './source-reprocessing-patches.js';
export const SOURCE_INGESTION_REPAIR_CATEGORIES=['ocr','line_breaks','footnote','apparatus','metadata','citation','math','formatting'] as const;
const repairCategories=new Set<string>(SOURCE_INGESTION_REPAIR_CATEGORIES);
export type SourceIngestionSchema={description?:string;type?:string;properties?:Record<string,SourceIngestionSchema>;required?:string[];additionalProperties?:boolean;minimum?:number;maximum?:number;items?:SourceIngestionSchema;enum?:unknown[];anyOf?:SourceIngestionSchema[]};
type Schema=SourceIngestionSchema;
const str:Schema={type:'string'},num:Schema={type:'integer'},bool:Schema={type:'boolean'};
const nullable=(value:Schema):Schema=>({anyOf:[value,{type:'null'}]});
const array=(items:Schema):Schema=>({type:'array',items});
const object=(properties:Record<string,SourceIngestionSchema>):Schema=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const SOURCE_INGESTION_JSON_SCHEMA=object({
 schemaVersion:{type:'integer',enum:[1]},
 metadata:object({title:nullable(str),language:nullable(str),synopsis:nullable(str),contributors:array(object({name:str,role:str,page:num,blockId:nullable(str)})),bibliographic:array(object({field:str,value:str,page:num,blockId:nullable(str)})),candidates:array(object({field:str,value:str,blockId:str,page:num,quote:str,reason:str}))}),
 pages:array(object({number:num,printedLabel:nullable(str),role:{type:'string',enum:['owned','context']},state:{type:'string',enum:['content','blank','image-only','unreadable']},unresolved:array(object({description:str,blockId:nullable(str)}))})),
 blocks:array(object({id:str,page:num,order:num,kind:{type:'string',enum:['paragraph','heading','table','equation','figure','caption','footnote','list','blockquote','code','theorem','lemma','proposition','corollary','definition','proof','example','remark','bibliography','furniture']},text:str,headingLevel:nullable(num),continues:nullable(str),table:nullable(object({rows:{...num,description:'Number of rows, not the last row index.'},columns:{...num,description:'Number of columns, not the last column index.'},cells:array(object({row:{...num,description:'Zero-based starting row; first row is 0.'},column:{...num,description:'Zero-based starting column; first column is 0.'},rowSpan:{...num,description:'Positive number of rows occupied, usually 1.'},columnSpan:{...num,description:'Positive number of columns occupied, usually 1.'},text:str}))})),uncertainty:nullable(str),diagram:nullable(SOURCE_INGESTION_DIAGRAM_SCHEMA as Schema),location:nullable({...object({x:{type:'number',minimum:0,maximum:1,description:'Left edge in normalized 0..1 page coordinates.'},y:{type:'number',minimum:0,maximum:1,description:'Top edge in normalized 0..1 page coordinates.'},width:{type:'number',minimum:0,maximum:1,description:'Box width as a normalized page fraction, not the right edge.'},height:{type:'number',minimum:0,maximum:1,description:'Box height as a normalized page fraction, not the bottom edge.'},accuracy:{type:'string',enum:['approximate']}}),description:'Approximate top-left box in normalized 0..1 page coordinates. x/y are left/top; width/height are extents.'})})),
 relations:array(object({kind:{type:'string',enum:['heading-parent','statement-proof','footnote-callout','caption','table-continuation','bibliography','continuation']},from:str,to:str,uncertain:bool})),
 repairs:array(object({blockId:str,start:num,end:num,original:str,replacement:str,category:{...str,description:'Exactly one of: '+SOURCE_INGESTION_REPAIR_CATEGORIES.join(', ')+'. Other concerns belong in block uncertainty, not repairs.'},reason:str})),
});
const internalMetadata=SOURCE_INGESTION_JSON_SCHEMA.properties!.metadata!;
/** Fresh provider output requires candidates, even when empty. Legacy authoritative
 * IR and retained responses may omit this later-added evidence array. */
const wireBlock=SOURCE_INGESTION_JSON_SCHEMA.properties!.blocks!.items!;
const internalBlock:Schema={...wireBlock,required:wireBlock.required!.filter(key=>key!=='diagram'),properties:{...wireBlock.properties,layoutWarnings:array(str)}};
const internalSchema:Schema={...SOURCE_INGESTION_JSON_SCHEMA,properties:{...SOURCE_INGESTION_JSON_SCHEMA.properties,blocks:array(internalBlock),metadata:{...internalMetadata,required:internalMetadata.required!.filter(key=>key!=='candidates')}}};

function matches(value:unknown,schema:Schema,path:string):void {
 if(schema.anyOf){for(const choice of schema.anyOf)try{matches(value,choice,path);return;}catch{}throw new Error(`${path}: invalid nullable value`);}
 if(schema.type==='null'){if(value!==null)throw new Error(`${path}: expected null`);return;}
 if(schema.type==='array'){if(!Array.isArray(value))throw new Error(`${path}: expected array`);if(value.length>200_000)throw new Error(`${path}: too many entries`);value.forEach((v,i)=>matches(v,schema.items!,`${path}[${i}]`));return;}
 if(schema.type==='object'){
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error(`${path}: expected object`);
  const record=value as Record<string,unknown>;
  for(const key of schema.required!)if(!Object.hasOwn(record,key))throw new Error(`${path}.${key}: missing field`);
  for(const [key,v] of Object.entries(record)){if(!Object.hasOwn(schema.properties!,key))throw new Error(`${path}.${key}: unexpected field`);matches(v,schema.properties![key]!,`${path}.${key}`);}return;
 }
 if(schema.type==='integer'?typeof value!=='number'||!Number.isSafeInteger(value):schema.type==='number'?typeof value!=='number'||!Number.isFinite(value):typeof value!==schema.type)throw new Error(`${path}: expected ${schema.type}`);
 if(schema.enum&&!schema.enum.includes(value))throw new Error(`${path}: unsupported value`);
}
type IngestionBlock=SourceIngestionDocument['blocks'][number];
type IngestionTable=NonNullable<IngestionBlock['table']>;
function tableGrid(table:IngestionTable,rowShift=0,columnShift=0):Set<string>|null {
 if(table.rows<1||table.columns<1||table.rows*table.columns>100_000)return null;
 const occupied=new Set<string>();
 for(const cell of table.cells){
  const row=cell.row-rowShift,column=cell.column-columnShift;
  if(row<0||column<0||cell.rowSpan<1||cell.columnSpan<1||row+cell.rowSpan>table.rows||column+cell.columnSpan>table.columns)return null;
  for(let r=row;r<row+cell.rowSpan;r++)for(let c=column;c<column+cell.columnSpan;c++){const key=`${r}:${c}`;if(occupied.has(key))return null;occupied.add(key);}
 }
 return occupied;
}
/** Provider-only recovery of optional layout hints. Authoritative and restored IR
 * continues to use strict validation; ownership, IDs and source text are not repaired. */
export function normalizeSourceIngestionCandidate(input:unknown):SourceIngestionDocument {
 // Diagrams are optional interpretations. Reject their unsupported claims locally
 // without letting malformed graph data rewrite or discard the transcription.
 input=structuredClone(input);
 if(input&&typeof input==='object'&&Array.isArray((input as {blocks?:unknown}).blocks))for(const value of (input as {blocks:unknown[]}).blocks){
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,'diagram'))continue;
  const block=value as Record<string,unknown>;
  try{validateSourceIngestionDiagram(block.diagram,{kind:String(block.kind),text:typeof block.text==='string'?block.text:''});}
  catch{block.diagram=null;const warning='An inconsistent provider diagram interpretation was omitted. Inspect the original page connections and labels.';if(block.layoutWarnings===undefined||Array.isArray(block.layoutWarnings))block.layoutWarnings=[...new Set([...(block.layoutWarnings as unknown[]??[]),warning])];}
 }
 matches(input,internalSchema,'document');
 const doc=structuredClone(input as SourceIngestionDocument);
 const originalTexts=new Map(doc.blocks.map(block=>[block.id,block.text]));
 const note=(block:IngestionBlock,message:string)=>{if(!block.uncertainty?.includes(message))block.uncertainty=[block.uncertainty,message].filter(Boolean).join(' ');};
 for(const block of doc.blocks){
  const oldGeometryWarning='An out-of-bounds provider location hint was omitted. Inspect the original PDF for visual placement.';
  if(block.uncertainty?.includes(oldGeometryWarning)){block.uncertainty=block.uncertainty.replace(oldGeometryWarning,'').trim()||null;block.layoutWarnings=[...new Set([...(block.layoutWarnings??[]),oldGeometryWarning])];}
  if(block.headingLevel!==null&&(block.kind!=='heading'||block.headingLevel<1||block.headingLevel>6)||block.kind==='heading'&&block.headingLevel===null){
   if(block.kind==='heading')block.kind='paragraph';block.headingLevel=null;note(block,'An inconsistent provider heading level was omitted. The original text is retained; heading structure requires review.');
  }
  if(block.location&&([block.location.x,block.location.y,block.location.width,block.location.height].some(n=>n<0||n>1)||block.location.x+block.location.width>1||block.location.y+block.location.height>1)){
   block.location=null;const warning='An out-of-bounds provider location hint was omitted. Inspect the original PDF for visual placement.';block.layoutWarnings=[...new Set([...(block.layoutWarnings??[]),warning])];
  }
  const table=block.table;if(!table)continue;
  if(block.kind==='table'&&tableGrid(table))continue;
  // A unique complete-grid conversion establishes the origin convention. Sparse
  // or ambiguous grids cannot justify guessing new dimensions or missing cells.
  const shifts=block.kind==='table'?[[1,0],[0,1],[1,1]].filter(([row,column])=>tableGrid(table,row,column)?.size===table.rows*table.columns):[];
  if(shifts.length===1){const [row,column]=shifts[0]!;for(const cell of table.cells){cell.row-=row!;cell.column-=column!;}note(block,'Provider table coordinates used a one-based origin; normalized to zero-based coordinates. Table layout requires review.');continue;}
  // Table cells are redundant layout, but their strings may contain content not
  // repeated in the plain transcription. Retain every supplied string in order.
  const transcription=block.text;let consumed=0;
  // Match monotonically in supplied cell order: each original occurrence can
  // account for one cell only. Unmatched values stay explicit, including repeats.
  for(const cell of table.cells){
   if(!cell.text)continue;const match=transcription.indexOf(cell.text,consumed);
   if(match>=0)consumed=match+cell.text.length;else block.text+=(block.text?'\n':'')+cell.text;
  }
  block.table=null;
  note(block,'Provider table layout was inconsistent and was omitted. All supplied text is retained as a plain transcription; inspect the original PDF to review the layout.');
 }
 // Optional continuation hints must never prevent readable, otherwise valid
 // source text from publishing. Unknown or ambiguous IDs remain strict errors.
 const ids=new Map<string,IngestionBlock>();const duplicate=new Set<string>();
 for(const block of doc.blocks){if(ids.has(block.id))duplicate.add(block.id);ids.set(block.id,block);}
 const before=(from:IngestionBlock,to:IngestionBlock)=>from.page<to.page||from.page===to.page&&from.order<to.order;
 const tables=(from:IngestionBlock,to:IngestionBlock)=>from.kind==='table'&&to.kind==='table'&&!!from.table&&!!to.table&&from.table.columns===to.table.columns;
 for(const block of doc.blocks){
  if(!block.continues||duplicate.has(block.id)||duplicate.has(block.continues))continue;
  const previous=ids.get(block.continues);if(!previous)continue;
  if(!before(previous,block)||previous.kind!==block.kind||block.kind==='table'&&!tables(previous,block)){block.continues=null;note(block,'An inconsistent provider continuation hint was omitted. The separate text blocks are retained; their relationship requires review.');}
 }
 const relationKeys=new Set<string>();
 doc.relations=doc.relations.filter(relation=>{
  if(duplicate.has(relation.from)||duplicate.has(relation.to))return true;
  const from=ids.get(relation.from),to=ids.get(relation.to);if(!from||!to)return true;
  const key=`${relation.kind}:${from.id}:${to.id}`;
  const omit=()=>{note(from,`An inconsistent provider ${relation.kind} relation was omitted. Both text blocks are retained; their relationship requires review.`);note(to,`An inconsistent provider ${relation.kind} relation was omitted. Both text blocks are retained; their relationship requires review.`);return false;};
  if(from===to||relationKeys.has(key))return omit();
  let valid:boolean;
  switch(relation.kind){
   case 'heading-parent':valid=from.kind==='heading'&&to.kind==='heading'&&from.headingLevel!==null&&to.headingLevel!==null&&from.headingLevel>to.headingLevel;break;
   case 'footnote-callout':valid=from.kind!=='footnote'&&to.kind==='footnote';break;
   case 'statement-proof':valid=['theorem','lemma','proposition','corollary','definition','example','remark'].includes(from.kind)&&to.kind==='proof';break;
   case 'table-continuation':valid=tables(from,to)&&before(from,to);break;
   case 'continuation':valid=from.kind===to.kind&&['paragraph','footnote','list','blockquote','code','bibliography','table','proof'].includes(from.kind)&&(from.kind!=='table'||tables(from,to))&&before(from,to);break;
   case 'caption':valid=['figure','table','equation'].includes(from.kind)&&to.kind==='caption';break;
   case 'bibliography':valid=['heading','bibliography'].includes(from.kind)&&to.kind==='bibliography'&&(from.kind!=='bibliography'||before(from,to));break;
  }
  if(!valid)return omit();relationKeys.add(key);if((relation.kind==='continuation'||relation.kind==='table-continuation')&&to.continues===from.id)return false;return true;
 });
 // Resolve contradictory definite relationships as uncertainty, never choose an
 // arbitrary winner. Heading hierarchies cannot retain multiple parents at all.
 const headingParents=new Map<string,Set<string>>(),footnotes=new Map<string,Set<string>>(),successors=new Map<string,Set<string>>(),predecessors=new Map<string,Set<string>>();
 const add=(map:Map<string,Set<string>>,key:string,value:string)=>{const entries=map.get(key)??new Set<string>();entries.add(value);map.set(key,entries);};
 for(const block of doc.blocks)if(block.continues&&ids.has(block.continues)&&!duplicate.has(block.id)&&!duplicate.has(block.continues)){add(successors,block.continues,block.id);add(predecessors,block.id,block.continues);}
 for(const relation of doc.relations){
  if(!ids.has(relation.from)||!ids.has(relation.to)||duplicate.has(relation.from)||duplicate.has(relation.to))continue;
  if(relation.kind==='heading-parent')add(headingParents,relation.from,relation.to);
  if(relation.kind==='footnote-callout'&&!relation.uncertain)add(footnotes,relation.from,relation.to);
  if(['table-continuation','continuation'].includes(relation.kind)&&!relation.uncertain){add(successors,relation.from,relation.to);add(predecessors,relation.to,relation.from);}
 }
 for(const block of doc.blocks)if(block.continues&&((successors.get(block.continues)?.size??0)>1||(predecessors.get(block.id)?.size??0)>1)){block.continues=null;note(block,'Conflicting provider continuation relationships require review. No definite relationship is asserted.');}
 doc.relations=doc.relations.filter(relation=>{
  const from=ids.get(relation.from),to=ids.get(relation.to);if(!from||!to||duplicate.has(relation.from)||duplicate.has(relation.to))return true;
  const ambiguous=relation.kind==='heading-parent'&&(headingParents.get(from.id)?.size??0)>1||relation.kind==='footnote-callout'&&(footnotes.get(from.id)?.size??0)>1||['table-continuation','continuation'].includes(relation.kind)&&((successors.get(from.id)?.size??0)>1||(predecessors.get(to.id)?.size??0)>1);
  if(!ambiguous)return true;
  note(from,`Conflicting provider ${relation.kind} relationships require review. No definite relationship is asserted.`);note(to,`Conflicting provider ${relation.kind} relationships require review. No definite relationship is asserted.`);
  if(relation.kind==='heading-parent')return false;relation.uncertain=true;return true;
 });
 // Strictly decreasing heading levels and increasing physical reading order
 // above rule out hierarchy/continuation cycles without dropping source blocks.

 doc.repairs=doc.repairs.filter(repair=>{
  const block=ids.get(repair.blockId);if(!block||duplicate.has(block.id))return true;
  // Appended cell-only text cannot make an originally invalid repair valid.
  const original=originalTexts.get(block.id)!;
  const splitsSurrogate=[repair.start,repair.end].some(at=>at>0&&at<original.length&&/[\uD800-\uDBFF]/.test(original[at-1]!)&&/[\uDC00-\uDFFF]/.test(original[at]!));
  if(repair.start>=0&&repair.end>repair.start&&repair.end<=original.length&&original.slice(repair.start,repair.end)===repair.original&&!splitsSurrogate&&wellFormedUnicode(repair.replacement)&&repair.original!==repair.replacement&&repair.original.length<=16000&&repair.replacement.length<=16000&&repair.reason.length<=2000&&repairCategories.has(repair.category)&&!(/<!--\s*Page\s+\d+\s*-->/i.test(repair.original+repair.replacement)))return true;
  note(block,'An inconsistent provider repair suggestion was omitted because it did not satisfy exact-span editorial review constraints. The original transcription is unchanged.');return false;
 });
 // Overlapping alternatives cannot be applied or arbitrarily preferred. Omit
 // each connected overlap group and retain a clear review finding on the block.
 const unsafe=new Set<SourceIngestionDocument['repairs'][number]>();
 const repairsByBlock=new Map<string,SourceIngestionDocument['repairs']>();
 for(const repair of doc.repairs){if(!ids.has(repair.blockId)||duplicate.has(repair.blockId))continue;const list=repairsByBlock.get(repair.blockId)??[];list.push(repair);repairsByBlock.set(repair.blockId,list);}
 for(const [id,repairs] of repairsByBlock){
  const ordered=repairs.slice().sort((a,b)=>a.start-b.start||a.end-b.end);let end=-1,group:typeof repairs=[];
  const finish=()=>{if(group.length>1){for(const repair of group)unsafe.add(repair);note(ids.get(id)!,'Overlapping provider repair suggestions were omitted. No competing edit is selected; the original transcription is unchanged.');}};
  for(const repair of ordered){if(repair.start>=end){finish();group=[];end=-1;}group.push(repair);end=Math.max(end,repair.end);}finish();
 }
 let retainedRepairs=0;
 doc.repairs=doc.repairs.filter(repair=>{
  const block=ids.get(repair.blockId);if(!block||duplicate.has(block.id))return true;
  if(unsafe.has(repair))return false;
  if(retainedRepairs++<6400)return true;
  note(block,'Provider repair suggestions beyond the 6400-item editorial review budget were omitted. The original transcription is unchanged.');return false;
 });
 const evidence=(candidate:SourceIngestionDocument['metadata']['contributors'][number]|SourceIngestionDocument['metadata']['bibliographic'][number])=>{
  const block=candidate.blockId===null?null:ids.get(candidate.blockId);
  if(candidate.blockId!==null&&(!block||duplicate.has(candidate.blockId)))return true;
  if(doc.pages.some(page=>page.number===candidate.page)&&(!block||block.page===candidate.page))return true;
  const message='An inconsistent provider metadata evidence claim was omitted. Source text is retained; bibliographic details require review.';
  if(block)note(block,message);else{const page=doc.pages.find(page=>page.role==='owned');if(page&&!page.unresolved.some(region=>region.description===message))page.unresolved.push({description:message,blockId:null});}
  return false;
 };
 doc.metadata.contributors=doc.metadata.contributors.filter(evidence);doc.metadata.bibliographic=doc.metadata.bibliographic.filter(evidence);
 if(doc.metadata.candidates)doc.metadata.candidates=doc.metadata.candidates.filter(candidate=>{const block=ids.get(candidate.blockId);if(!block||duplicate.has(candidate.blockId))return true;if(evidence(candidate)&&candidate.quote.trim()&&block.text.includes(candidate.quote))return true;note(block,'An inconsistent provider metadata quotation was omitted. Bibliographic details require review.');return false;});

 return doc;
}

/** Strictly validate untrusted provider data before assigning any trusted IDs or coordinates. */
export function validateSourceIngestionDocument(input:unknown,options:{ownedPages:number[];pageCount:number}):SourceIngestionDocument {
 matches(input,internalSchema,'document');
 const doc=input as SourceIngestionDocument;
 if(!Number.isSafeInteger(options.pageCount)||options.pageCount<1)throw new Error('Invalid original page count');
 const requested=new Set(options.ownedPages);
 if(requested.size!==options.ownedPages.length||!requested.size||[...requested].some(p=>!Number.isSafeInteger(p)||p<1||p>options.pageCount))throw new Error('Invalid owned page plan');
 const pages=new Map<number,SourceIngestionDocument['pages'][number]>();
 for(const page of doc.pages){if(page.number<1||page.number>options.pageCount||pages.has(page.number))throw new Error('Duplicate or out of bounds physical page');if((page.role==='owned')!==requested.has(page.number))throw new Error('Page ownership mismatch');pages.set(page.number,page);}
 if([...requested].some(p=>!pages.has(p)))throw new Error('Missing owned physical page');
 const blocks=new Map<string,SourceIngestionDocument['blocks'][number]>(),orders=new Set<string>();let size=0;
 for(const block of doc.blocks){
  validateSourceIngestionDiagram(block.diagram,block);
  if(block.layoutWarnings&&(block.layoutWarnings.length>32||block.layoutWarnings.some(warning=>!warning.trim()||warning.length>2000)))throw new Error('Invalid layout warning budget');
  if(!block.id||block.id.length>256||blocks.has(block.id))throw new Error('Duplicate or invalid temporary block ID');
  if(!requested.has(block.page))throw new Error('Context page cannot contribute owned output');
  if(block.order<0||orders.has(`${block.page}:${block.order}`))throw new Error('Duplicate or invalid block reading order');orders.add(`${block.page}:${block.order}`);
  if(/<!--\s*Page\s+\d+\s*-->/i.test(block.text))throw new Error('Provider page markers are forbidden');
  if(block.text.includes('\r')||block.text.includes('\u0000')||/[\uD800-\uDFFF]/u.test(block.text))throw new Error('Noncanonical text control character');
  size+=block.text.length;if(size>SOURCE_INGESTION_MAX_CHARACTERS)throw new Error('Document character budget exceeded');
  if(block.headingLevel!==null&&(block.kind!=='heading'||block.headingLevel<1||block.headingLevel>6))throw new Error('Invalid heading level');
  if(block.kind==='heading'&&block.headingLevel===null)throw new Error('Heading level required');
  if(block.location&&([block.location.x,block.location.y,block.location.width,block.location.height].some(n=>n<0||n>1)||block.location.x+block.location.width>1||block.location.y+block.location.height>1))throw new Error('Approximate geometry outside normalized bounds');
  if(block.table){
   const table=block.table;if(block.kind!=='table'||table.rows<1||table.columns<1||table.rows*table.columns>100_000)throw new Error('Invalid table dimensions');
   const occupied=new Set<string>();for(const cell of table.cells){if(cell.row<0||cell.column<0||cell.rowSpan<1||cell.columnSpan<1||cell.row+cell.rowSpan>table.rows||cell.column+cell.columnSpan>table.columns)throw new Error('Table cell outside dimensions');for(let r=cell.row;r<cell.row+cell.rowSpan;r++)for(let c=cell.column;c<cell.column+cell.columnSpan;c++){const key=`${r}:${c}`;if(occupied.has(key))throw new Error('Overlapping table cells');occupied.add(key);}}
  }
  blocks.set(block.id,block);
 }
 const textPages=new Set(doc.blocks.filter(b=>b.text.trim()).map(b=>b.page));
 for(const page of pages.values()){const hasText=textPages.has(page.number);if(page.role==='owned'&&page.state==='content'&&!hasText)throw new Error('Content page has no transcription');if(page.state==='blank'&&hasText)throw new Error('Blank page contains text');for(const region of page.unresolved)if(region.blockId!==null&&!blocks.has(region.blockId))throw new Error('Unknown unresolved block');}
 const reference=(id:string)=>{const block=blocks.get(id);if(!block)throw new Error('Unknown block reference');return block;};
 const parents=new Map<string,string>(),relationKeys=new Set<string>(),footnoteTargets=new Map<string,string>(),tableSuccessors=new Map<string,string>(),tablePredecessors=new Map<string,string>();
 const continuationEdges=new Map<string,string[]>();
 const precedes=(from:SourceIngestionDocument['blocks'][number],to:SourceIngestionDocument['blocks'][number])=>from.page<to.page||from.page===to.page&&from.order<to.order;
 const compatibleTables=(from:SourceIngestionDocument['blocks'][number],to:SourceIngestionDocument['blocks'][number])=>from.kind==='table'&&to.kind==='table'&&from.table!==null&&to.table!==null&&from.table.columns===to.table.columns;
 const continuation=(from:string,to:string)=>{if(tableSuccessors.has(from)&&tableSuccessors.get(from)!==to||tablePredecessors.has(to)&&tablePredecessors.get(to)!==from)throw new Error('Ambiguous definite continuation');tableSuccessors.set(from,to);tablePredecessors.set(to,from);};
 const edge=(from:string,to:string)=>{const values=continuationEdges.get(from)??[];values.push(to);continuationEdges.set(from,values);};
 for(const block of doc.blocks)if(block.continues){const previous=reference(block.continues);if(!precedes(previous,block))throw new Error('Continuation must point backwards');if(previous.kind!==block.kind||block.kind==='table'&&!compatibleTables(previous,block))throw new Error('Incompatible continued block kinds or table dimensions');if(block.kind==='table')continuation(previous.id,block.id);edge(previous.id,block.id);}
 for(const relation of doc.relations){
  const from=reference(relation.from),to=reference(relation.to);if(from===to)throw new Error('Self relation');
  const key=`${relation.kind}:${from.id}:${to.id}`;if(relationKeys.has(key))throw new Error('Duplicate source relation');relationKeys.add(key);
  if(relation.kind==='heading-parent'){
   if(from.kind!=='heading'||to.kind!=='heading'||parents.has(from.id)||from.headingLevel!<=to.headingLevel!)throw new Error('Invalid heading hierarchy');parents.set(from.id,to.id);
  }else if(relation.kind==='footnote-callout'){
   if(from.kind==='footnote'||to.kind!=='footnote')throw new Error('Footnote relation must target a footnote from source content');
   if(!relation.uncertain){if(footnoteTargets.has(from.id)&&footnoteTargets.get(from.id)!==to.id)throw new Error('Ambiguous definite footnote pairing');footnoteTargets.set(from.id,to.id);}
  }else if(relation.kind==='statement-proof'){
   if(!['theorem','lemma','proposition','corollary','definition','example','remark'].includes(from.kind)||to.kind!=='proof')throw new Error('Statement relation must connect a statement and proof');
  }else if(relation.kind==='table-continuation'){
   if(!compatibleTables(from,to)||!precedes(from,to))throw new Error('Incompatible table continuation dimensions or direction');
   if(!relation.uncertain){if(tableSuccessors.has(from.id)&&tableSuccessors.get(from.id)!==to.id||tablePredecessors.has(to.id)&&tablePredecessors.get(to.id)!==from.id)throw new Error('Ambiguous definite table continuation');continuation(from.id,to.id);edge(from.id,to.id);}
  }else if(relation.kind==='continuation'){
   if(from.kind!==to.kind||!['paragraph','footnote','list','blockquote','code','bibliography','table','proof'].includes(from.kind)||from.kind==='table'&&!compatibleTables(from,to)||!precedes(from,to))throw new Error('Incompatible continuation kinds or direction');
   if(!relation.uncertain){if(from.kind==='table')continuation(from.id,to.id);edge(from.id,to.id);}
  }else if(relation.kind==='caption'){
   if(!['figure','table','equation'].includes(from.kind)||to.kind!=='caption')throw new Error('Caption relation requires an object and caption');
  }else if(relation.kind==='bibliography'){
   if(!['heading','bibliography'].includes(from.kind)||to.kind!=='bibliography')throw new Error('Invalid bibliography membership');
   if(from.kind==='bibliography'&&(!precedes(from,to)))throw new Error('Invalid bibliography continuation direction');
   if(!relation.uncertain&&from.kind==='bibliography')edge(from.id,to.id);
  }
 }
 const indegrees=new Map<string,number>();for(const [from,children] of continuationEdges){if(!indegrees.has(from))indegrees.set(from,0);for(const to of children)indegrees.set(to,(indegrees.get(to)??0)+1);}
 const queue=[...indegrees].filter(([,n])=>n===0).map(([id])=>id);let visited=0;for(let cursor=0;cursor<queue.length;cursor++){const id=queue[cursor]!;visited++;for(const to of continuationEdges.get(id)??[]){const next=indegrees.get(to)!-1;indegrees.set(to,next);if(next===0)queue.push(to);}}
 if(visited!==indegrees.size)throw new Error('Continuation relation cycle');
 for(const id of parents.keys()){const seen=new Set<string>();let cursor:string|undefined=id;while(cursor){if(seen.has(cursor))throw new Error('Hierarchy cycle');seen.add(cursor);cursor=parents.get(cursor);}}
 for(const candidate of [...doc.metadata.contributors,...doc.metadata.bibliographic]){if(!pages.has(candidate.page))throw new Error('Metadata evidence page missing');if(candidate.blockId!==null&&reference(candidate.blockId).page!==candidate.page)throw new Error('Metadata evidence mismatch');}
 for(const candidate of doc.metadata.candidates??[]){const block=reference(candidate.blockId);if(!pages.has(candidate.page)||block.page!==candidate.page||!candidate.quote.trim()||!block.text.includes(candidate.quote))throw new Error('Metadata candidate evidence mismatch');}
 for(const repair of doc.repairs){const block=reference(repair.blockId);if(repair.start<0||repair.end<=repair.start||repair.end>block.text.length||block.text.slice(repair.start,repair.end)!==repair.original)throw new Error('Repair must match exact UTF-16 source span');for(const at of [repair.start,repair.end])if(at>0&&at<block.text.length&&/[\uD800-\uDBFF]/.test(block.text[at-1]!)&&/[\uDC00-\uDFFF]/.test(block.text[at]!))throw new Error('Repair splits a Unicode surrogate pair');}
 return structuredClone(doc);
}

export interface SourceIngestionFinding {
 kind:'math-review'|'unreadable-region'|'uncertain-block'|'uncertain-relation'|'native-text-anomaly'|'window-boundary';
 pages:number[];blockIds:string[];reason:string;
 /** These are review/targeted-recovery findings, never evidence of a proved correction. */
 independentVerification:false;
}
/** Compare supplied native-layer evidence without requiring native extraction to ingest a PDF. */
export function sourceIngestionRepairFindings(document:SourceIngestionDocument,options:{nativePages?:{page:number;text:string;extractor:string}[];windowBoundaries?:number[]}={}):SourceIngestionFinding[] {
 const findings:SourceIngestionFinding[]=[],blocks=new Map(document.blocks.map(b=>[b.id,b]));
 const byPage=new Map<number,SourceIngestionDocument['blocks']>();for(const block of document.blocks){const list=byPage.get(block.page)??[];list.push(block);byPage.set(block.page,list);}for(const list of byPage.values())list.sort((a,b)=>a.order-b.order);
 for(const page of document.pages){if(page.state==='unreadable'||page.state==='image-only')findings.push({kind:'unreadable-region',pages:[page.number],blockIds:[],reason:page.state==='unreadable'?'Physical page is explicitly unreadable':'Physical page has image-only content without faithful text',independentVerification:false});for(const region of page.unresolved)findings.push({kind:'unreadable-region',pages:[page.number],blockIds:region.blockId?[region.blockId]:[],reason:region.description,independentVerification:false});}
 for(const block of document.blocks)for(const issue of sourceMathAnnotations(block.text).review.slice(0,8))findings.push({kind:'math-review',pages:[block.page],blockIds:[block.id],reason:issue.reason,independentVerification:false});
 for(const block of document.blocks){const uncertainty=sourceIngestionBlockNotes(block).uncertainty;if(uncertainty)findings.push({kind:'uncertain-block',pages:[block.page],blockIds:[block.id],reason:uncertainty,independentVerification:false});}
 for(const relation of document.relations)if(relation.uncertain)findings.push({kind:'uncertain-relation',pages:[...new Set([blocks.get(relation.from)!.page,blocks.get(relation.to)!.page])],blockIds:[relation.from,relation.to],reason:`Unresolved ${relation.kind} relation`,independentVerification:false});
 const words=(text:string)=>new Set(text.normalize('NFKC').toLocaleLowerCase('und').match(/[\p{L}\p{N}]{2,}/gu)??[]);
 for(const native of options.nativePages??[]){if(!native.extractor.trim())throw new Error('Native evidence requires a real extractor identity');const expected=words(native.text);if(expected.size<20)continue;const actual=words((byPage.get(native.page)??[]).map(b=>b.text).join('\n'));const missing=[...expected].filter(w=>!actual.has(w));if(missing.length/expected.size>0.35)findings.push({kind:'native-text-anomaly',pages:[native.page],blockIds:(byPage.get(native.page)??[]).map(b=>b.id),reason:`Native text comparison (${native.extractor}) has ${missing.length} of ${expected.size} distinct words absent; inspect page evidence. Native text can itself be wrong.`,independentVerification:false});}
 for(const first of options.windowBoundaries??[]){const left=byPage.get(first-1)?.at(-1),right=byPage.get(first)?.[0];if(!left||!right)continue;const explicit=document.relations.some(r=>r.from===left.id&&r.to===right.id||r.from===right.id&&r.to===left.id)||right.continues===left.id;if(!explicit&&(left.kind==='table'&&right.kind==='table'||left.kind==='footnote'||right.kind==='footnote'||left.kind==='proof'&&right.kind==='proof'||left.kind==='paragraph'&&right.kind==='paragraph'&&!/[.!?。！？][”"')\]]?\s*$/u.test(left.text)))findings.push({kind:'window-boundary',pages:[first-1,first],blockIds:[left.id,right.id],reason:'Possible continuation across extraction windows; preserve separate exact leaf spans until a bounded evidence review resolves the relation.',independentVerification:false});}
 return findings;
}

/** Layout diagnostics intentionally do not trigger mathematical/text repair work. */
export function sourceIngestionLayoutFindings(document:SourceIngestionDocument):{kind:'layout-warning';pages:number[];blockIds:string[];reason:string;independentVerification:false}[] {
 return document.blocks.flatMap(block=>sourceIngestionBlockNotes(block).layoutWarnings.map(reason=>({kind:'layout-warning' as const,pages:[block.page],blockIds:[block.id],reason,independentVerification:false as const})));
}
