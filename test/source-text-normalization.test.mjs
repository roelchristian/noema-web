import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSourceText} from '../src/server/modules/source-text-normalization.ts';
import {sourceStructure,mergeEnrichedSourceStructure} from '../src/server/modules/source-structure.ts';

for(const fixture of ['direct','flattened-extraction'])test(`${fixture}: preserves article and bibliography boundaries with complete raw provenance`,()=>{
 const raw=JSON.parse(readFileSync(new URL(`./fixtures/source-normalization/${fixture}.json`,import.meta.url),'utf8'));
 const result=normalizeSourceText(raw.text,raw.structuralNodes,raw.pageStartLines);
 assert.equal(result.structuralNodes.length,7);
 assert.deepEqual(result.structuralNodes.slice(0,6).map(node=>node.text.match(/^\d+/)?.[0]),['1','2','3','4','5','6']);
 assert.match(result.text,/\n\n## References\n\n/);
 const bibliography=result.text.split('## References\n\n')[1].split(/\n\n©/)[0];
 const entries=bibliography.split('\n\n').filter(block=>/^[\p{L}][^\n]{0,100}?\.\s+(?:1[5-9]|20)\d{2}[a-z]?\./u.test(block));
 assert.equal(entries.length,13);
 assert.match(entries.find(entry=>entry.startsWith('McGrath, Alister E. 2013.')),/Wiley-Blackwell\./);
 if(fixture==='direct')for(const span of ['Regan Arts.','Dante as well.','p. 109).'])assert.ok(result.text.includes(span),span);
 assert.equal(result.pageStartLines.length,5);
 assert.equal(result.rawText,raw.text);
 let cursor=0;
 for(const entry of result.offsetMap){
  assert.equal(entry.normalizedStart,cursor);cursor=entry.normalizedEnd;
  assert.ok(entry.rawStart>=0&&entry.rawEnd>=entry.rawStart&&entry.rawEnd<=raw.text.length);
  if(entry.kind==='text')assert.equal(result.text.slice(entry.normalizedStart,entry.normalizedEnd),raw.text.slice(entry.rawStart,entry.rawEnd));
 }
 assert.equal(cursor,result.text.length);
 // Every substantive raw character survives normalization (whitespace and the
 // added Markdown/page syntax may change, but source words may not disappear).
 for(let i=0;i<raw.text.length;i++)if(/\S/u.test(raw.text[i]))assert.ok(result.offsetMap.some(entry=>entry.rawStart<=i&&entry.rawEnd>i),`unmapped raw offset ${i}`);
});

test('ordinary lists, code, explicit paragraphs and CRLF offsets remain intact',()=>{
 const raw='First paragraph.\r\n\r\nSecond paragraph.\r\n\r\n1. Apples\r\n2. Bananas\r\n3. Pears\r\n\r\n```\r\nReferences\r\n```';
 const result=normalizeSourceText(raw);
 assert.equal(result.structuralNodes.length,0);
 assert.ok(result.text.includes('First paragraph.\n\nSecond paragraph.'));
 assert.ok(result.text.includes('1. Apples\n2. Bananas\n3. Pears'));
 for(const entry of result.offsetMap.filter(entry=>entry.kind==='text'))assert.equal(result.text.slice(entry.normalizedStart,entry.normalizedEnd),raw.slice(entry.rawStart,entry.rawEnd));
 assert.equal(sourceStructure('A paragraph.\nReferences\nAn entry').at(-1).text,'References');
});

test('enrichment cannot rename or demote an extracted heading but can refine semantic blocks',()=>{
 const text='## 1. Introduction\n\nSome prose.\n\nTheorem 1. An assertion.\nProof. A proof.';
 const known=[{text:'1. Introduction',startLine:1,kind:'section',level:2},{text:'Theorem 1.',startLine:5,kind:'theorem'}];
 const nodes=mergeEnrichedSourceStructure(text,known,[{text:'Introduction renamed',startLine:1,kind:'example',level:4},{text:'Theorem 1.',startLine:5,kind:'theorem',endLine:6}]);
 assert.deepEqual(nodes[0],known[0]);
 assert.equal(nodes.find(node=>node.startLine===5).endLine,6);
});
