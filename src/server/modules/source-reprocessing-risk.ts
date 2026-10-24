import {sourceDocumentEntries,type SourceDocument} from '../../shared/source-document.js';
import type {SourceAcceptanceMode,SourceEditorialPatch} from '../../shared/source-reprocessing.js';

export const editorialRiskValidator='canonical-layout-v2';
type Input={text:string;document:SourceDocument;start:number;end:number;original:string;replacement:string;category:SourceEditorialPatch['category'];confidence:number;threshold:number|undefined;policy:SourceAcceptanceMode|undefined;legacyRisks:string[]};
/** All evidence comes from the immutable snapshot. Model reasons and confidence cannot prove an invariant. */
export function evaluateEditorialAcceptance(input:Input):{automatic:boolean;reasons:string[];checks:string[]} {
 const {text,document,start,end,original,replacement,category,confidence,threshold,policy,legacyRisks}=input;
 const reasons:string[]=[],checks:string[]=[];
 if(policy==='review_all'||policy===undefined)return {automatic:false,reasons:legacyRisks,checks};
 if(!['balanced','minimal_review','safe_formatting'].includes(policy))return {automatic:false,reasons:['Acceptance policy is unknown; manual review is required.'],checks};
 if(policy==='safe_formatting')reasons.push(...legacyRisks);
 else reasons.push('Independent passage-language evidence is unavailable; source-level language metadata cannot exclude foreign-language passages. Manual review is required.');
 if(!Number.isFinite(threshold)||threshold===undefined||threshold<0||threshold>1||!Number.isFinite(confidence)||confidence<threshold||confidence>1)reasons.push('Confidence does not meet the explicit policy threshold.');
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>text.length||text.slice(start,end)!==original)reasons.push('Exact canonical coordinates are unavailable.');
 else checks.push('exact-canonical-substring');
 if(!['formatting','line_breaks'].includes(category))reasons.push(category==='ocr'?'No independently verified source evidence for this OCR substitution.':'Content or scholarly apparatus requires source comparison.');
 const covering=sourceDocumentEntries(document).filter(({node})=>node.text!==undefined&&node.range.startOffset<=start&&node.range.endOffset>=end);
 const passage=covering.length===1?covering[0]:undefined;
 const rawPassage=passage?text.slice(passage.node.range.startOffset,passage.node.range.endOffset):undefined;
 const exactPassage=rawPassage!==undefined&&(passage?.node.text===rawPassage||passage?.node.text===rawPassage.replace(/\r\n?/g,'\n').trim().replace(/\s*\n\s*/g,' '));
 if(!passage||passage.node.kind!=='paragraph'||passage.path.some(node=>['blockquote','code','equation','footnote','table','list'].includes(node.kind))||!exactPassage)reasons.push('A single exact prose passage mapping is required.');
 else checks.push('exact-prose-node');
 const pages=document.physical.pages.filter(page=>page.range.startOffset<=start&&page.range.endOffset>=end);
 if(pages.length!==1||document.physical.pages.some(page=>page.range.startOffset>start&&page.range.startOffset<end))reasons.push('Physical page mapping is missing or uncertain.');
 else checks.push('single-physical-page');
 const context=rawPassage??original;
 // These are intentionally conservative: printed content and uncertain language stay reviewable.
 if(/[0-9'"“”‘’«»„‟`*_#|<>\[\]{}\\$=+^~]/.test(context+replacement)||/https?:|\b(?:pp?\.|doi|ISBN)\b/i.test(context+replacement))reasons.push('Quotation, number, citation, mathematics, or marked-up content requires manual review.');
 if(!/^(?:en(?:[-_][A-Za-z]+)?|english)$/i.test(document.source.language??'')||/[^\x00-\x7f]/.test(context+replacement))reasons.push('Language evidence is missing or includes potentially foreign-language text.');
 if(!original||!replacement||original.trim()!==original||replacement.trim()!==replacement||/\t|\r(?!\n)|\n[ \t]*\n|(?:^|\n)[ \t]/.test(original+replacement))reasons.push('Indentation, paragraph boundaries, or deletion may change structure.');
 const normalize=(value:string)=>value.replace(/\r\n/g,'\n').replace(/\n/g,' ').replace(/ +/g,' ');
 if(normalize(original)!==normalize(replacement))reasons.push('The exact word, punctuation, and ordering invariant is not preserved.');
 else checks.push('identical-words-punctuation-order');
 if(original.includes('\n')||replacement.includes('\n')){
  // Only collapse existing soft prose wraps; creating new lines or word joins is not proven safe.
  if(/ {2,}\r?\n/.test(original)||replacement.includes('\n')||!/[A-Za-z][ ]*\r?\n[A-Za-z]/.test(original)||original.replace(/[A-Za-z][ ]*\r?\n(?=[A-Za-z])/g,'').includes('\n'))reasons.push('Line wrap is not a proven prose boundary.');
  else checks.push('existing-soft-wrap-only');
 }
 return {automatic:reasons.length===0,reasons:[...new Set(reasons)],checks};
}

/** V2 Verified is deliberately independent of the legacy acceptance modes. The model's
 * confidence, fluency and subsequent approval never constitute original-source evidence. */
export function evaluateV2Acceptance(input:Omit<Input,'policy'|'threshold'|'confidence'|'legacyRisks'> & {policy:'verified'|'review_all'}):{automatic:boolean;reasons:string[];checks:string[]}{
 const {text,document,start,end,original,replacement,category,policy}=input;
 const checks:string[]=[],reasons:string[]=[];
 if(policy!=='verified')return {automatic:false,reasons:['Review all changes policy.'],checks};
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>text.length||text.slice(start,end)!==original)reasons.push('Exact canonical coordinates are unavailable.');else checks.push('exact-canonical-substring');
 const nodes=sourceDocumentEntries(document).filter(({node})=>node.range.startOffset<=start&&node.range.endOffset>=end&&node.kind==='paragraph');
 const node=nodes.length===1?nodes[0]:undefined;
 if(!node||node.path.some(parent=>['blockquote','code','equation','footnote','table','list'].includes(parent.kind)))reasons.push('Exact ordinary-prose mapping is unavailable.');else checks.push('ordinary-prose-mapping');
 if(document.physical.pages.filter(page=>page.range.startOffset<=start&&page.range.endOffset>=end).length!==1)reasons.push('Exact physical page mapping is unavailable.');else checks.push('single-physical-page');
 const passage=node?text.slice(node.node.range.startOffset,node.node.range.endOffset):original;
 if(category!=='formatting'||!original||!replacement||original.replace(/[ \t]+/g,' ')!==replacement.replace(/[ \t]+/g,' ')||/[\r\n]/.test(original+replacement))reasons.push('Substantive, line-boundary, OCR, or apparatus changes lack independent source evidence.');else checks.push('identical-characters-except-horizontal-spacing');
 if(/[0-9'"“”‘’«»„‟`*_#|<>\[\]{}\\$=+^~]/.test(passage+replacement)||/https?:|\b(?:pp?\.|doi|ISBN)\b/i.test(passage+replacement))reasons.push('Quotation, mathematics, citation, bibliography, or structured content requires review.');
 if(/^[ \t]|[ \t]$/.test(original)||/^[ \t]|[ \t]$/.test(replacement))reasons.push('Whitespace at a boundary can change document structure.');
 return {automatic:reasons.length===0,reasons:[...new Set(reasons)],checks};
}
