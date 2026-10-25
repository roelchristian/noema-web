import test from 'node:test';
import assert from 'node:assert/strict';
import {planReprocessingChunks} from '../src/server/modules/source-reprocessing-planner.ts';
import {reconstructBlocks,boundedReconstructionDiff} from '../src/server/modules/source-reprocessing-diff.ts';
import {groupApparatusPatches,assertAtomicPatchGroups,apparatusProblems,acceptVerifiedFootnoteFormatting,discoverCanonicalFootnotes,recoverCanonicalFootnoteDefinitions} from '../src/server/modules/source-reprocessing-apparatus.ts';
import {detectPageFurniture,presentWithoutFurniture} from '../src/server/modules/source-reprocessing-furniture.ts';
test('reference and definition repairs are atomic and cannot autoaccept',()=>{
 const chunk=planReprocessingChunks('word[^1]\n\n[^1]: note',{physical:{pages:[]}})[0];
 const mapped=reconstructBlocks(chunk,{blocks:chunk.blocks.map(block=>({id:block.id,text:block.text.replaceAll('[^1]','[^p1-1]')}))});
 assert.ok(mapped.patches.every(patch=>patch.original.includes('[^1]')&&patch.replacement.includes('[^p1-1]')));
 const patches=[{id:'ref',original:'word[^1]',replacement:'word[^p1-1]',decision:'accepted'},{id:'def',original:'[^1]: note',replacement:'[^p1-1]: note',decision:'accepted'}];
 groupApparatusPatches(patches);assert.equal(patches[0].patchGroupId,patches[1].patchGroupId);assert.equal(patches[0].decision,'pending');
 patches[0].decision='accepted';assert.throws(()=>assertAtomicPatchGroups(patches),/together/);patches[1].decision='accepted';assert.doesNotThrow(()=>assertAtomicPatchGroups(patches));
 groupApparatusPatches(patches);assert.ok(patches.every(patch=>patch.decision==='accepted'),'unchanged groups retain reviewed decisions on resume');
 patches.push({id:'extra',original:'another[^p1-1]',replacement:'another[^p1-1] changed',decision:'pending'});groupApparatusPatches(patches);
 assert.ok(patches.every(patch=>patch.decision==='pending'));assert.equal(patches[0].decisionHistory.at(-1).from,'accepted');assert.match(patches[0].riskReasons.at(-1),/complete group/);
 assert.equal(apparatusProblems('word','word[^missing]').length,1);
});
test('repeated boundary lines are reversible presentation suggestions over unchanged canonical offsets',()=>{
 const pages=['HEADER\nFirst body.\n','HEADER\nSecond body.\n','HEADER\nThird body.\n'];let at=0;
 const document={physical:{pages:pages.map((text,index)=>{const start=at;at+=text.length;return {number:index+1,range:{startOffset:start,endOffset:at}};})}};const text=pages.join('');
 const candidates=detectPageFurniture(text,document);assert.equal(candidates.length,3);assert.ok(candidates.every(item=>!item.hidden));assert.equal(presentWithoutFurniture(text,candidates),text);
 const hidden=candidates.map(item=>({...item,hidden:true}));assert.equal(presentWithoutFurniture(text,hidden),'\nFirst body.\n\nSecond body.\n\nThird body.\n');
 assert.equal(text,pages.join(''));assert.throws(()=>presentWithoutFurniture('different',hidden),/no longer matches/);
 assert.equal(detectPageFurniture(pages.slice(0,2).join(''),{physical:{pages:document.physical.pages.slice(0,2)}}).length,0);
});


test('numeric furniture patterns retain multiline headers and page labels without hiding numbered prose',()=>{
 const pages=Array.from({length:3},(_,index)=>`Journal proceedings 202${index}\nVolume of collected research ${index+1}\nDistinct passage ${index+1}.\nPage ${index+1}\n`);
 let at=0;const document={physical:{pages:pages.map((text,index)=>{const startOffset=at;at+=text.length;return {number:index+1,range:{startOffset,endOffset:at}};})}};
 const text=pages.join(''),candidates=detectPageFurniture(text,document);
 assert.equal(candidates.length,9);
 for(const page of document.physical.pages){
  const items=candidates.filter(item=>item.page===page.number);
  assert.equal(items.length,3);assert.ok(items.every(item=>!item.hidden));
  assert.ok(items.some(item=>item.text===`Journal proceedings 202${page.number-1}`&&item.kind==='header'));
  assert.ok(items.some(item=>item.text===`Volume of collected research ${page.number}`&&item.kind==='header'));
  assert.ok(items.some(item=>item.text===`Page ${page.number}`&&item.kind==='footer'));
 }
 const reading=presentWithoutFurniture(text,candidates.map(item=>({...item,hidden:true})));
 for(let page=1;page<=3;page++)assert.ok(reading.includes(`Distinct passage ${page}.`));
});


