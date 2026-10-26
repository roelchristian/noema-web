import type {SourceIngestionOptions} from '../../shared/source-ingestion.js';
import {documentModel} from '../../shared/document-models.js';
import {HttpError} from '../validation.js';
export function parseSourceIngestionOptions(input:unknown):SourceIngestionOptions {
 const fail=():never=>{throw new HttpError(400,'Invalid PDF processing configuration.');};
 if(!input||typeof input!=='object'||Array.isArray(input))return fail();
 const v=input as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['route','model','depth','reviewPolicy','containsMath','guidance','transmissionConsent','budget'].includes(k)))return fail();
 if(!['local','openai','gemini'].includes(String(v.route))||!['light','balanced','deep'].includes(String(v.depth))||!['verified','review-all'].includes(String(v.reviewPolicy))||typeof v.containsMath!=='boolean'||typeof v.transmissionConsent!=='boolean'||typeof v.guidance!=='string'||v.guidance.length>4000)return fail();
 if(v.route==='local'?v.model!==null:typeof v.model!=='string'||documentModel(v.model)?.provider!==v.route)return fail();
 if(v.route!=='local'&&!v.transmissionConsent)throw new HttpError(400,'Authorize sending the PDF itself to the selected provider.');
 const b=v.budget as Record<string,unknown>|null;
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['maxRequests','maxOutputTokens','maxCostUsd'].includes(k))||!Number.isSafeInteger(b.maxRequests)||(b.maxRequests as number)<1||(b.maxRequests as number)>1000||!Number.isSafeInteger(b.maxOutputTokens)||(b.maxOutputTokens as number)<128||(b.maxOutputTokens as number)>102400||b.maxCostUsd!==null&&(typeof b.maxCostUsd!=='number'||!Number.isFinite(b.maxCostUsd)||b.maxCostUsd<=0||b.maxCostUsd>10000))return fail();
 return structuredClone(v) as unknown as SourceIngestionOptions;
}
