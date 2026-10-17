import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {clipboardBlocks} from '../src/client/editor/paste.ts';
import {segmentHTML} from '../src/client/editor/segments.tsx';

function clipboard(text,html){
 const dom=new JSDOM('');
 const keys=['document','Node','HTMLElement','DOMParser'],previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 try{
  for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:dom.window[key]});
  return clipboardBlocks(text,html);
 }finally{
  keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});dom.window.close();
 }
}
test('clipboard Markdown renders parenthesis and bracket maths with and without HTML',()=>{
 const text=String.raw`Inline \(x_1 + x_2\).
\[\frac{a}{b}\]`;
 for(const html of ['',String.raw`<span>Inline \(x_1 + x_2\).<br>\[\frac{a}{b}\]</span>`]){
  const blocks=clipboard(text,html);
  assert.deepEqual(blocks.map(b=>b.type),['paragraph','math']);
  assert.ok(blocks[0].content.some(s=>s.math&&s.text==='x_1 + x_2'));
  assert.equal(blocks[1].content[0].text,String.raw`\frac{a}{b}`);
  assert.match(segmentHTML(blocks[0].content,[]),/class="inline-math"/);
 }
});
test('rich paste keeps formatting and links while reading math split across HTML spans',()=>{
 const [block]=clipboard('',String.raw`<p><strong>Bold text</strong> <a href="https://example.com">link</a>: <span>\(x</span><em>_1 + y</em><span>\)</span> and $z_1$.</p>`);
 assert.ok(block.content.some(s=>s.bold&&s.text==='Bold text'));
 assert.ok(block.content.some(s=>s.href==='https://example.com'&&s.text==='link'));
 assert.deepEqual(block.content.filter(s=>s.math).map(s=>s.text),['x_1 + y','z_1']);
});
test('rich display math spans paragraphs without consuming the surrounding content',()=>{
 const blocks=clipboard('',String.raw`<p><strong>Before</strong></p><p>\[</p><p>\begin{aligned}</p><p>x &amp;= 1 \\</p><p>y &amp;= 2</p><p>\end{aligned}</p><p>\]</p><p>After \(z\)</p>`);
 assert.deepEqual(blocks.map(b=>b.type),['paragraph','math','paragraph']);
 assert.ok(blocks[0].content[0].bold);
 assert.equal(blocks[1].content[0].text,String.raw`\begin{aligned}
x &= 1 \\
y &= 2
\end{aligned}`);
 assert.equal(blocks[2].content.find(s=>s.math).text,'z');
 assert.equal(new Set(blocks.map(b=>b.id)).size,blocks.length);
});
test('rich tables, headings, and lists render inline equations without losing structure',()=>{
 const blocks=clipboard('',String.raw`<h2>Heading \(a\)</h2><ul><li>Item \(b\)</li></ul><table><tr><td><b>Cell</b> \(c\)</td></tr></table>`);
 assert.deepEqual(blocks.map(b=>b.type),['heading2','bullet','table']);
 assert.equal(blocks[0].content.find(s=>s.math).text,'a');
 assert.equal(blocks[1].content.find(s=>s.math).text,'b');
 assert.ok(blocks[2].rows[0][0].some(s=>s.bold&&s.text==='Cell'));
 assert.equal(blocks[2].rows[0][0].find(s=>s.math).text,'c');
});
test('rich code, escaped and unmatched delimiters, and existing math remain intact',()=>{
 const blocks=clipboard('',String.raw`<p><code>\(code\) \[literal\]</code> and \\(escaped\), \(unfinished, \] unmatched.</p><pre>\[fenced\]</pre><p><span data-math="x_1">Rendered formula</span></p>`);
 assert.deepEqual(blocks.map(b=>b.type),['paragraph','paragraph','paragraph']);
 assert.ok(blocks[0].content[0].code);
 assert.ok(blocks[0].content.every(s=>!s.math));
 assert.ok(blocks[1].content[0].code);
 assert.deepEqual(blocks[2].content,[{text:'x_1',math:true}]);
 const [literal]=clipboard('', '<span>`'+String.raw`\(code\)`+'` then '+String.raw`\(math\)`+'</span>');
 assert.deepEqual(literal.content.filter(s=>s.math).map(s=>s.text),['math']);
});