const applyDifferences=(original,replacement,spans)=>[...spans].reverse().reduce((text,span)=>text.slice(0,span.start)+replacement.slice(span.newStart,span.newEnd)+text.slice(span.end),original);
test('granular differences isolate independent scholarly repairs and preserve Unicode graphemes',()=>{
 const original='“Quotatlon” 😀 remains; a technical tenn occurs elsewhere; formula $x=1$ and élan.';
 const replacement=original.replace('Quotatlon','Quotation').replace('tenn','term').replace('élan','élan');
 const chunk=planReprocessingChunks(original,{physical:{pages:[]}})[0];
 const result=reconstructBlocks(chunk,{blocks:[{id:chunk.blocks[0].id,text:replacement}]});
 assert.equal(result.patches.length,3);
 const actual=[...result.patches].reverse().reduce((text,patch)=>text.slice(0,patch.startOffset)+patch.replacement+text.slice(patch.endOffset),original);
 assert.equal(actual,replacement);assert.ok(result.patches.every(patch=>!patch.original.includes('$x=1$')&&!patch.original.includes('😀')));
 assert.equal(result.patches[2].original,'é');assert.equal(result.patches[2].replacement,'é');
 const spacing=boundedReconstructionDiff('Ordinary  prose follows.','Ordinary prose follows.');
 assert.equal(spacing.length,1);assert.equal('Ordinary  prose follows.'.slice(spacing[0].start,spacing[0].end),'y  p');
});
test('only changed apparatus labels join atomic groups, leaving unrelated repairs independent',()=>{
 const original='Typo reacl; see[^old] with much unchanged prose.\n\n[^old]: Citation.';
 const chunk=planReprocessingChunks(original,{physical:{pages:[]}})[0];
 const result=reconstructBlocks(chunk,{blocks:chunk.blocks.map(block=>({id:block.id,text:block.text.replace('reacl','read').replaceAll('[^old]','[^new]')}))});
 assert.equal(result.patches.length,3);
 const patches=result.patches.map((patch,index)=>({...patch,id:String(index),decision:'pending'}));groupApparatusPatches(patches);
 assert.equal(patches[0].patchGroupId,undefined);assert.equal(patches[1].patchGroupId,patches[2].patchGroupId);
 assert.ok(patches[1].original.includes('[^old]')&&patches[1].replacement.includes('[^new]'));
});
test('bounded Unicode diff roundtrips deterministic adversarial edits including apparatus',()=>{
 let seed=4;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296),alphabet=['a','b','c',' ','😀','é','\n','[^x]'];
 const boundary=(text)=>new Set([0,...[...new Intl.Segmenter('und',{granularity:'grapheme'}).segment(text)].map(value=>value.index+value.segment.length)]);
 for(let sample=0;sample<600;sample++){
  const tokens=Array.from({length:80},()=>alphabet[Math.floor(random()*alphabet.length)]),original=tokens.join('');
  for(let edit=0;edit<4;edit++)tokens.splice(Math.floor(random()*tokens.length),Math.floor(random()*3),alphabet[Math.floor(random()*alphabet.length)]);
  const replacement=tokens.join(''),spans=boundedReconstructionDiff(original,replacement),oldBoundary=boundary(original),newBoundary=boundary(replacement);
  assert.equal(applyDifferences(original,replacement,spans),replacement,`sample ${sample}`);assert.ok(spans.length<=64);
  assert.ok(spans.every(span=>span.end>span.start&&oldBoundary.has(span.start)&&oldBoundary.has(span.end)&&newBoundary.has(span.newStart)&&newBoundary.has(span.newEnd)));
 }
 const original='a'.repeat(16000),replacement='b'.repeat(16000),spans=boundedReconstructionDiff(original,replacement);
 assert.equal(spans.length,1);assert.equal(applyDifferences(original,replacement,spans),replacement);
});
test('adaptive editing chunks remain canonical and page bounded while legacy planning is stable',()=>{
 const text=('Equation $x=1$ with note[^a] and table |a|b|. 😀\n').repeat(240),boundary=text.indexOf('\n')*100+100;
 const document={physical:{pages:[{range:{startOffset:0,endOffset:boundary}},{range:{startOffset:boundary,endOffset:text.length}}]}};
 const legacy=planReprocessingChunks(text,document),adaptive=planReprocessingChunks(text,document,8000,true);
 assert.deepEqual(planReprocessingChunks(text,document,8000,false),legacy);
 assert.ok(adaptive.length>legacy.length);assert.equal(adaptive.map(chunk=>chunk.blocks.map(block=>block.text).join('')).join(''),text);
 for(const [index,chunk] of adaptive.entries()){
  assert.equal(chunk.start,index?adaptive[index-1].end:0);assert.ok(chunk.end-chunk.start<=4000);assert.ok(!(chunk.start<boundary&&chunk.end>boundary));
  assert.equal(chunk.blocks.map(block=>block.text).join(''),text.slice(chunk.start,chunk.end));
 }
});

