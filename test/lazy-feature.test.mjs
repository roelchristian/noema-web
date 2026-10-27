import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {setupEntityDOM} from './helpers/entity-dom.mjs';
import {lazyFeature} from '../src/client/components/LazyFeature.tsx';

test('feature import waits for mount, shows pending fallback, and retries a rejected module',async t=>{
 const env=await setupEntityDOM(t);let attempts=0,resolve;
 const Feature=lazyFeature(()=>{attempts++;if(attempts===1)return Promise.reject(new Error('module unavailable'));return new Promise(done=>{resolve=done;});},'calendar');
 assert.equal(attempts,0);
 const original=console.error;console.error=()=>{};
 try {
  await act(async()=>env.root.render(React.createElement(Feature,{name:'Loaded calendar'})));
  assert.equal(attempts,1);assert.match(document.querySelector('[role=alert]').textContent,/could not be loaded/);
  await act(async()=>document.querySelector('[role=alert] button').click());
  assert.equal(attempts,2);assert.match(document.querySelector('[role=status]').textContent,/Loading calendar/);
  await act(async()=>resolve({default:({name})=>React.createElement('h1',null,name)}));
  assert.equal(document.querySelector('h1').textContent,'Loaded calendar');
 } finally {console.error=original;await env.close();}
});
