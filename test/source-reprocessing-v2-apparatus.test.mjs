import test from 'node:test';
import assert from 'node:assert/strict';
import {planReprocessingChunks} from '../src/server/modules/source-reprocessing-planner.ts';
import {reconstructBlocks} from '../src/server/modules/source-reprocessing-diff.ts';
import {groupApparatusPatches,assertAtomicPatchGroups,apparatusProblems} from '../src/server/modules/source-reprocessing-apparatus.ts';
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