test('highly fragmented reconstruction compacts to at most fifty exact canonical patches',()=>{
 const original=Array.from({length:120},(_,index)=>`Error${index} reacl.\n\n`).join(''),chunk=planReprocessingChunks(original,{physical:{pages:[]}})[0];
 const replacement=original.replaceAll('reacl','read'),result=reconstructBlocks(chunk,{blocks:chunk.blocks.map(block=>({id:block.id,text:block.text.replaceAll('reacl','read')}))});
 assert.ok(result.patches.length<=50);assert.ok(result.patches.length>1);
 const actual=[...result.patches].reverse().reduce((text,patch)=>text.slice(0,patch.startOffset)+patch.replacement+text.slice(patch.endOffset),original);
 assert.equal(actual,replacement);
});


test('paired footnote formatting preserves words and labels, and refuses ambiguous or substantive changes',()=>{
 const text='Body with note1.\n\n1. The original note text.';
 const proposed='Body with note[^p1-1].\n\n[^p1-1]: The original note text.';
 const document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}};
 const check=(replacement,policy='verified',source=text)=>{
  const patch={id:'p',original:source,replacement,decision:'pending',category:'ocr',range:{startOffset:0,endOffset:source.length}};
  return acceptVerifiedFootnoteFormatting(groupApparatusPatches([patch]),source,document,policy)[0];
 };
 assert.equal(check(proposed).decision,'accepted');assert.equal(check(proposed).category,'footnote');assert.ok(check(proposed).autoAcceptance.checks.includes('identical-note-and-body-text'));
 assert.equal(check(proposed,'review_all').decision,'pending');assert.equal(check(proposed.replace('original','invented')).decision,'pending');
 assert.equal(check(proposed.replaceAll('p1-1','p1-2')).decision,'pending');assert.equal(check(proposed.replaceAll('p1-1','p2-1')).decision,'pending');
 assert.equal(check('Body with note[^p1-1].\n\n1. The original note text.').decision,'pending');
 const numbered='Body has 2021.\n\n1. The original note text.';document.physical.pages[0].range.endOffset=numbered.length;
 assert.equal(check('Body has 202[^p1-1].\n\n[^p1-1]: The original note text.','verified',numbered).decision,'pending');
});

test('inline extracted footnotes and citation dash spaces validate without changing source or furniture',()=>{
 const text='<!-- Page 3 -->\n\nHEADER 3/5\nBody clause;1. Another clause;2. More prose 1 First exact citation AA- 01/02-3.\n\n2 Second exact citation AA-01/02- 4.\n\nFOOTER 3/5';
 const proposed=text.replace('clause;1.','clause;[^p3-1].').replace('clause;2.','clause;[^p3-2].').replace('prose 1 First','prose\n\n[^p3-1]: First').replace('\n2 Second','\n[^p3-2]: Second').replace('AA- 01','AA-01').replace('- 4.','-4.');
 const document={physical:{pages:[{number:3,range:{startOffset:0,endOffset:text.length}}]}};
 const evaluate=replacement=>acceptVerifiedFootnoteFormatting(groupApparatusPatches([{id:'inline',original:text,replacement,decision:'pending',range:{startOffset:0,endOffset:text.length}}]),text,document,'verified')[0];
 const patch=evaluate(proposed);assert.equal(patch.decision,'accepted');assert.equal(patch.autoAcceptance.validator,'canonical-footnote-layout-v2');
 assert.equal(patch.original,text);assert.ok(patch.replacement.includes('HEADER 3/5'));assert.ok(patch.replacement.includes('FOOTER 3/5'));
 for(const unsafe of [proposed.replace('exact','invented'),proposed.replace('AA-01/02-3','AA-01/02-8'),proposed.replace('More prose','Moreprose'),proposed.replace('HEADER 3/5','HEADER 4/5'),proposed.replaceAll('p3-1','p3-9')])assert.equal(evaluate(unsafe).decision,'pending');
});

