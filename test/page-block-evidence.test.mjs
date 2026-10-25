import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blockEvidence,changedBlockEvidence,mergeChangedBlockEvidence} from '../src/server/modules/page-block-evidence.ts';
import {createClassificationBaseline} from '../src/server/modules/page-semantic-drift.ts';
import {representativeEnrichmentText,pageEnrichmentPrompt} from '../src/server/modules/page-enrichment-prompt.ts';
const block=(id,text,type='paragraph')=>({id,type,content:[{text}]});
const page=blocks=>({title:'Evidence fixture',blocks});
const input=note=>note.blocks.map(item=>(item.type==='heading2'?'## ':'')+item.content[0].text).join('\n');
const roundtrip=value=>JSON.parse(JSON.stringify(value));

test('100-block 88000-character fixture selects all 21 distinctive edits rather than unchanged tail blocks',()=>{
 const original=page(Array.from({length:100},(_,index)=>block(String(index),(`Original block ${index}. `+'unchanged material '.repeat(70)).slice(0,879))));
 const updated=page(original.blocks.map((item,index)=>index>=30&&index<51?block(item.id,(`DISTINCTIVE_CHANGED_${index} Mathematical topology homomorphism. `+'new content '.repeat(100)).slice(0,879)):item));
 const baseline=roundtrip(createClassificationBaseline(original));
 // Reproduce the former sampled-body containment failure on this exact fixture.
 const legacySelected=updated.blocks.map(item=>item.content[0].text).filter(text=>!baseline.body.includes(text.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim())).slice(-12);
 assert.equal(legacySelected.length,12);
 assert.equal(legacySelected.filter(text=>text.includes('DISTINCTIVE_CHANGED_')).length,0);
 const legacyUnchanged=original.blocks.map(item=>item.content[0].text).filter(text=>!baseline.body.includes(text.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim())).slice(-12);
 assert.equal(legacyUnchanged.length,12);
 const evidence=changedBlockEvidence(updated,baseline.blockEvidence);
 assert.deepEqual(evidence.counts,{added:0,modified:21,moved:0,deleted:0});
 assert.equal(changedBlockEvidence(original,baseline.blockEvidence).passages.length,0);
 const selected=representativeEnrichmentText(input(updated),[],evidence);
 assert.equal(input(updated).length,87999);
 assert.equal(selected.coverage.changedBlocks,21);assert.equal(selected.coverage.examinedChangedBlocks,21);
 for(let index=30;index<51;index++)assert.ok(selected.text.includes(`DISTINCTIVE_CHANGED_${index}`));
 assert.ok(selected.text.length<=16000);assert.equal(selected.coverage.completeChangedEvidence,false);
 assert.ok(selected.coverage.examinedChangedCharacters<selected.coverage.changedCharacters);
 assert.equal(selected.coverage.changedCharacters,18438);
});

test('block evidence handles additions deletions moves repeats and regenerated IDs without substring guesses',()=>{
 const original=page([block('a','repeated'),block('b','repeated'),block('c','long specific source'),block('d','end')]);
 const baseline=roundtrip(blockEvidence(original));
 assert.deepEqual(changedBlockEvidence(original,baseline).counts,{added:0,modified:0,moved:0,deleted:0});
 const updated=page([original.blocks[3],block('new-a','repeated'),block('x','long specific'),block('b','repeated')]);
 const evidence=changedBlockEvidence(updated,baseline);
 assert.deepEqual(evidence.counts,{added:1,modified:0,moved:1,deleted:1});
 assert.deepEqual(evidence.deletedBlockIds,['c']);
 assert.ok(evidence.passages.some(item=>item.kind==='added'&&item.text==='long specific'));
 const inserted=page([block('x','inserted'),...original.blocks]);
 assert.deepEqual(changedBlockEvidence(inserted,baseline).counts,{added:1,modified:0,moved:0,deleted:0});
});

test('changed evidence includes heading and neighbour context; deletion remains explicit on short pages',()=>{
 const original=page([block('h','Proof','heading2'),block('a','before'),block('b','claim'),block('c','after')]);
 const updated=page([original.blocks[0],original.blocks[1],block('b','reversed claim')]);
 const evidence=changedBlockEvidence(updated,blockEvidence(original));
 assert.deepEqual(evidence.passages[0].context,['Proof','before']);
 const selected=representativeEnrichmentText(input(updated),[],evidence);
 assert.ok(selected.text.includes('1 source block(s) were deleted'));
 assert.equal(selected.coverage.deletedBlocks,1);assert.equal(selected.coverage.completeChangedEvidence,true);
});

test('legacy evidence is honestly unknown and summary/classification changes form a union',()=>{
 const initial=page([block('a','first'),block('b','second')]);
 const summaryVersion=page([block('a','first summary change'),initial.blocks[1]]);
 const latest=page([summaryVersion.blocks[0],block('b','second classification change')]);
 const summaryEvidence=changedBlockEvidence(latest,blockEvidence(initial));
 const classificationEvidence=changedBlockEvidence(latest,blockEvidence(summaryVersion));
 const union=mergeChangedBlockEvidence([summaryEvidence,classificationEvidence]);
 assert.equal(union.passages.length,2);assert.equal(union.changedCharacters,48);
 const unknown=changedBlockEvidence(latest,{body:'first second'});
 assert.equal(unknown.status,'legacy_unknown');assert.equal(unknown.passages.length,0);
 const selected=representativeEnrichmentText(input(latest),[],unknown);
 assert.equal(selected.coverage.completeChangedEvidence,false);
 const prompt=pageEnrichmentPrompt(input(latest),{requestedFields:['summary'],changedEvidence:union});
 const context=JSON.parse(prompt.input[0].content[0].text);
 assert.equal(context.evidenceCoverage.changedBlocks,2);
});

test('changed sampling deduplicates repeated source excerpts and exposes over-budget coverage',()=>{
 const original=page([block('a','old')]);
 const updated=page([block('a','Distinctive edit '+ 'x'.repeat(30000))]);
 const evidence=changedBlockEvidence(updated,blockEvidence(original));
 const selected=representativeEnrichmentText(input(updated),[],evidence);
 assert.equal(selected.text.split('Distinctive edit').length-1,1);
 assert.equal(selected.coverage.examinedChangedBlocks,1);assert.ok(selected.coverage.examinedChangedCharacters<evidence.changedCharacters);
 assert.equal(selected.coverage.completeChangedEvidence,false);
 assert.ok(selected.text.includes('[Passage truncated]'));assert.ok(selected.text.length<=16000);
});

 test('large edit sets retain bounded prioritized evidence and math distinctions',()=>{
 const original=page(Array.from({length:500},(_,index)=>block(String(index),'previous '+index)));
 const updated=page(original.blocks.map((item,index)=>block(item.id,'changed '+index+' '+ 'x'.repeat(100))));
 const evidence=changedBlockEvidence(updated,blockEvidence(original));
 const selected=representativeEnrichmentText(input(updated),[],evidence);
 assert.ok(selected.coverage.examinedChangedBlocks>0);assert.ok(selected.coverage.examinedChangedBlocks<500);
 assert.equal(selected.coverage.completeChangedEvidence,false);assert.ok(selected.text.length<=16000);
 const math=page([block('m','x² = 3')]);
 assert.equal(changedBlockEvidence(page([block('m','x2 = 3')]),blockEvidence(math)).counts.modified,1);
 assert.equal(changedBlockEvidence(page([block('m','x² < 3')]),blockEvidence(math)).counts.modified,1);
});
