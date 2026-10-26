import {SOURCE_INGESTION_MAX_CHARACTERS,type SourceIngestionDocument} from '../../shared/source-ingestion.js';
type Schema={type?:string;properties?:Record<string,Schema>;required?:string[];additionalProperties?:boolean;items?:Schema;enum?:unknown[];anyOf?:Schema[]};
const str:Schema={type:'string'},num:Schema={type:'integer'},bool:Schema={type:'boolean'};
const nullable=(value:Schema):Schema=>({anyOf:[value,{type:'null'}]});
const array=(items:Schema):Schema=>({type:'array',items});
const object=(properties:Record<string,Schema>):Schema=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const SOURCE_INGESTION_JSON_SCHEMA=object({
 schemaVersion:{type:'integer',enum:[1]},
 metadata:object({title:nullable(str),language:nullable(str),synopsis:nullable(str),contributors:array(object({name:str,role:str,page:num,blockId:nullable(str)})),bibliographic:array(object({field:str,value:str,page:num,blockId:nullable(str)}))}),
 pages:array(object({number:num,printedLabel:nullable(str),role:{type:'string',enum:['owned','context']},state:{type:'string',enum:['content','blank','image-only','unreadable']},unresolved:array(object({description:str,blockId:nullable(str)}))})),
 blocks:array(object({id:str,page:num,order:num,kind:{type:'string',enum:['paragraph','heading','table','equation','figure','caption','footnote','list','blockquote','code','theorem','lemma','proposition','corollary','definition','proof','example','remark','bibliography','furniture']},text:str,headingLevel:nullable(num),continues:nullable(str),table:nullable(object({rows:num,columns:num,cells:array(object({row:num,column:num,rowSpan:num,columnSpan:num,text:str}))})),uncertainty:nullable(str),location:nullable(object({x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'},accuracy:{type:'string',enum:['approximate']}}))})),
 relations:array(object({kind:{type:'string',enum:['heading-parent','statement-proof','footnote-callout','caption','table-continuation','bibliography','continuation']},from:str,to:str,uncertain:bool})),
 repairs:array(object({blockId:str,start:num,end:num,original:str,replacement:str,category:str,reason:str})),
});
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
/** Strictly validate untrusted provider data before assigning any trusted IDs or coordinates. */
export function validateSourceIngestionDocument(input:unknown,options:{ownedPages:number[];pageCount:number}):SourceIngestionDocument {
 matches(input,SOURCE_INGESTION_JSON_SCHEMA,'document');
 const doc=input as SourceIngestionDocument;
 if(!Number.isSafeInteger(options.pageCount)||options.pageCount<1)throw new Error('Invalid original page count');
 const requested=new Set(options.ownedPages);
 if(requested.size!==options.ownedPages.length||!requested.size||[...requested].some(p=>!Number.isSafeInteger(p)||p<1||p>options.pageCount))throw new Error('Invalid owned page plan');
 const pages=new Map<number,SourceIngestionDocument['pages'][number]>();
 for(const page of doc.pages){if(page.number<1||page.number>options.pageCount||pages.has(page.number))throw new Error('Duplicate or out of bounds physical page');if((page.role==='owned')!==requested.has(page.number))throw new Error('Page ownership mismatch');pages.set(page.number,page);}
 if([...requested].some(p=>!pages.has(p)))throw new Error('Missing owned physical page');
 const blocks=new Map<string,SourceIngestionDocument['blocks'][number]>(),orders=new Set<string>();let size=0;
 for(const block of doc.blocks){
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
 const edge=(from:string,to:string)=>{const values=continuationEdges.get(from)??[];values.push(to);continuationEdges.set(from,values);};
 for(const block of doc.blocks)if(block.continues){const previous=reference(block.continues);if(!precedes(previous,block))throw new Error('Continuation must point backwards');if(previous.kind!==block.kind||block.kind==='table'&&!compatibleTables(previous,block))throw new Error('Incompatible continued block kinds or table dimensions');edge(previous.id,block.id);}
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
   if(!relation.uncertain){if(tableSuccessors.has(from.id)&&tableSuccessors.get(from.id)!==to.id||tablePredecessors.has(to.id)&&tablePredecessors.get(to.id)!==from.id)throw new Error('Ambiguous definite table continuation');tableSuccessors.set(from.id,to.id);tablePredecessors.set(to.id,from.id);edge(from.id,to.id);}
  }else if(relation.kind==='continuation'){
   if(from.kind!==to.kind||!['paragraph','footnote','list','blockquote','code','bibliography','table'].includes(from.kind)||from.kind==='table'&&!compatibleTables(from,to)||!precedes(from,to))throw new Error('Incompatible continuation kinds or direction');
   if(!relation.uncertain)edge(from.id,to.id);
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
 for(const repair of doc.repairs){const block=reference(repair.blockId);if(repair.start<0||repair.end<=repair.start||repair.end>block.text.length||block.text.slice(repair.start,repair.end)!==repair.original)throw new Error('Repair must match exact UTF-16 source span');for(const at of [repair.start,repair.end])if(at>0&&at<block.text.length&&/[\uD800-\uDBFF]/.test(block.text[at-1]!)&&/[\uDC00-\uDFFF]/.test(block.text[at]!))throw new Error('Repair splits a Unicode surrogate pair');}
 return structuredClone(doc);
}

export interface SourceIngestionFinding {
 kind:'unreadable-region'|'uncertain-block'|'uncertain-relation'|'native-text-anomaly'|'window-boundary';
 pages:number[];blockIds:string[];reason:string;
 /** These are review/targeted-recovery findings, never evidence of a proved correction. */
 independentVerification:false;
}
/** Compare supplied native-layer evidence without requiring native extraction to ingest a PDF. */
export function sourceIngestionRepairFindings(document:SourceIngestionDocument,options:{nativePages?:{page:number;text:string;extractor:string}[];windowBoundaries?:number[]}={}):SourceIngestionFinding[] {
 const findings:SourceIngestionFinding[]=[],blocks=new Map(document.blocks.map(b=>[b.id,b]));
 const byPage=new Map<number,SourceIngestionDocument['blocks']>();for(const block of document.blocks){const list=byPage.get(block.page)??[];list.push(block);byPage.set(block.page,list);}for(const list of byPage.values())list.sort((a,b)=>a.order-b.order);
 for(const page of document.pages){if(page.state==='unreadable'||page.state==='image-only')findings.push({kind:'unreadable-region',pages:[page.number],blockIds:[],reason:page.state==='unreadable'?'Physical page is explicitly unreadable':'Physical page has image-only content without faithful text',independentVerification:false});for(const region of page.unresolved)findings.push({kind:'unreadable-region',pages:[page.number],blockIds:region.blockId?[region.blockId]:[],reason:region.description,independentVerification:false});}
 for(const block of document.blocks)if(block.uncertainty)findings.push({kind:'uncertain-block',pages:[block.page],blockIds:[block.id],reason:block.uncertainty,independentVerification:false});
 for(const relation of document.relations)if(relation.uncertain)findings.push({kind:'uncertain-relation',pages:[...new Set([blocks.get(relation.from)!.page,blocks.get(relation.to)!.page])],blockIds:[relation.from,relation.to],reason:`Unresolved ${relation.kind} relation`,independentVerification:false});
 const words=(text:string)=>new Set(text.normalize('NFKC').toLocaleLowerCase('und').match(/[\p{L}\p{N}]{2,}/gu)??[]);
 for(const native of options.nativePages??[]){if(!native.extractor.trim())throw new Error('Native evidence requires a real extractor identity');const expected=words(native.text);if(expected.size<20)continue;const actual=words((byPage.get(native.page)??[]).map(b=>b.text).join('\n'));const missing=[...expected].filter(w=>!actual.has(w));if(missing.length/expected.size>0.35)findings.push({kind:'native-text-anomaly',pages:[native.page],blockIds:(byPage.get(native.page)??[]).map(b=>b.id),reason:`Native text comparison (${native.extractor}) has ${missing.length} of ${expected.size} distinct words absent; inspect page evidence. Native text can itself be wrong.`,independentVerification:false});}
 for(const first of options.windowBoundaries??[]){const left=byPage.get(first-1)?.at(-1),right=byPage.get(first)?.[0];if(!left||!right)continue;const explicit=document.relations.some(r=>r.from===left.id&&r.to===right.id||r.from===right.id&&r.to===left.id)||right.continues===left.id;if(!explicit&&(left.kind==='table'&&right.kind==='table'||left.kind==='footnote'||right.kind==='footnote'||left.kind==='paragraph'&&right.kind==='paragraph'&&!/[.!?。！？][”"')\]]?\s*$/u.test(left.text)))findings.push({kind:'window-boundary',pages:[first-1,first],blockIds:[left.id,right.id],reason:'Possible continuation across extraction windows; preserve separate exact leaf spans until a bounded evidence review resolves the relation.',independentVerification:false});}
 return findings;
}