test('canonical note hints discover merged definitions and recover omitted notes without losing unrelated results',()=>{
 const text='<!-- Page 3 -->\n\nHEADER\nA clause;1. Another clause;2. Remaining prose 1 Original first note citation.\n\n2 Original second note citation.\n\nFOOTER';
 const document={physical:{pages:[{number:3,range:{startOffset:0,endOffset:text.length}}]}},chunk=planReprocessingChunks(text,document)[0];
 const candidates=discoverCanonicalFootnotes(chunk,document);assert.deepEqual(candidates.map(note=>note.id),['p3-1','p3-2']);assert.equal(candidates[0].body,'Original first note citation.');
 const previous={blocks:chunk.blocks.map(block=>({id:block.id,text:block.text.replace(';1.',';[^p3-1].').replace(' 1 Original first note citation.','').replace(';2.',';[^p3-2].').replace('2 Original second note citation.','[^p3-2]: Original second note citation.')})),pageFurniture:[{quote:'HEADER',kind:'header'}],metadata:[{field:'title',value:'Existing title'}],diagnostics:[]};
 const before=structuredClone(previous),recovered=recoverCanonicalFootnoteDefinitions(chunk,previous,document,candidates);assert.deepEqual(previous,before);
 assert.deepEqual(recovered.pageFurniture,previous.pageFurniture);assert.deepEqual(recovered.metadata,previous.metadata);
 assert.ok(recovered.blocks.find(block=>block.id===candidates[0].blockId).text.includes('[^p3-1]: Original first note citation.'));
 const final=reconstructBlocks(chunk,recovered);assert.deepEqual(apparatusProblems(text,final.text),[]);assert.ok(final.text.indexOf('[^p3-1]:')<final.text.indexOf('[^p3-2]:'));assert.ok(final.text.includes('HEADER'));assert.ok(final.text.includes('FOOTER'));
 const unpaired={blocks:chunk.blocks.map(({id,text})=>({id,text:text.replace(' 1 Original first note citation.','')}))};assert.deepEqual(recoverCanonicalFootnoteDefinitions(chunk,unpaired,document),unpaired);
 const numbered='Article 2 applies.\n\n1 Numbered paragraph.\n\n2 Another numbered paragraph.';assert.deepEqual(discoverCanonicalFootnotes(planReprocessingChunks(numbered,document)[0],document),[]);
});

test('missing middle notes are recovered before later definitions within the same canonical block',()=>{
 const text='Clause;1. Clause;2. Prose 1 First exact note body. 2 Second exact note body.\n\n';
 const document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}},chunk=planReprocessingChunks(text,document)[0];
 const previous={blocks:chunk.blocks.map(({id})=>({id,text:'Clause;[^p1-1]. Clause;[^p1-2]. Prose\n\n[^p1-2]: Second exact note body.\n\n'}))};
 const recovered=recoverCanonicalFootnoteDefinitions(chunk,previous,document),proposed=recovered.blocks[0].text;
 assert.ok(proposed.indexOf('[^p1-1]:')<proposed.indexOf('[^p1-2]:'));
 const patch={id:'pair',original:text,replacement:proposed,decision:'pending',range:{startOffset:0,endOffset:text.length}};
 assert.equal(acceptVerifiedFootnoteFormatting(groupApparatusPatches([patch]),text,document,'verified')[0].decision,'accepted');
});

