import test from 'node:test';
import assert from 'node:assert/strict';
import {planReprocessingChunks} from '../src/server/modules/source-reprocessing-planner.ts';
import {reconstructBlocks} from '../src/server/modules/source-reprocessing-diff.ts';
import {gatherReprocessingEvidence} from '../src/server/modules/source-reprocessing-evidence.ts';
import {evaluateV2Acceptance} from '../src/server/modules/source-reprocessing-risk.ts';
const text='Two  spaces in ordinary prose.';
const document={source:{language:'en'},physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]},semantic:{kind:'document',children:[{id:'p',kind:'paragraph',text,range:{startOffset:0,endOffset:text.length},children:[]}]}};
test('canonical blocks map repeated text and Unicode without model offsets',()=>{
 const source='😀 repeated repeated';const doc={...document,physical:{pages:[]}};const chunk=planReprocessingChunks(source,doc)[0];
 const result=reconstructBlocks(chunk,{blocks:chunk.blocks.map(block=>({id:block.id,text:block.text.replace('😀','😁')}))});
 assert.equal(result.patches[0].startOffset,0);assert.equal(result.patches[0].endOffset,2);assert.equal(result.patches[0].original,'😀');
 assert.throws(()=>reconstructBlocks(chunk,{blocks:[{id:'invented',text:source}]}),/unknown/);
 assert.throws(()=>reconstructBlocks(chunk,{blocks:[]}),/every canonical block/);
});
test('Verified policy accepts evidenced horizontal repair without trusting confidence',()=>{
 const chunk=planReprocessingChunks(text,document)[0],patch=reconstructBlocks(chunk,{blocks:[{id:chunk.blocks[0].id,text:text.replace('  ',' ')}]}).patches[0];
 assert.equal(text.slice(patch.startOffset,patch.endOffset),patch.original);
 const result=evaluateV2Acceptance({text,document,start:patch.startOffset,end:patch.endOffset,original:patch.original,replacement:patch.replacement,category:patch.category,policy:'verified'});
 assert.equal(result.automatic,true);
 assert.equal(evaluateV2Acceptance({text,document,start:0,end:3,original:'Two',replacement:'Ten',category:'ocr',policy:'verified'}).automatic,false);
});
test('page/OCR evidence and transmission fail closed independently of options',()=>{
 const options={originalPages:true,ocr:true,allowExternalTransmission:true};const evidence=gatherReprocessingEvidence({text,document,start:0,end:text.length,options});
 assert.equal(evidence.originalPages.available,false);assert.equal(evidence.ocr.available,false);assert.equal(evidence.externalTransmissionAllowed,false);assert.equal(evidence.independentlyVerified,false);
 assert.equal(evidence.hash,gatherReprocessingEvidence({text,document,start:0,end:text.length,options}).hash);
});
