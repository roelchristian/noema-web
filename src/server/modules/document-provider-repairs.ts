import type {SourceIngestionRepair} from '../../shared/source-ingestion.js';
import {SOURCE_INGESTION_REPAIR_CATEGORIES} from './source-ingestion-validation.js';
import {utf16Boundary,wellFormedUnicode} from './source-reprocessing-patches.js';
const string={type:'string'};
export const DOCUMENT_PROVIDER_QUOTED_REPAIR_SCHEMA={
 type:'object',additionalProperties:false,required:['blockId','original','prefix','suffix','replacement','category','reason'],
 properties:{blockId:string,original:{...string,minLength:1,maxLength:8000},prefix:{...string,maxLength:120},suffix:{...string,maxLength:120},replacement:{...string,maxLength:12000},category:{...string,enum:SOURCE_INGESTION_REPAIR_CATEGORIES},reason:{...string,maxLength:2000}},
};
function transcriptionSchema(schema:Record<string,unknown>):boolean{
 const properties=schema.properties;
 return !!properties&&typeof properties==='object'&&!Array.isArray(properties)&&['schemaVersion','metadata','pages','blocks','repairs'].every(key=>Object.hasOwn(properties,key));
}
/** Internal IR retains offsets. Only a fresh full-transcription wire asks for quotes. */
export function documentProviderRepairSchema(schema:Record<string,unknown>):Record<string,unknown>{
 if(!transcriptionSchema(schema))return schema;
 const wire=structuredClone(schema),properties=wire.properties as Record<string,unknown>;
 properties.repairs={type:'array',items:structuredClone(DOCUMENT_PROVIDER_QUOTED_REPAIR_SCHEMA)};
 return wire;
}
/** No offset guessing, normalization, or source-semantic correction. */
export function resolveDocumentProviderQuotedRepair(value:unknown,block:{id:string;text:string},limit=block.text.length):SourceIngestionRepair{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Targeted repair must be an object');
 const item=value as Record<string,unknown>,fields=['blockId','original','prefix','suffix','replacement','category','reason'] as const;
 if(Object.keys(item).some(key=>!fields.includes(key as typeof fields[number]))||fields.some(key=>typeof item[key]!=='string'))throw new Error('Targeted anchored repair has a missing or unexpected field');
 const {blockId,original,prefix,suffix,replacement,category,reason}=item as Record<typeof fields[number],string>;
 if(!original||original.length>8000||prefix.length>120||suffix.length>120||replacement.length>12000||reason.length>2000)throw new Error('Targeted repair exceeds local span budget');
 if(original===replacement)throw new Error('Targeted repair must propose a source-text change');
 if(![original,prefix,suffix,replacement].every(wellFormedUnicode))throw new Error('Targeted repair contains malformed Unicode');
 if(!SOURCE_INGESTION_REPAIR_CATEGORIES.includes(category as typeof SOURCE_INGESTION_REPAIR_CATEGORIES[number]))throw new Error('Unsupported transcription repair category; source-error notes are not repairs');
 if(blockId!==block.id)throw new Error('Repair block identity mismatch');
 const needle=prefix+original+suffix,first=block.text.indexOf(needle);
 if(first<0||block.text.indexOf(needle,first+1)!==-1)throw new Error('Targeted quote and anchors must resolve one unique exact source span');
 const start=first+prefix.length,end=start+original.length;
 if(first<0||end+suffix.length>limit)throw new Error('Targeted repair anchors are outside supplied evidence snippets');
 if([first,start,end,end+suffix.length].some(at=>!utf16Boundary(block.text,at)))throw new Error('Targeted repair splits a Unicode surrogate pair');
 return {blockId,start,end,original,replacement,category,reason};
}
/** Invalid optional proposals must not invalidate a paid, readable transcription.
 * This applies only at fresh provider ingress; authoritative/retained offset IR
 * continues through its original strict validator, without any conversion. */
export function normalizeDocumentProviderRepairs(input:unknown,schema:Record<string,unknown>):unknown{
 if(!transcriptionSchema(schema)||!input||typeof input!=='object'||Array.isArray(input))return input;
 const result=structuredClone(input) as Record<string,unknown>;
 if(!Array.isArray(result.blocks))return result;
 const blocks=result.blocks.filter((block):block is Record<string,unknown>=>!!block&&typeof block==='object'&&!Array.isArray(block));
 const index=new Map<string,{id:string;text:string;raw:Record<string,unknown>}>(),duplicates=new Set<string>();
 for(const block of blocks){if(typeof block.id!=='string'||typeof block.text!=='string')continue;if(index.has(block.id))duplicates.add(block.id);index.set(block.id,{id:block.id,text:block.text,raw:block});}
 const note=(block:Record<string,unknown>|undefined,message:string)=>{if(!block||!(block.uncertainty===null||typeof block.uncertainty==='string'))return;const text='Optional transcription repair omitted: '+message+' The original source text is retained.';if(typeof block.uncertainty==='string'&&block.uncertainty.includes(text))return;block.uncertainty=[typeof block.uncertainty==='string'?block.uncertainty:null,text].filter(Boolean).join(' ');};
 const proposals=result.repairs;
 if(!Array.isArray(proposals)||proposals.length>64){result.repairs=[];note(blocks[0],Array.isArray(proposals)?'the response exceeded the 64-proposal limit.':'the repair list was not an array.');return result;}
 const repairs:SourceIngestionRepair[]=[];
 for(const proposal of proposals){
  const item=proposal&&typeof proposal==='object'&&!Array.isArray(proposal)?proposal as Record<string,unknown>:null;
  const target=typeof item?.blockId==='string'?index.get(item.blockId):undefined;
  try{
   if(!target||duplicates.has(target.id))throw new Error('Repair block identity is missing or ambiguous.');
   // Fresh offsets are not trusted; old retained candidates bypass this ingress.
   if(Object.hasOwn(item!,'start')||Object.hasOwn(item!,'end'))throw new Error('Fresh proposals must quote source text and adjacent anchors instead of supplying character offsets.');
   repairs.push(resolveDocumentProviderQuotedRepair(item,target));
  }catch(error){note(target?.raw??blocks[0],error instanceof Error?error.message:'Invalid quotation anchors.');}
 }
 const conflicting=new Set<SourceIngestionRepair>();
 const byBlock=new Map<string,SourceIngestionRepair[]>();for(const repair of repairs){const list=byBlock.get(repair.blockId)??[];list.push(repair);byBlock.set(repair.blockId,list);}
 for(const [id,list] of byBlock){const ordered=list.slice().sort((a,b)=>a.start-b.start||a.end-b.end);let previous:SourceIngestionRepair|undefined;for(const repair of ordered){if(previous&&repair.start<previous.end){conflicting.add(previous);conflicting.add(repair);note(index.get(id)?.raw,'overlapping proposals do not identify independent source spans.');}if(!previous||repair.end>previous.end)previous=repair;}}
 result.repairs=repairs.filter(repair=>!conflicting.has(repair));return result;
}