test('footnote groups retain balanced added emphasis while refusing lost literal markup or changed wording',()=>{
 const text='Body citation;1. More text 1 Agency, The Original Case, AA- 01/02-3.\n\n';
 const document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}};
 const proposed='Body citation;[^p1-1]. More text\n\n[^p1-1]: Agency, *The Original Case*, AA-01/02-3.\n\n';
 const evaluate=(replacement,source=text)=>acceptVerifiedFootnoteFormatting(groupApparatusPatches([{id:'emphasis',original:source,replacement,decision:'pending',range:{startOffset:0,endOffset:source.length}}]),source,{physical:{pages:[{number:1,range:{startOffset:0,endOffset:source.length}}]}},'verified')[0];
 assert.equal(evaluate(proposed).decision,'accepted');assert.ok(evaluate(proposed).autoAcceptance.checks.includes('balanced-added-inline-emphasis'));
 for(const unsafe of [proposed.replace('*The Original Case*','*The Original Case'),proposed.replace('*The Original Case*','`The Original Case`'),proposed.replace('*The Original Case*','~~The Original Case~~'),proposed.replace('*The Original Case*','[The Original Case](https://example.com)'),proposed.replace('Original','Changed')])assert.equal(evaluate(unsafe).decision,'pending');
 assert.equal(evaluate(proposed.replace('*The Original Case*','The Original Case'),text.replace('The Original Case','*The Original Case*')).decision,'pending');
 const chunk=planReprocessingChunks(text,document)[0],raw={blocks:chunk.blocks.map(({id})=>({id,text:'Body citation;[^p1-1]. More text\n\n'})),pageFurniture:[{quote:'A running header',kind:'header'}],metadata:[{field:'title',value:'Case title'}]};
 const recovered=recoverCanonicalFootnoteDefinitions(chunk,raw,document),final=reconstructBlocks(chunk,recovered);
 assert.deepEqual(apparatusProblems(text,final.text),[]);assert.ok(final.text.includes('[^p1-1]: Agency, The Original Case, AA- 01/02-3.'));assert.deepEqual(recovered.pageFurniture,raw.pageFurniture);assert.deepEqual(recovered.metadata,raw.metadata);
});


test('mathematical subscripts and theorem or index numbering do not manufacture footnotes',()=>{
 const text='<!-- Page 1 -->\n\nThe groups A1 and A4 occur. Theorem 1. Let H have index 3 in G.\n\nCorollary 9. There is no subgroup of index 2 in A4.\n\nA9 is notation.\n\n9. This is a numbered mathematical item, not a note supported by A9.';
 const document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}};
 assert.deepEqual(discoverCanonicalFootnotes(planReprocessingChunks(text,document)[0],document),[]);
 const withNote='Let A1 be a group. Body clause;1. More prose.\n\n1. A genuine note body.';
 document.physical.pages[0].range.endOffset=withNote.length;
 assert.equal(discoverCanonicalFootnotes(planReprocessingChunks(withNote,document)[0],document)[0].body,'A genuine note body.');
});

test('math coverage hints find unmarked notation while excluding rendered math, code and note labels',async()=>{
 const {unmarkedMathCandidates}=await import('../src/server/modules/source-reprocessing-diagnostics.ts');
 const text='Group A4 and subgroup H have g ∈ A4.\nAlready $A_4$ and \\(g^2 = e\\). Code `A9` and note[^p1-2].\n```\nA8\n```\n<!-- Page 3 -->';
 const found=unmarkedMathCandidates(text);
 assert.ok(found.some(item=>item.text==='A4'));assert.ok(found.some(item=>item.text==='H'));assert.ok(found.some(item=>item.text.includes('∈')));
 assert.ok(found.every(item=>item.line===1));
});

test('document correction ledger nominates indexed conflicts without globally replacing intentional notation',async()=>{
 const {createCorrectionLedger,correctionLedgerForChunk,auditCorrectionLedger}=await import('../src/server/modules/source-reprocessing-corrections.ts');
 const text='Let the spaces R_2 and R_3 have different dimensions.\n\nA later passage calls the first space R₂.\n\nCode `Q1 Q2` and https://example.com/T1/T2 must not create conflicts.';
 const document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}},chunks=planReprocessingChunks(text,document),ledger=createCorrectionLedger(chunks,[],{scope:'family'});
 assert.equal(ledger.length,1);assert.equal(ledger[0].kind,'notation_conflict');assert.deepEqual(ledger[0].alternatives,['R_2','R_3']);assert.match(ledger[0].reason,/intentionally differ/);
 for(const evidence of ledger[0].evidence)assert.equal(text.slice(evidence.start,evidence.end),evidence.quote);
 const response={blocks:chunks[0].blocks.map(({id,text})=>({id,text})),correctionReviews:[{id:ledger[0].id,outcome:'retained',explanation:'These are explicitly different spaces; their indices intentionally differ.'}]};
 assert.match(auditCorrectionLedger(ledger,response,chunks[0]).join(' '),/retained/);assert.deepEqual(response.blocks,chunks[0].blocks.map(({id,text})=>({id,text})));
 assert.equal(correctionLedgerForChunk(ledger,{...chunks[0],blocks:[]}).length,0);
});

