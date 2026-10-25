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
