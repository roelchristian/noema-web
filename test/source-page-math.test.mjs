import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SourcePageDraft} from '../src/server/modules/source-pages.ts';
import {sourcePagePrompt} from '../src/server/modules/source-page-prompt.ts';
import {ReadOnlyPageBlocks} from '../src/client/editor/ReadOnlyPageBlocks.tsx';

function generate(text,blockType='paragraph',citations=[{startLine:1,endLine:1}]) {
 const draft=new SourcePageDraft(()=>{},'Z/(3) is cyclic.');
 draft.feed(JSON.stringify({type:'title',title:'Groups of order 3'})+'\n');
 draft.feed(JSON.stringify({type:'block',blockType,basis:'source',text,citations})+'\n');
 draft.finish();return draft.blocks;
}
test('generated prose stores dollar and parenthesis-delimited formulas as editable inline math',()=>{
 const blocks=generate(String.raw`The group $\mathbb{Z}/3\mathbb{Z}$ satisfies \(x^3=1\).`);
 assert.deepEqual(blocks[0].content.filter(segment=>segment.math).map(segment=>segment.text),[String.raw`\mathbb{Z}/3\mathbb{Z}`,'x^3=1']);
 const html=renderToStaticMarkup(React.createElement(ReadOnlyPageBlocks,{blocks,entities:[],pages:[],vaultId:'test',onOpenEntity(){},onOpenPage(){}}));
 assert.equal((html.match(/class="inline-math"/g)??[]).length,2);
 assert.equal((html.match(/<math /g)??[]).length,2);assert.ok(!html.includes('katex-error'));
});
test('citation anchors inside a formula move after the complete formula',()=>{
 const blocks=generate('Use $x^3=1$ in this group.','paragraph',[{startLine:1,endLine:1,anchor:'x^3'}]);
 assert.deepEqual(blocks[0].content,[{text:'Use '},{text:'x^3=1',math:true},{text:' [L: 1]'},{text:' in this group.'}]);
});
test('standalone display delimiters are removed and source references remain outside equations',()=>{
 for(const text of [String.raw`$$x^3=1$$`,String.raw`\[x^3=1\]`,'x^3=1']) {
  const blocks=generate(text,'math');
  assert.deepEqual(blocks[0].content,[{text:'x^3=1'}]);
  assert.equal(blocks[1].content[0].text,' [L: 1]');
 }
});
test('literal code, quotations, currency and incomplete formulas are preserved',()=>{
 const text=String.raw`Code \`$x$\`; cost $5 and $10; incomplete $x.`;
 assert.ok(generate(text)[0].content.every(segment=>!segment.math));
 assert.deepEqual(generate('$x^3$','code')[0].content,[{text:'$x^3$'}]);
 const quoted=generate('$x^3$','quote');assert.ok(quoted[0].content.every(segment=>!segment.math));
 const sourceQuote='Z/(3) is cyclic.';
 const blocks=generate('Use $C_3$.','paragraph',[{startLine:1,endLine:1,quote:sourceQuote}]);
 assert.ok(blocks[0].content.some(segment=>segment.italic&&segment.text===` “${sourceQuote}”`));
});
test('the prompt requires LaTeX exposition even for plain-text sources and keeps quotations exact',()=>{
 const prompt=sourcePagePrompt('untrusted source');
 assert.match(prompt.instructions,/even when the source uses plain text/);
 assert.match(prompt.instructions,/blockType=math with bare LaTeX/);
 assert.match(prompt.instructions,/escape every LaTeX backslash/);
 assert.match(prompt.instructions,/quote blocks must retain the source's original characters/);
});