test('correction ledger audits omitted outcomes and rejects markup-only claims of substantive repair',async()=>{
 const {createCorrectionLedger,auditCorrectionLedger}=await import('../src/server/modules/source-reprocessing-corrections.ts');
 const text='The operator M2 acts on the space.\n\nThe same operator is later written M7.';
 const document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}},chunk=planReprocessingChunks(text,document)[0],ledger=createCorrectionLedger([chunk],[],{scope:'family'});
 const blocks=chunk.blocks.map(({id,text})=>({id,text:text.replace(/M([27])/g,'$M_$1$')}));
 assert.match(auditCorrectionLedger(ledger,{blocks},chunk).join(' '),/missing or invalid explicit outcome/);
 const review={id:ledger[0].id,outcome:'proposed',explanation:'The later operator index appears to be an OCR substitution.'};
 assert.match(auditCorrectionLedger(ledger,{blocks,correctionReviews:[review]},chunk).join(' '),/no corresponding substantive correction/);
 const corrected=blocks.map(block=>({...block,text:block.text.replace('M_7','M_2')}));
 assert.match(auditCorrectionLedger(ledger,{blocks:corrected,correctionReviews:[review]},chunk).join(' '),/proposed —/);
 assert.match(auditCorrectionLedger(ledger,{blocks,correctionReviews:[{...review,outcome:'source_required',explanation:'Inspect the source glyph; context cannot identify which index was printed.'}]},chunk).join(' '),/source_required/);
});

test('reported OCR uncertainties enter the correction ledger only with exact canonical evidence',async()=>{
 const {createCorrectionLedger,auditCorrectionLedger}=await import('../src/server/modules/source-reprocessing-corrections.ts');
 const text='The scalar l is OCR damaged.',document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}},chunk=planReprocessingChunks(text,document)[0],block=chunk.blocks[0];
 const uncertainty={blockId:block.id,nature:'Scalar glyph ambiguity',readings:['l','1'],evidence:[{blockId:block.id,quote:'scalar l'}]};
 const ledger=createCorrectionLedger([chunk],[uncertainty,{...uncertainty,evidence:[{blockId:block.id,quote:'scalar 1'}]}],{scope:'family'});
 assert.equal(ledger.length,1);assert.equal(ledger[0].kind,'reported_uncertainty');assert.equal(text.slice(ledger[0].evidence[0].start,ledger[0].evidence[0].end),'scalar l');
 const response={blocks:[{id:block.id,text:text.replace('scalar l','scalar 1')}],correctionReviews:[{id:ledger[0].id,outcome:'proposed',explanation:'Context supports the numeral, with source confirmation still required.'}]};
 assert.match(auditCorrectionLedger(ledger,response,chunk).join(' '),/proposed/);
});

test('late chunks retain local conflict evidence after document-wide samples fill up',async()=>{
 const {createCorrectionLedger,correctionLedgerForChunk,auditCorrectionLedger}=await import('../src/server/modules/source-reprocessing-corrections.ts');
 const chunks=Array.from({length:8},(_,index)=>{const text=`The notation T2 and T9 both occur in passage ${index}.`;return {index,start:index*100,end:index*100+text.length,blocks:[{id:'block-'+index,start:index*100,end:index*100+text.length,text}],difficulty:'ordinary',difficultyReason:''};});
 const ledger=createCorrectionLedger(chunks),late=correctionLedgerForChunk(ledger,chunks[7]);assert.equal(late.length,1);
 assert.ok(late[0].evidence.some(ref=>ref.blockId==='block-7'));assert.equal(late[0].chunkEvidence,undefined,'requests omit the document-wide internal index');assert.ok(JSON.stringify(late).length<12000);
 const diagnostics=auditCorrectionLedger(ledger,{blocks:chunks[7].blocks.map(({id,text})=>({id,text}))},chunks[7]);assert.match(diagnostics.join(' '),/missing or invalid explicit outcome/);
});

