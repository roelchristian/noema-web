import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summaryBaseline,materiallyStaleSummary} from '../src/server/modules/page-summary-freshness.ts';
const page=text=>({title:'A mathematical note',blocks:[{id:'body',type:'paragraph',content:[{text}]}]});
const original='Algebra studies equations and polynomial expressions. Mathematical proofs establish theorems using precise axioms and logical arguments. Examples demonstrate transformations of equations and illustrate how polynomial identities follow from algebraic rules.';
test('summary freshness tolerates punctuation, whitespace and a small correction',()=>{
 const baseline=summaryBaseline(page(original),()=>undefined);
 assert.equal(materiallyStaleSummary(baseline,summaryBaseline(page(original.replace('precise','explicit').replace('Algebra ','Algebra  ')),()=>undefined)),false);
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
