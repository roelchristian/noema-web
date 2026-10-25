import {numberedWords,omittedVocabularyTail,legacyTokenEvidence} from './helpers/legacy-content.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summaryBaseline,materiallyStaleSummary} from '../src/server/modules/page-summary-freshness.ts';
const page=text=>({title:'A mathematical note',blocks:[{id:'body',type:'paragraph',content:[{text}]}]});
const original='Algebra studies equations and polynomial expressions. Mathematical proofs establish theorems using precise axioms and logical arguments. Examples demonstrate transformations of equations and illustrate how polynomial identities follow from algebraic rules.';
test('summary freshness tolerates presentation but requests refresh for uncertain small corrections',()=>{
 const baseline=summaryBaseline(page(original),()=>undefined);
 assert.equal(materiallyStaleSummary(baseline,summaryBaseline(page(original.replace('precise','explicit').replace('Algebra ','Algebra  ')),()=>undefined)),true);
 assert.equal(materiallyStaleSummary(baseline,summaryBaseline(page(original.replaceAll('.', '!')),()=>undefined)),false);
});
test('summary freshness measures cumulative changes against its generating baseline',()=>{
 const baseline=summaryBaseline(page(original),()=>undefined);
 assert.equal(materiallyStaleSummary(baseline,summaryBaseline(page(original+' Another example demonstrates algebraic reasoning.'),()=>undefined)),true);
});
test('new headings and manual title changes stale the summary independently',()=>{
 const baseline=summaryBaseline(page(original),()=>undefined),changed=page(original);
 changed.title='A different title';
 assert.equal(materiallyStaleSummary(baseline,summaryBaseline(changed,()=>undefined)),true);
 const headings=page(original);headings.blocks.push({id:'section',type:'heading2',content:[{text:'Applications'}]});
 assert.equal(materiallyStaleSummary(baseline,summaryBaseline(headings,()=>undefined)),true);
 assert.equal(materiallyStaleSummary(undefined,summaryBaseline(page(original),()=>undefined)),true);
});

const roundtrip=value=>JSON.parse(JSON.stringify(value));
const distinctWords=numberedWords(5000);
const legacySummary=(text,version)=>{
 const baseline=summaryBaseline(page(text),()=>undefined);
 const tokens=text.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[];
 return {...baseline,version,...legacyTokenEvidence(tokens)};
};

test('5000 distinct words remain fresh after punctuation and serialization',()=>{
 const text=distinctWords.join(' ');
 const baseline=roundtrip(summaryBaseline(page(text),()=>undefined));
 const current=roundtrip(summaryBaseline(page(text+'!'),()=>undefined));
 assert.equal(baseline.tokenCount,5000);
 assert.equal(materiallyStaleSummary(baseline,current),false);
});

for(const version of [undefined,1])test(`complete legacy summary ${version??'unmarked'} compares full current vocabulary after serialization`,()=>{
 const baseline=roundtrip(legacySummary('apple '.repeat(60)+'pear '.repeat(40),version));
 assert.equal(materiallyStaleSummary(baseline,roundtrip(summaryBaseline(page('apple '.repeat(60)+'pear '.repeat(40)+'!'),()=>undefined))),false);
 assert.equal(materiallyStaleSummary(baseline,roundtrip(summaryBaseline(page('apple '.repeat(60)+'volcano '.repeat(40)),()=>undefined))),true);
});

test('truncated legacy summaries cannot silently accept equal-length omitted-tail replacements',()=>{
 const retained=distinctWords.slice(0,4096).join(' ');
 const baseline=roundtrip(legacySummary(omittedVocabularyTail(retained,'oldtail'),1));
 const changed=roundtrip(summaryBaseline(page(omittedVocabularyTail(retained,'newtail')),()=>undefined));
 assert.equal(baseline.tokenCount,10096);
 assert.equal(Object.keys(baseline.tokenCounts).length,4096);
 assert.equal(materiallyStaleSummary(baseline,changed),true);
 // A histogram alone cannot prove even unchanged omitted words are the original.
 assert.equal(materiallyStaleSummary(baseline,roundtrip(summaryBaseline(page(omittedVocabularyTail(retained,'oldtail')),()=>undefined))),true);
});

test('serialized generating summary baseline continues to accumulate small edits',()=>{
 const tokens=Array.from({length:100},(_,index)=>`term${index}`);
 const baseline=roundtrip(summaryBaseline(page(tokens.join(' ')),()=>undefined));
 const edited=count=>roundtrip(summaryBaseline(page(tokens.map((token,index)=>index<count?`novel${index}`:token).join(' ')),()=>undefined));
 assert.equal(materiallyStaleSummary(baseline,edited(4)),true);
 assert.equal(materiallyStaleSummary(baseline,edited(20)),true);
});

for(const [before,after] of [
 ['The larger dogs chase the smaller cats','The smaller cats chase the larger dogs'],
 ['The value increases from 10 to 20','The value increases from 20 to 10'],
 ['The treatment is effective','The treatment is not effective'],
 ['x ∈ A','x ∉ A'],['x² = 3','x2 = 3'],['x / (y + z)','x / y + z'],['x < 10','x > 10'],['x = 10','x = -10'],['x = 1.5','x = 1.6'],
])test(`ordered semantic freshness: ${before} -> ${after}`,()=>{
 const baseline=roundtrip(summaryBaseline(page(before),()=>undefined));
 assert.equal(materiallyStaleSummary(baseline,summaryBaseline(page(after),()=>undefined)),true);
});
test('old histogram alone cannot certify a same-vocabulary reversal',()=>{
 const baseline=summaryBaseline(page('The larger dogs chase the smaller cats'),()=>undefined);
 delete baseline.orderedContentHash;delete baseline.semanticVersion;
 assert.equal(materiallyStaleSummary(baseline,summaryBaseline(page('The smaller cats chase the larger dogs'),()=>undefined)),true);
});