test('unrelated indexed edits cannot claim to resolve a different notation conflict',async()=>{
 const {createCorrectionLedger,auditCorrectionLedger}=await import('../src/server/modules/source-reprocessing-corrections.ts');
 const text='The quantities K2 and K3 are in conflict. Another variable z_1 occurs.',document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}},chunk=planReprocessingChunks(text,document)[0],ledger=createCorrectionLedger([chunk],[],{scope:'family'});
 const response={blocks:chunk.blocks.map(({id,text})=>({id,text:text.replace('z_1','z_2')})),correctionReviews:[{id:ledger[0].id,outcome:'proposed',explanation:'A correction was made elsewhere.'}]};
 assert.match(auditCorrectionLedger(ledger,response,chunk).join(' '),/no corresponding substantive correction/);
});

test('block ledger requires separate heading and proof outcomes and remains stable through audit projection',async()=>{
 const {createCorrectionLedger,correctionLedgerForChunk,auditCorrectionLedger}=await import('../src/server/modules/source-reprocessing-corrections.ts');
 const text='The object M4 is under discussion.\n\nClaim. The object M1 has the stated property.\n\nProof. The object M1 has the stated property.';
 const document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}},chunk=planReprocessingChunks(text,document)[0],ledger=createCorrectionLedger([chunk]),tasks=correctionLedgerForChunk(ledger,chunk);
 assert.equal(tasks.length,3);assert.equal(new Set(tasks.map(task=>task.id)).size,3);assert.deepEqual(correctionLedgerForChunk(tasks,chunk),tasks);
 for(const block of chunk.blocks)assert.ok(tasks.some(task=>task.targetBlockId===block.id));
 const response={blocks:chunk.blocks.map(({id,text})=>({id,text:text.startsWith('Proof.')?text.replace('M1','M4'):text})),correctionReviews:tasks.map(task=>({id:task.id,outcome:task.targetBlockId===chunk.blocks[0].id?'retained':'proposed',explanation:'Compared the object name against document context.'}))};
 const diagnostics=auditCorrectionLedger(ledger,response,chunk),headingTask=tasks.find(task=>task.targetBlockId===chunk.blocks[1].id),proofTask=tasks.find(task=>task.targetBlockId===chunk.blocks[2].id);
 assert.ok(diagnostics.some(value=>value.includes(headingTask.id)&&value.includes('no corresponding substantive correction')));
 assert.ok(diagnostics.some(value=>value.includes(proofTask.id)&&value.includes('proposed —')));
 assert.deepEqual(auditCorrectionLedger(tasks,response,chunk),diagnostics);
 const retained={...response,correctionReviews:tasks.map(task=>({id:task.id,outcome:'retained',explanation:'These object indices intentionally distinguish different objects.'}))};
 assert.ok(auditCorrectionLedger(ledger,retained,chunk).every(value=>value.includes('retained')));
});

test('block ledger exposes incomplete bounded coverage rather than silently dropping local tasks',async()=>{
 const {createCorrectionLedger,correctionLedgerForChunk,correctionLedgerCoverage,auditCorrectionLedger}=await import('../src/server/modules/source-reprocessing-corrections.ts');
 const text=Array.from({length:60},(_,index)=>`Paragraph ${index}: object W${index%2?2:7} has a property.`).join('\n\n'),document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}},chunk=planReprocessingChunks(text,document)[0],ledger=createCorrectionLedger([chunk]),coverage=correctionLedgerCoverage(ledger,chunk),tasks=correctionLedgerForChunk(ledger,chunk);
 assert.equal(coverage.total,60);assert.ok(coverage.omitted>0);assert.ok(tasks.length<=32);assert.ok(JSON.stringify(tasks).length<12100);
 assert.match(auditCorrectionLedger(ledger,{blocks:chunk.blocks},chunk)[0],/coverage incomplete/);
});

