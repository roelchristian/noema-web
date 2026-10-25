import {sourceDocumentEntries,type SourceDocument} from '../../shared/source-document.js';
import type {SourceAcceptanceMode,SourceEditorialPatch,SourceReprocessingEvidenceSnapshot} from '../../shared/source-reprocessing.js';

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
export function evaluateV2Acceptance(input:Omit<Input,'policy'|'threshold'|'confidence'|'legacyRisks'> & {policy:'verified'|'review_all';evidence?:SourceReprocessingEvidenceSnapshot}):{automatic:boolean;reasons:string[];checks:string[]}{
 const {text,document,start,end,original,replacement,category,policy}=input;
 const checks:string[]=[],reasons:string[]=[];
 if(policy!=='verified')return {automatic:false,reasons:['Review all changes policy.'],checks};
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>text.length||text.slice(start,end)!==original)reasons.push('Exact canonical coordinates are unavailable.');else checks.push('exact-canonical-substring');
 // These glyph substitutions are mechanical equivalents, not spelling guesses.
 // Keep word boundaries, numbers, punctuation identity and source ordering exact.
 const typography=(value:string)=>value.replace(/ﬁ/g,'fi').replace(/ﬂ/g,'fl').replace(/ﬀ/g,'ff').replace(/ﬃ/g,'ffi').replace(/ﬄ/g,'ffl').replace(/ﬅ/g,'st').replace(/ﬆ/g,'st').replace(/(?<=\p{L})\u00ad(?=\p{L})/gu,'').replace(/[\u00a0\u202f]/g,' ');
 if(!reasons.length&&['formatting','ocr'].includes(category)&&original!==replacement&&typography(original)===replacement)return {automatic:true,reasons:[],checks:[...checks,'exact-ligature-soft-hyphen-or-nonbreaking-space-equivalence']};
 // A heading already recorded in canonical structure can receive its Markdown
 // presentation without asking the model to prove the same title again. Check
 // the complete source line, including edits whose diff contains only '# '.
 const headingLineStart=text.lastIndexOf('\n',start-1)+1,headingLineEnd=text.indexOf('\n',end);
 const headingLine=text.slice(headingLineStart,headingLineEnd<0?text.length:headingLineEnd);
 const proposedHeading=text.slice(headingLineStart,start)+replacement+text.slice(end,headingLineEnd<0?text.length:headingLineEnd);
 const supportedHeading=sourceDocumentEntries(document).some(({node,path})=>['chapter','section','subsection','heading'].includes(node.kind)&&node.range.startOffset===headingLineStart&&node.title===headingLine.trim()&&!path.some(parent=>['code','equation','footnote','table','list','blockquote'].includes(parent.kind)));
 if(!reasons.length&&['formatting','ocr'].includes(category)&&supportedHeading&&document.physical.pages.filter(page=>page.range.startOffset<=headingLineStart&&page.range.endOffset>=headingLineStart+headingLine.length).length===1&&/^#{1,6} /.test(proposedHeading)&&proposedHeading.replace(/^#{1,6} /,'')===headingLine&&!/[\r\n]/.test(headingLine+replacement))return {automatic:true,reasons:[],checks:[...checks,'exact-canonical-heading-title','heading-markup-only','single-physical-page']};
 const nodes=sourceDocumentEntries(document).filter(({node})=>node.range.startOffset<=start&&node.range.endOffset>=end&&node.kind==='paragraph');
 const node=nodes.length===1?nodes[0]:undefined;
 if(!node||node.path.some(parent=>['blockquote','code','equation','footnote','table','list'].includes(parent.kind)))reasons.push('Exact ordinary-prose mapping is unavailable.');else checks.push('ordinary-prose-mapping');
 if(document.physical.pages.filter(page=>page.range.startOffset<=start&&page.range.endOffset>=end).length!==1)reasons.push('Exact physical page mapping is unavailable.');else checks.push('single-physical-page');
 const headings=sourceDocumentEntries(document).filter(({node})=>node.title&&node.range.startOffset<=start).sort((a,b)=>b.node.range.startOffset-a.node.range.startOffset);
 if([headings[0]?.node.title,...(node?.path.map(parent=>parent.title)??[])].some(title=>title&&/bibliograph|references|works cited|sources cited|literature cited/i.test(title)))reasons.push('Bibliographic context requires source review.');
 const passage=node?text.slice(node.node.range.startOffset,node.node.range.endOffset):original;
 // Layout reconstruction is independently checkable against the exact text: only
 // whitespace may change, with every word, punctuation mark and word boundary kept.
 const proseLayout=['formatting','line_breaks'].includes(category)&&original.replace(/[ \t\r\n]+/g,' ')===replacement.replace(/[ \t\r\n]+/g,' ');
 const structuralSyntax=/^[ \t]*(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|```|~~~|\[\^|\$\$|\\\[)/m;
 // Punctuation spacing is an extraction/layout repair, even when removing a
 // space changes a token boundary. Check the complete passage so a tiny diff
 // cannot hide a decimal, citation, code fragment, or a joined pair of words.
 const proposed=node?text.slice(node.node.range.startOffset,start)+replacement+text.slice(end,node.node.range.endOffset):replacement;
 const punctuationSpacing=(value:string)=>value.replace(/(?<=\p{L})[ \t]+([,;:!?])/gu,'$1').replace(/([,;:!?])(?=\p{L})/gu,'$1 ');
 const spacingDefects=(value:string)=>[...value.matchAll(/(?<=\p{L})[ \t]+([,;:!?])|([,;:!?])(?=\p{L})/gu)].length;
 const uncertainPunctuation=/[\d'"“”‘’«»„‟`*_#|<>\[\]{}\\$=+^~]|https?:|\b(?:doi|ISBN)\b/iu;
 if(!reasons.length&&['formatting','line_breaks','ocr'].includes(category)&&original!==replacement&&!structuralSyntax.test(passage)&&!uncertainPunctuation.test(passage+proposed)&&punctuationSpacing(passage)===punctuationSpacing(proposed)&&spacingDefects(proposed)<spacingDefects(passage))return {automatic:true,reasons:[],checks:[...checks,'exact-prose-punctuation-spacing-repair','identical-letters-punctuation-order']};
 if(!reasons.length&&proseLayout&&original&&replacement&&!/[\t]|\r(?!\n)| {2,}\r?\n/.test(original+replacement)&&!/ {2,}\r?\n/.test(passage)&&!structuralSyntax.test(passage+'\n'+replacement)&&!/[|`$\\]/.test(passage+replacement))return {automatic:true,reasons:[],checks:[...checks,'identical-words-punctuation-order','prose-whitespace-layout-only']};
 if(!reasons.length&&node&&independentMechanicalEvidence(input,node.node.range.startOffset,node.node.range.endOffset))return {automatic:true,reasons:[],checks:[...checks,'trusted-native-page-to-separate-raster-OCR','unique-whole-prose-line-alignment','high-confidence-without-alternative-readings','narrow-mechanical-repair-only']};
 if(category!=='formatting'||!original||!replacement||original.replace(/[ \t]+/g,' ')!==replacement.replace(/[ \t]+/g,' ')||/[\r\n]/.test(original+replacement))reasons.push('Substantive, line-boundary, OCR, or apparatus changes lack independent source evidence.');else checks.push('identical-characters-except-horizontal-spacing');
 if(/[0-9'"“”‘’«»„‟`*_#|<>\[\]{}\\$=+^~]/.test(passage+replacement)||/https?:|\b(?:pp?\.|doi|ISBN)\b/i.test(passage+replacement))reasons.push('Quotation, mathematics, citation, bibliography, or structured content requires review.');
 if(/^[ \t]|[ \t]$/.test(original)||/^[ \t]|[ \t]$/.test(replacement))reasons.push('Whitespace at a boundary can change document structure.');
 return {automatic:reasons.length===0,reasons:[...new Set(reasons)],checks};
}

/** Evidence may prove a narrow mechanical operation, never a substantive editorial
 * rewrite. Align the entire unique canonical prose node, not a replacement fragment. */
function independentMechanicalEvidence(input:{text:string;document:SourceDocument;start:number;end:number;original:string;replacement:string;category:SourceEditorialPatch['category'];evidence?:SourceReprocessingEvidenceSnapshot},nodeStart:number,nodeEnd:number):boolean{
 const evidence=input.evidence;if(!evidence?.pages?.length||!evidence.ocr.available)return false;
 const raw=input.text.slice(nodeStart,nodeEnd),passage=raw.trim(),proposed=(input.text.slice(nodeStart,input.start)+input.replacement+input.text.slice(input.end,nodeEnd)).trim();
 if(passage.length<20||passage.split(/\s+/).length<4||/[0-9'"“”‘’«»„‟`*_#|<>\[\]{}\\$=+^~]/.test(passage+proposed)||/https?:|\b(?:pp?\.|doi|ISBN)\b/i.test(passage+proposed))return false;
 // Restrict native/OCR differences to documented extraction mechanics, not spelling.
 const ligatures=(value:string)=>value.replace(/ﬁ/g,'fi').replace(/ﬂ/g,'fl').replace(/ﬀ/g,'ff').replace(/ﬃ/g,'ffi').replace(/ﬄ/g,'ffl');
 const wrapped=input.category==='line_breaks'&&!/ {2,}\r?\n|\n[ \t]*\n|(?:^|\n)[ \t]/.test(raw)&&!/ {2,}\r?\n|\\\r?\n|(?:^|\n)[ \t]/.test(input.original)&&input.original.includes('\n')&&!input.replacement.includes('\n')&&!/\n[ \t]*\n/.test(input.original)&&input.original.replace(/\r?\n/g,' ')===input.replacement;
 const ocr=input.category==='ocr'&&(ligatures(input.original)===input.replacement&&input.original!==input.replacement||input.original==='rn'&&input.replacement==='m');
 if(!wrapped&&!ocr)return false;
 const page=input.document.physical.pages.find(value=>value.range.startOffset<=nodeStart&&value.range.endOffset>=nodeEnd);if(!page)return false;
 const pageEvidence=evidence.pages.find(value=>value.page===page.number),proof=pageEvidence?.ocr;
 const passageStart=nodeStart+raw.indexOf(passage),passageEnd=passageStart+passage.length;
 if(!pageEvidence?.canonicalRanges?.some(range=>range.startOffset<=passageStart&&range.endOffset>=passageEnd))return false;
 if(!proof?.independent||proof.engine!=='AppleVision'||!proof.version||!proof.configuration.includes('languageCorrection=false'))return false;
 const canonicalPage=input.text.slice(page.range.startOffset,page.range.endOffset),at=canonicalPage.indexOf(passage);
 if(at<0||canonicalPage.indexOf(passage,at+1)!==-1||!evidence.canonicalText.includes(raw))return false;
 const region=pageEvidence.canonicalRegions?.find(region=>region.startOffset===passageStart&&region.endOffset===passageEnd);if(!region)return false;
 const matches=proof.lines.filter(line=>line.text===proposed);
 if(matches.length!==1)return false;const line=matches[0]!;
 if(proof.lines.some(other=>other!==line&&geometricallyAligned(region.bounds,other.bounds)))return false;
 return geometricallyAligned(region.bounds,line.bounds)&&line.confidence>=0.99&&line.alternatives.every(value=>value===line.text)&&line.bounds.length===4&&line.bounds.every(value=>Number.isFinite(value)&&value>=0&&value<=1)&&line.bounds[2]!>0&&line.bounds[3]!>0;
}

function geometricallyAligned(a:number[],b:number[]):boolean{
 if(a.length!==4||b.length!==4||[...a,...b].some(value=>!Number.isFinite(value)||value<0||value>1)||a[2]!<=0||a[3]!<=0||b[2]!<=0||b[3]!<=0)return false;
 const width=Math.max(0,Math.min(a[0]!+a[2]!,b[0]!+b[2]!)-Math.max(a[0]!,b[0]!)),height=Math.max(0,Math.min(a[1]!+a[3]!,b[1]!+b[3]!)-Math.max(a[1]!,b[1]!));
 const area=width*height;return area/(a[2]!*a[3]!)>=0.8&&area/(b[2]!*b[3]!)>=0.8;
}
