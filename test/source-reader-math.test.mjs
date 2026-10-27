import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';
import {SourceReaderInline,SourceReaderText} from '../src/client/sources/SourceReaderText.tsx';

const render=(component,props)=>new JSDOM(renderToStaticMarkup(React.createElement(component,props))).window.document;
test('complete inline LaTeX renders variables, sets, powers, fractions and maps through standard KaTeX',()=>{
 const formulas=[String.raw`G=\{x^iy^j:0\leq i,j\leq p-1\}`,String.raw`\langle x\rangle\cap\langle y\rangle=\{e\}`,String.raw`f:\mathbb{Z}/(p)\times\mathbb{Z}/(p)\longrightarrow G`,String.raw`x^{-i'+i}=y^{j'-j}`,String.raw`\frac{a_1+b^2}{c}\neq0`];
 const text=formulas.map(formula=>`$${formula}$`).join(' and '),offset=40;
 const doc=render(SourceReaderInline,{text,startOffset:offset}),leaves=[...doc.querySelectorAll('.summary-math-inline')];
 assert.equal(leaves.length,formulas.length);assert.equal(doc.querySelector('.katex-error'),null);
 leaves.forEach((leaf,index)=>{
  assert.ok(leaf.querySelector('.katex'));assert.equal(leaf.querySelector('annotation').textContent,formulas[index]);
  assert.equal(text.slice(Number(leaf.dataset.sourceStart)-offset,Number(leaf.dataset.sourceEnd)-offset),`$${formulas[index]}$`);
  assert.equal(leaf.dataset.sourceAtomic,'true');
 });
});
test('complete display LaTeX retains multiline source coordinates and full-formula highlights',()=>{
 const formula=String.raw`H x\subset\bigcup_{i=1}^{p-1}x^iH`,text=`Before.\n\n$$\n${formula}\n$$\n\nAfter.`,startOffset=15,start=startOffset+text.indexOf('$$'),end=startOffset+text.lastIndexOf('$$')+2;
 const doc=render(SourceReaderText,{text,startOffset,highlights:[{id:'math-highlight',startOffset:start+2,endOffset:end-2,createdAt:'2026-10-27',color:'yellow'}]}),leaf=doc.querySelector('.summary-math-display');
 assert.ok(leaf.querySelector('.katex-display'));assert.equal(doc.querySelector('.katex-error'),null);assert.equal(leaf.querySelector('annotation').textContent,formula);
 assert.equal(Number(leaf.dataset.sourceStart),start);assert.equal(Number(leaf.dataset.sourceEnd),end);assert.equal(leaf.dataset.highlightId,'math-highlight');
 assert.match(doc.body.textContent,/Before\./);assert.match(doc.body.textContent,/After\./);
});
test('standard reader preserves literal code and does not guess un-delimited mathematical prose',()=>{
 const doc=render(SourceReaderInline,{text:'`x^{i}` and x^{i} and $x^{i}$'});
 assert.equal(doc.querySelector('code').textContent,'x^{i}');assert.equal(doc.querySelectorAll('.katex').length,1);assert.match(doc.body.textContent,/and x\^\{i\} and/);
});