test('numbered bibliography links preserve printed labels and exclude math, code, links, and footnotes',async()=>{
 const {discoverSourceBibliography}=await import('../src/shared/source-bibliography.ts');
 const text='See [1] and [2]. Equation $[1]$ and code `[1]` are not citations. Link [1](https://example.test) and note[^1].\n\nREFERENCES\n\n[1] First author, First article, 2020.\n[2] Second author, Second article, 2021.';
 const found=discoverSourceBibliography(text);
 assert.deepEqual(found.entries.map(entry=>entry.label),['1','2']);assert.deepEqual(found.citations.map(citation=>citation.label),['1','2']);
 for(const citation of found.citations){assert.equal(text.slice(citation.startOffset,citation.endOffset),`[${citation.label}]`);assert.equal(text.slice(citation.entryStartOffset,citation.entryStartOffset+3),`[${citation.label}]`);}
 assert.deepEqual(discoverSourceBibliography('A numbered list:\n[1] One ordinary item.\nSee [1].').entries,[]);
 assert.deepEqual(discoverSourceBibliography('Items:\n[1] First item.\n[2] Second item.\n\nREFERENCES\n[1] First article.\n[2] Second article.').citations,[]);
 assert.deepEqual(discoverSourceBibliography('See [1].\n\nREFERENCES\n[1] First.\n[1] Duplicate.').citations,[]);
 assert.match(discoverSourceBibliography('See [1].\n\nREFERENCES\n[1] First.\n[1] Duplicate.').diagnostics[0],/multiple entries/);
});

test('bibliographic reference hints retain exact cross-chunk source evidence and require explicit classification',async()=>{
 const {canonicalBibliographicReferences,bibliographicReferencesForChunk,auditBibliographicReferences}=await import('../src/server/modules/source-reprocessing-references.ts');
 const text='See [1] for more proofs.\n\nREFERENCES\n\n[1] Example Author, A reference title, 2020.';
 const split=text.indexOf('REFERENCES'),chunks=[{index:0,start:0,end:split,blocks:[{id:'body',text:text.slice(0,split),start:0,end:split}]},{index:1,start:split,end:text.length,blocks:[{id:'references',text:text.slice(split),start:split,end:text.length}]}];
 const hints=canonicalBibliographicReferences(chunks);assert.equal(hints.length,1);assert.equal(hints[0].label,'1');assert.equal(hints[0].entry.blockId,'references');assert.equal(hints[0].citations[0].blockId,'body');
 for(const ref of [hints[0].entry,...hints[0].citations])assert.equal(text.slice(ref.start,ref.end),ref.quote);
 assert.equal(bibliographicReferencesForChunk(hints,chunks[0])[0].entry.blockId,'references');
 assert.match(auditBibliographicReferences(hints,{},chunks[0])[0],/missing or invalid/);
 assert.match(auditBibliographicReferences(hints,{blocks:chunks[0].blocks,referenceReviews:[{label:'1',outcome:'linked',explanation:'The printed citation points to the unique numbered bibliography entry.'}]},chunks[0])[0],/linked/);
 assert.match(auditBibliographicReferences(hints,{referenceReviews:[{label:'1',outcome:'ambiguous',explanation:'The target requires source review.'}]},chunks[0])[0],/ambiguous/);
});


test('linked bibliography verdict cannot hide dropped citations or conversion into footnotes',async()=>{
 const {canonicalBibliographicReferences,auditBibliographicReferences}=await import('../src/server/modules/source-reprocessing-references.ts');
 const text='See [1] and again [1].\n\nREFERENCES\n\n[1] An Author, A reference title, 2020.';
 const document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}},chunk=planReprocessingChunks(text,document)[0],hints=canonicalBibliographicReferences([chunk]);
 const reviews=[{label:'1',outcome:'linked',explanation:'The citation and bibliography are linked.'}];
 const response=value=>({blocks:chunk.blocks.map(block=>({...block,text:value(block.text)})),referenceReviews:reviews});
 assert.ok(auditBibliographicReferences(hints,response(value=>value),chunk).every(value=>value.includes('linked —')));
 for(const replace of [value=>value.replace('See [1]','See [^1]'),value=>value.replace('See [1]','See'),value=>value.replace('[1] An Author','[^1]: An Author'),value=>value.replace('See [1]','See $[1]$'),value=>value.replace('See [1]','See `[1]`'),value=>value.replace('See [1]','See [1](https://example.test)')]){
  assert.ok(auditBibliographicReferences(hints,response(replace),chunk).some(value=>value.includes('missing or converted')));
 }
});
