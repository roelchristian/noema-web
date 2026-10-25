import test from 'node:test';
import assert from 'node:assert/strict';
import {planReprocessingChunks} from '../src/server/modules/source-reprocessing-planner.ts';
import {reconstructBlocks} from '../src/server/modules/source-reprocessing-diff.ts';
import {gatherReprocessingEvidence} from '../src/server/modules/source-reprocessing-evidence.ts';
import {evaluateV2Acceptance} from '../src/server/modules/source-reprocessing-risk.ts';
const text='Two  spaces in ordinary prose.';
const document={source:{language:'en'},physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]},semantic:{kind:'document',children:[{id:'p',kind:'paragraph',text,range:{startOffset:0,endOffset:text.length},children:[]}]}};
test('ID recovery requires unique unchanged source text in the original position',()=>{
 const block=(id,text,start)=>({id,text,start,end:start+text.length});
 const chunk={blocks:[block('a'.repeat(24),'First unchanged block.\n',0),block('b'.repeat(24),'Second unchanged block.\n',23)]};
 const response={blocks:chunk.blocks.map(({id,text})=>({id,text}))};response.blocks[0].id='c'.repeat(24);
 const before=structuredClone(response),result=reconstructBlocks(chunk,response);assert.deepEqual(result.patches,[]);assert.match(result.diagnostics[0],/Recovered mistyped block ID/);assert.deepEqual(response,before,'the original provider response is immutable');
 const changed=structuredClone(response);changed.blocks[0].text+='edited';assert.throws(()=>reconstructBlocks(chunk,changed),/unknown/);
 const reordered={blocks:[...chunk.blocks].reverse()};assert.throws(()=>reconstructBlocks(chunk,reordered),/unknown/);
 const duplicate=structuredClone(response);duplicate.blocks[1].id=duplicate.blocks[0].id;assert.throws(()=>reconstructBlocks(chunk,duplicate),/unknown/);
 const repeated={blocks:[block('a'.repeat(24),'Repeated text.',0),block('b'.repeat(24),'Repeated text.',14)]};assert.throws(()=>reconstructBlocks(repeated,{blocks:[{id:'c'.repeat(24),text:'Repeated text.'},{id:'b'.repeat(24),text:'Repeated text.'}]}),/unknown/);
});
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


test('Verified paragraph reconstruction preserves exact words and punctuation without requiring OCR',()=>{
 const text='“Quoted prose” has a hard\nline wrap. Another paragraph begins with 42 words.';
 const document={source:{language:'en'},physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]},semantic:{kind:'document',children:[{id:'p',kind:'paragraph',text,range:{startOffset:0,endOffset:text.length},children:[]}]}};
 const replacement=text.replace('hard\nline','hard line').replace('. Another','.\n\nAnother');
 const chunk=planReprocessingChunks(text,document)[0];const differences=reconstructBlocks(chunk,{blocks:[{id:chunk.blocks[0].id,text:replacement}]}).patches;
 assert.ok(differences.length>0);
 for(const patch of differences){const result=evaluateV2Acceptance({text,document,start:patch.startOffset,end:patch.endOffset,original:patch.original,replacement:patch.replacement,category:patch.category,policy:'verified'});assert.equal(result.automatic,true,JSON.stringify({patch,result}));}
 assert.equal(evaluateV2Acceptance({text,document,start:0,end:text.length,original:text,replacement:replacement.replace('42','43'),category:'formatting',policy:'verified'}).automatic,false);
 for(const replacement of [text.replace('hard\nline','hardline'),text.replace('. Another','.\n\n# Another')])assert.equal(evaluateV2Acceptance({text,document,start:0,end:text.length,original:text,replacement,category:'formatting',policy:'verified'}).automatic,false);
});


test('Verified typography expands extraction ligatures and soft hyphens without approving spelling or punctuation guesses',()=>{
 for(const [original,replacement] of [['ofﬁce','office'],['co\u00adoperate','cooperate'],['Article\u00a061','Article 61']]){
  const doc={...document,physical:{pages:[{number:1,range:{startOffset:0,endOffset:original.length}}]}};
  assert.equal(evaluateV2Acceptance({text:original,document:doc,start:0,end:original.length,original,replacement,category:'ocr',policy:'verified'}).automatic,true);
  assert.equal(evaluateV2Acceptance({text:original,document:doc,start:0,end:original.length,original,replacement,category:'ocr',policy:'review_all'}).automatic,false);
 }
 for(const [original,replacement] of [['CONSITUTES','CONSTITUTES'],['Article 61','Article 62'],['well-being','wellbeing'],['“quoted”','quoted']])assert.equal(evaluateV2Acceptance({text:original,document,start:0,end:original.length,original,replacement,category:'ocr',policy:'verified'}).automatic,false);
});
