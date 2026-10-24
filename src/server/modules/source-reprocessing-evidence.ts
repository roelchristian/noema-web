import {createHash} from 'node:crypto';
import type {SourceDocument} from '../../shared/source-document.js';
import type {SourceReprocessingConfiguration} from '../../shared/source-reprocessing.js';

export interface ReconstructionEvidence {
 hash:string;canonicalText:string;pageNumbers:number[];
 originalPages:{available:false;reason:string};ocr:{available:false;reason:string};
 /** Absence is deliberate: a second model opinion cannot populate verified source evidence. */
 independentlyVerified:false;externalTransmissionAllowed:false;diagnostics:string[];
}
/** Current renderer supplies viewing assets only. Never imply OCR or image capability, nor
 * send original assets merely because a source is admitted for local reading. */
export function gatherReprocessingEvidence(input:{text:string;document:SourceDocument;start:number;end:number;options?:SourceReprocessingConfiguration['evidence']}):ReconstructionEvidence{
 const {text,document,start,end,options}=input;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>text.length)throw new Error('Invalid evidence coordinates.');
 const canonicalText=text.slice(start,end),pageNumbers=document.physical.pages.filter(page=>page.range.startOffset<end&&page.range.endOffset>start).map(page=>page.number);
 const originalPages={available:false as const,reason:options?.originalPages?'Original-page model evidence adapter is unavailable; local viewing does not grant transmission consent.':'Original-page evidence was not requested.'};
 const ocr={available:false as const,reason:options?.ocr?'No independent OCR evidence adapter is available. Stored extraction is not independent OCR corroboration.':'Independent OCR evidence was not requested.'};
 const diagnostics=[originalPages.reason,ocr.reason];
 if(options?.allowExternalTransmission)diagnostics.push('External original-asset transmission is unavailable in this pipeline; no assets were transmitted.');
 const hash=createHash('sha256').update(JSON.stringify({canonicalText,pageNumbers,originalPages,ocr,version:1})).digest('hex');
 return {hash,canonicalText,pageNumbers,originalPages,ocr,independentlyVerified:false,externalTransmissionAllowed:false,diagnostics};
}
