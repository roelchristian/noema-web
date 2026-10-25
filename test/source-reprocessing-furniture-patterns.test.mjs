import test from 'node:test';
import assert from 'node:assert/strict';
import {repeatedPageFurniturePatterns} from '../src/server/modules/source-reprocessing-furniture-patterns.ts';
import {planReprocessingChunks} from '../src/server/modules/source-reprocessing-planner.ts';
import {restoreDeletedPageFurniture,canonicalReconstructionFallback} from '../src/server/modules/source-reprocessing-preservation.ts';
const fixture=pages=>{
 let offset=0;return {text:pages.join(''),document:{physical:{pageCount:pages.length,pages:pages.map((text,index)=>{const startOffset=offset;offset+=text.length;return {number:index+1,range:{startOffset,endOffset:offset}};})}}};
};
const classify=pages=>{const value=fixture(pages);return { ...value,items:repeatedPageFurniturePatterns(value.text,value.document)};};
test('physical counter templates recover exact merged header prefixes and footer suffixes',()=>{
 const pages=Array.from({length:5},(_,i)=>`<!-- Page ${i+1} -->\nCase 124 Filed 10/25/2026 Page ${i+1} of 5${i===0?'\uFFFC\n':' '}Distinct title ${i+1}.\nDistinct body ${i+1}. ${i===0?'\n':''}Record 77 ${i+1}/5${i===0?'\uFFFC':''}\n`);
 const {text,items}=classify(pages);
 assert.equal(items.length,10);
 for(const item of items){assert.equal(text.slice(item.startOffset,item.endOffset),item.text);assert.equal(item.hidden,false);assert.ok(!item.text.includes('Distinct'));assert.ok(!item.text.includes('\uFFFC'));assert.equal(item.text,item.kind==='header'?`Case 124 Filed 10/25/2026 Page ${item.page} of 5`:`Record 77 ${item.page}/5`);}
});
test('fixed docket and date numbers are never generalized to manufacture matching fragments',()=>{
 const pages=Array.from({length:5},(_,i)=>`<!-- Page ${i+1} -->\nCase ${124+i} Filed 10/${25+i}/2026 Page ${i+1} of 5${i===0?'\n':' '}Distinct body ${i+1}.\n`);
 assert.equal(classify(pages).items.length,0);
});
test('templates require three distinct physical pages and a matching document total',()=>{
 assert.equal(classify(['Page 1 of 2\nBody one.\n','Page 2 of 2\nBody two.\n']).items.length,0);
 assert.equal(classify(Array.from({length:3},(_,i)=>`Case 124 Page ${i+1} of 99\nDistinct body ${i+1}.\n`)).items.length,0);
});
test('embedded body counter mentions do not become edge fragments',()=>{
 const pages=Array.from({length:4},(_,i)=>i===0?'Case 124 Page 1 of 4\nDistinct body one.\n':`Distinct title ${i+1}.\nDiscuss Case 124 Page ${i+1} of 4 in the argument.\nDistinct ending ${i+1}.\n`);
 assert.equal(classify(pages).items.length,0);
});
test('exact multiline journal boundaries repeat at the same ordinal without prose or footnotes',()=>{
 const pages=Array.from({length:3},(_,i)=>`<!-- Page ${i+1} -->\nJournal of Source Studies\nVolume 24, October 2026\nRecurring substantive statement.\nDistinct body ${i+1}.\n1. A recurring note\n`);
 const {items}=classify(pages);assert.equal(items.length,6);assert.ok(items.every(item=>item.kind==='header'&&['Journal of Source Studies','Volume 24, October 2026'].includes(item.text)));
});
test('different boundary ordinals do not corroborate repeated body fragments',()=>{
 const pages=['Recurring words\nFirst body.\nFirst ending.\n','Second title\nRecurring words\nSecond body.\n','Third title\nThird subtitle\nRecurring words\nThird body.\nThird continuation.\nThird ending.\n'];
 assert.ok(classify(pages).items.every(item=>item.text!=='Recurring words'));
});

test('AI furniture proposals require exact corroborated fragments and cannot absorb adjacent body text',async()=>{
 const {parsePageFurniture}=await import('../src/server/modules/source-reprocessing-furniture.ts');
 const {planReprocessingChunks}=await import('../src/server/modules/source-reprocessing-planner.ts');
 const pages=Array.from({length:5},(_,i)=>`<!-- Page ${i+1} -->\nCase 124 Page ${i+1} of 5${i===0?'\n':' '}Distinct substantive heading ${i+1}\nOriginal language and date ${i+1}\nTrial Chamber III ${i+1}\nSignature ${i+1}${i===0?'\n':' '}Record 77 ${i+1}/5\n`);
 const {text,document,items}=classify(pages),chunks=planReprocessingChunks(text,document);
 for(const chunk of chunks){
  const nominated=items.filter(item=>item.startOffset>=chunk.start&&item.endOffset<=chunk.end);
  const valid=nominated.map(item=>({blockId:chunk.blocks.find(block=>block.start<=item.startOffset&&block.end>=item.endOffset).id,quote:item.text,kind:item.kind}));
  const bad=chunk.blocks.filter(block=>block.text.includes('Distinct')).map(block=>({blockId:block.id,quote:block.text.trim(),kind:'header'}));
  const parsed=parsePageFurniture({pageFurniture:[...valid,...bad]},chunk,text,document,items);
  assert.equal(parsed.candidates.length,2);assert.ok(parsed.candidates.every(item=>!item.text.includes('Distinct')&&!item.text.includes('Signature')));
  assert.ok(parsed.diagnostics.length>0);assert.deepEqual(parsePageFurniture({pageFurniture:[]},chunk,text,document,items).candidates,[]);
 }
});

