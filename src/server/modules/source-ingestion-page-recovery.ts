import type {SourceDocument} from '../../shared/source-document.js';
import type {SourceIngestionDocument} from '../../shared/source-ingestion.js';
import type {SourceIngestionPageRecoveryDescriptor} from '../../shared/source-reprocessing.js';
import {validateSourceIngestionDocument} from './source-ingestion-validation.js';

/** Keep a recovery inside the existing exact-patch review and backup budgets. */
export const SOURCE_INGESTION_PAGE_RECOVERY_MAX_CHARACTERS=16_000;

export function sourceIngestionPageRecoveryInsertion(original:{text:string;document:SourceDocument},page:number) {
 const physical=original.document.physical.pages.find(value=>value.number===page);
 const evidence=original.document.ingestion?.pages.find(value=>value.number===page);
 if(!Number.isSafeInteger(page)||!physical||!evidence||!['unreadable','image-only'].includes(evidence.state))throw new Error('Only a wholly unreadable or image-only physical page can use missing-page recovery.');
 const marker=`<!-- Page ${page} -->`,startOffset=physical.range.startOffset+marker.length,endOffset=physical.range.endOffset;
 if(original.text.slice(physical.range.startOffset,startOffset)!==marker)throw new Error('Missing-page recovery requires an exact locally assigned physical page marker.');
 const separator=original.text.slice(startOffset,endOffset);
 if(!separator||!/^\n[ \t\n]*$/.test(separator)||original.document.ingestion!.blocks.some(block=>block.page===page&&block.text.trim()))throw new Error('Missing-page recovery cannot replace existing source prose or a page marker.');
 return {startOffset,endOffset,original:separator};
}

/** All recovered block offsets and paragraph separators are assigned locally. */
export function sourceIngestionPageRecoveryContent(input:SourceIngestionDocument,page:number,pageCount:number) {
 if(input.pages.length!==1||input.pages[0]?.number!==page||input.pages[0]?.role!=='owned')throw new Error('Page recovery must account for exactly the selected physical page.');
 const document=validateSourceIngestionDocument(input,{ownedPages:[page],pageCount});
 if(document.pages[0]!.state!=='content'||!document.blocks.some(block=>block.text.trim()))throw new Error('Page recovery returned no readable transcription.');
 const blocks=[...document.blocks].sort((a,b)=>a.order-b.order);
 let replacement='\n';
 const offsets=blocks.map(block=>{const start=replacement.length;replacement+=block.text+'\n\n';return {block,start,end:start+block.text.length};});
 if(replacement.length>SOURCE_INGESTION_PAGE_RECOVERY_MAX_CHARACTERS||Buffer.byteLength(JSON.stringify(document))>256_000)throw new Error('Recovered page exceeds the bounded manual-review budget.');
 return {document,replacement,offsets};
}

/** Archives cannot turn a gap marker or model geometry into original-source proof. */
export function validateSourceIngestionPageRecoveryDescriptor(value:unknown,original:{text:string;document:SourceDocument}):SourceIngestionPageRecoveryDescriptor {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid missing-page recovery descriptor.');
 const descriptor=value as SourceIngestionPageRecoveryDescriptor;
 if(Object.keys(descriptor).some(key=>!['version','page','patchId','extractionId','responseHash','insertion','document'].includes(key))||descriptor.version!==1||typeof descriptor.patchId!=='string'||!descriptor.patchId||descriptor.patchId.length>100||typeof descriptor.extractionId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(descriptor.extractionId)||typeof descriptor.responseHash!=='string'||!/^[a-f0-9]{64}$/.test(descriptor.responseHash))throw new Error('Invalid missing-page recovery identity.');
 const expected=sourceIngestionPageRecoveryInsertion(original,descriptor.page),insertion=descriptor.insertion;
 if(!insertion||typeof insertion!=='object'||Array.isArray(insertion)||Object.keys(insertion).some(key=>!['startOffset','endOffset','original'].includes(key))||insertion.startOffset!==expected.startOffset||insertion.endOffset!==expected.endOffset||insertion.original!==expected.original)throw new Error('Missing-page recovery insertion does not match the exact local page separator.');
 sourceIngestionPageRecoveryContent(descriptor.document,descriptor.page,original.document.physical.pageCount!);
 return structuredClone(descriptor);
}
