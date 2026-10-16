import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {makeSearchSnippet,highlightParts} from '../src/shared/search-snippets.ts';
import {HighlightedText} from '../src/client/search/HighlightedText.tsx';
test('snippets focus on late literal matches and preserve a bounded readable excerpt',()=>{
 const text='Opening context. '.repeat(100)+'The garden plan uses native trees for shade. '+'Further details. '.repeat(100);
 const snippet=makeSearchSnippet(text,'garden plan');
 assert.ok(snippet.length<=240);assert.match(snippet,/garden plan/);assert.ok(snippet.startsWith('…'));assert.ok(snippet.endsWith('…'));
 assert.equal(makeSearchSnippet('  Short\n note\ttext  ','note'),'Short note text');
 const emoji=makeSearchSnippet('😀'.repeat(300)+' garden 🌿 '+'🌲'.repeat(300),'garden');
 assert.ok(emoji.length<=240);assert.equal(emoji.isWellFormed(),true);assert.match(emoji,/garden/);
});
test('multiword queries highlight literal terms and find a passage even without a phrase match',()=>{
 const text='Generic introduction. '.repeat(50)+'Gardens need water, while soil matters for gardens. '+'Closing context. '.repeat(40);
 const snippet=makeSearchSnippet(text,'soil gardens');
 assert.match(snippet,/Gardens/);assert.match(snippet,/soil/);
 const parts=highlightParts(snippet,'soil gardens');
 assert.deepEqual(parts.filter(part=>part.match).map(part=>part.text),['Gardens','soil','gardens']);
 assert.equal(parts.map(part=>part.text).join(''),snippet);
 assert.deepEqual(highlightParts('Nothing here','  '),[{text:'Nothing here',match:false}]);
});
test('highlighting escapes regex characters, handles case and Unicode, and renders note content as inert text',()=>{
 assert.deepEqual(highlightParts('Find C++ and c++ here','c++').filter(part=>part.match).map(part=>part.text),['C++','c++']);
 assert.deepEqual(highlightParts('Coffee CAFÉ café','café').filter(part=>part.match).map(part=>part.text),['CAFÉ','café']);
 const text='<script>alert("garden")</script><img onerror="bad">';
 const html=renderToStaticMarkup(React.createElement(HighlightedText,{text,query:'garden'}));
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));
 assert.ok(html.includes('<mark class="search-highlight">garden</mark>'));
});
test('semantic excerpts without lexical overlap remain unhighlighted',()=>{
 const text='Native plants flourish with regular irrigation.';
 const snippet=makeSearchSnippet(text,'water gardens');
 assert.equal(snippet,text);assert.equal(highlightParts(snippet,'water gardens').some(part=>part.match),false);
});