const preservationFixture=()=>{
 const pages=Array.from({length:3},(_,i)=>`<!-- Page ${i+1} -->\n\nCase 124 Page ${i+1} of 3${i===0?'\n':' '}Substantive body remains. Another sentence ${i+1}.\n\nRecord 77 ${i+1}/3\n`);
 const {text,document,items}=classify(pages),chunk=planReprocessingChunks(text,document)[1];
 return {chunk,items,original:{blocks:chunk.blocks.map(({id,text})=>({id,text})),metadata:[{field:'title',value:'Supported title'}],pageFurniture:items.filter(item=>item.page===2).map(item=>({quote:item.text,kind:item.kind}))}};
};
test('deleted exact corroborated headers are restored while adjacent paragraph repairs remain',()=>{
 const {chunk,items,original}=preservationFixture();
 const response={...original,blocks:original.blocks.map(block=>({...block,text:block.text.replace('Case 124 Page 2 of 3 ','').replace('remains. Another','remains.\n\nAnother')}))};
 const snapshot=structuredClone(response),result=restoreDeletedPageFurniture(chunk,response,items);
 const text=result.response.blocks.map(block=>block.text).join('');
 assert.match(text,/Case 124 Page 2 of 3 Substantive body remains\.\n\nAnother sentence 2\./);
 assert.equal(result.diagnostics.length,1);assert.deepEqual(response,snapshot);
 assert.deepEqual(result.response.metadata,response.metadata);assert.deepEqual(result.response.pageFurniture,response.pageFurniture);
});
test('furniture recovery does not duplicate retained fragments or recover moved fragments twice',()=>{
 const {chunk,items,original}=preservationFixture();
 assert.equal(restoreDeletedPageFurniture(chunk,original,items).response,original);
 const response={...original,blocks:original.blocks.map(block=>({...block,text:block.text.replace('Case 124 Page 2 of 3 ','')+(block.text.includes('Case 124')?'\nCase 124 Page 2 of 3':'')}))};
 const result=restoreDeletedPageFurniture(chunk,response,items);
 assert.equal(result.response,response);assert.equal(result.diagnostics.length,0);
 assert.equal(result.response.blocks.map(block=>block.text).join('').match(/Case 124 Page 2 of 3/g).length,1);
});
test('furniture recovery does not restore a deletion that also removes substantive adjacent text',()=>{
 const {chunk,items,original}=preservationFixture();
 const response={...original,blocks:original.blocks.map(block=>({...block,text:block.text.replace('Case 124 Page 2 of 3 Substantive body remains. ','')}))};
 const result=restoreDeletedPageFurniture(chunk,response,items);
 assert.equal(result.response,response);assert.equal(result.diagnostics.length,0);
});
test('furniture recovery restores isolated footer deletion but leaves modified headers reviewable',()=>{
 const {chunk,items,original}=preservationFixture();
 const response={...original,blocks:original.blocks.map(block=>({...block,text:block.text.replace('Record 77 2/3','').replace('Case 124','Case 999')}))};
 const result=restoreDeletedPageFurniture(chunk,response,items),text=result.response.blocks.map(block=>block.text).join('');
 assert.match(text,/Record 77 2\/3/);assert.match(text,/Case 999/);assert.doesNotMatch(text,/Case 124/);
 assert.equal(result.diagnostics.length,1);
});
test('apparatus fallback retains furniture and metadata for independent canonical validation',()=>{
 const {chunk,original}=preservationFixture(),response={...original,diagnostics:['A note needs review.'],blocks:original.blocks.map(block=>({...block,text:block.text+'[^missing]'}))};
 const snapshot=structuredClone(response),result=canonicalReconstructionFallback(chunk,response);
 assert.deepEqual(result.blocks,chunk.blocks.map(({id,text})=>({id,text})));
 assert.deepEqual(result.metadata,response.metadata);assert.deepEqual(result.pageFurniture,response.pageFurniture);
 assert.deepEqual(result.diagnostics,response.diagnostics);assert.equal(result.unresolved,true);assert.deepEqual(response,snapshot);
});
