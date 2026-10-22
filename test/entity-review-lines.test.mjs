import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM} from './helpers/dom.mjs';
import {renderedReviewLines} from '../src/client/intelligence/entity-review-lines.ts';

test('rendered lines follow layout coordinates across text nodes and change when wrapping changes',async t=>{
 const env=setupDOM(t),{dom}=env;
 const p=document.createElement('p');p.innerHTML='One <span>long</span> paragraph with multiple wrapped lines.';
 document.body.append(p);
 let columns=12;
 t.mock.method(dom.window.Range.prototype,'getBoundingClientRect',function(){
  const walker=document.createTreeWalker(p,4);let offset=this.startOffset;
  for(let node=walker.nextNode();node&&node!==this.startContainer;node=walker.nextNode())offset+=node.textContent.length;
  return {top:Math.floor(offset/columns)*20,height:20};
 });
 try{
  const wide=renderedReviewLines(p);
  assert.deepEqual(wide.slice(0,3),[{start:0,end:12},{start:12,end:24},{start:24,end:36}]);
  assert.equal(wide.at(-1).end,p.textContent.length);
  columns=6;
  const narrow=renderedReviewLines(p);
  assert.ok(narrow.length>wide.length);
  assert.deepEqual(narrow[0],{start:0,end:6});
  assert.equal(narrow.map(line=>p.textContent.slice(line.start,line.end)).join(''),p.textContent);
 }finally{await env.close();}
});
