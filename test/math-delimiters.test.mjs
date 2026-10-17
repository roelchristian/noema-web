import {test} from 'node:test';
import assert from 'node:assert/strict';
import {markdownInline,markdownBlocks} from '../src/client/editor/paste.ts';
import {inlineMathAtCaret,displayMathSource} from '../src/client/editor/math-delimiters.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';

test('parenthesis math works beside dollar math, inside formatting and table cells',()=>{
 const input=String.raw`Area \(\pi r^2\), \(x_1 + x_2\), and $y_1$.`;
 assert.deepEqual(markdownInline(input).filter(s=>s.math).map(s=>s.text),[String.raw`\pi r^2`,'x_1 + x_2','y_1']);
 assert.deepEqual(markdownInline(String.raw`**\(x_1\)**`),[{bold:true,math:true,text:'x_1'}]);
 const [table]=markdownBlocks(String.raw`| Formula | Value |
| --- | --- |
| \(x_1\) | $y_1$ |`);
 assert.deepEqual(table.rows[1][0],[{math:true,text:'x_1'}]);
 assert.deepEqual(table.rows[1][1],[{math:true,text:'y_1'}]);
});
test('bracket display equations form separate blocks and preserve multiline commands',()=>{
 const blocks=markdownBlocks(String.raw`Before
\[\frac{a_1}{b_2}\]
After
\[
\begin{aligned}
x &= 1 \\
y &= 2
\end{aligned}
\]
End`);
 assert.deepEqual(blocks.map(b=>b.type),['paragraph','math','paragraph','math','paragraph']);
 assert.equal(blocks[1].content[0].text,String.raw`\frac{a_1}{b_2}`);
 assert.equal(blocks[3].content[0].text,String.raw`\begin{aligned}
x &= 1 \\
y &= 2
\end{aligned}`);
 assert.deepEqual(markdownBlocks(String.raw`\[x\]
\[y\]`).map(b=>b.content[0].text),['x','y']);
});
test('incomplete and escaped delimiters, empty expressions and code stay literal',()=>{
 for(const text of [String.raw`\(unfinished`,String.raw`\\(literal\)`,String.raw`\( \)`,String.raw`\[unfinished`,String.raw`\\[literal\]`]){
  assert.ok(markdownInline(text).every(s=>!s.math));assert.ok(markdownBlocks(text).every(b=>b.type!=='math'));
 }
 assert.deepEqual(markdownInline('`'+String.raw`\(literal\)`+'`'),[{code:true,text:String.raw`\(literal\)`}]);
 assert.deepEqual(markdownBlocks('```tex\n'+String.raw`\[literal\]`+'\n```')[0].content,[{code:true,text:String.raw`\[literal\]`}]);
});
test('typing completion recognizes delimiters only at the caret and whole display blocks',()=>{
 assert.deepEqual(inlineMathAtCaret(String.raw`Area \( \pi r^2 \)`),{index:5,source:String.raw`\pi r^2`});
 assert.deepEqual(inlineMathAtCaret('Area $x_1$'),{index:5,source:'x_1'});
 for(const text of [String.raw`\(unfinished`,String.raw`\\(literal\)`,String.raw`\( \)`,String.raw`\(x\) after`])assert.equal(inlineMathAtCaret(text),undefined);
 assert.equal(displayMathSource(String.raw`\[ x_1 \]`),'x_1');
 assert.equal(displayMathSource('$$x_1$$'),'x_1');
 assert.equal(displayMathSource(String.raw`Before \[x\]`),undefined);
 assert.equal(displayMathSource(String.raw`\[x\] after`),undefined);
 assert.equal(displayMathSource(String.raw`\[ \]`),undefined);
});
test('parenthesis and bracket equations preserve their native math records across saves',()=>{
 const db=openDatabase(':memory:');
 try{
  const store=new Store(db),pages=new Pages(store,new Knowledge(store));const page=pages.create('default',{title:'Delimiters'});
  const blocks=markdownBlocks(String.raw`Inline \(x_1^2\).
\[\frac{a}{b}\]`);
  pages.update('default',page.id,{...page,blocks});assert.deepEqual(pages.get('default',page.id).blocks,blocks);
 }finally{db.close();}
});
