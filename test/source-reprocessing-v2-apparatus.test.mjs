import test from 'node:test';
import assert from 'node:assert/strict';
import {planReprocessingChunks} from '../src/server/modules/source-reprocessing-planner.ts';
import {reconstructBlocks,boundedReconstructionDiff} from '../src/server/modules/source-reprocessing-diff.ts';
import {groupApparatusPatches,assertAtomicPatchGroups,apparatusProblems,acceptVerifiedFootnoteFormatting} from '../src/server/modules/source-reprocessing-apparatus.ts';
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
