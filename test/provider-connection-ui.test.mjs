import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {ProviderConnection} from '../src/client/settings/ProviderConnection.tsx';
import {api} from '../src/client/api.ts';
import {setupDOM} from './helpers/dom.mjs';

const configured={configured:true,expiresAt:'2099-01-01T00:00:00.000Z'};
function button(text){return [...document.querySelectorAll('button')].find(item=>item.textContent===text);}

test('shared connections validate and remove securely without altering preference state',async t=>{
  const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>root.unmount()));
  let stored=true,validations=0,removals=0,events=0;
  t.mock.method(api,'intelligence',async()=>({...configured,configured:stored,apiKey:'must-never-render'}));
  t.mock.method(api,'validateIntelligence',async()=>{validations++;return {ok:true};});
  t.mock.method(api,'removeIntelligence',async()=>{removals++;stored=false;return {configured:false,expiresAt:null};});
  const preferenceSave=t.mock.method(api,'saveIntelligencePreferences',async()=>{throw Error('Unexpected preference update');});
  window.addEventListener('noema:tts-preferences',()=>events++);
  await act(async()=>root.render(createElement(ProviderConnection,{provider:'openai'})));
  assert.equal(document.querySelector('[data-connection-state]').textContent,'Ready');
  assert.match(document.body.textContent,/Available across all vaults.*search indexing is configured separately for each vault/s);
  assert.equal(document.querySelector('input[type=password]').value,'');
  assert.doesNotMatch(document.body.innerHTML,/must-never-render/);
  await act(async()=>button('Validate connection').click());
  assert.equal(validations,1);assert.match(document.body.textContent,/Connection validated/);assert.equal(events,0);
  await act(async()=>button('Remove key').click());
  assert.equal(removals,1);assert.equal(events,1);assert.equal(preferenceSave.mock.callCount(),0);
  assert.equal(document.querySelector('[data-connection-state]').textContent,'Setup required');
  assert.equal(button('Validate connection').disabled,true);
});

test('provider changes ignore stale status and connection errors can be retried',async t=>{
  const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>root.unmount()));
  let finishOpenAI,checks=0;
  t.mock.method(api,'intelligence',()=>new Promise(resolve=>{finishOpenAI=resolve;}));
  t.mock.method(api,'geminiCredential',async()=>{if(++checks===1)throw Error('Secure storage unavailable');return configured;});
  await act(async()=>root.render(createElement(ProviderConnection,{provider:'openai'})));
  assert.equal(document.querySelector('[data-connection-state]').textContent,'Checking…');
  await act(async()=>root.render(createElement(ProviderConnection,{provider:'gemini'})));
  assert.equal(document.querySelector('[data-connection-state]').textContent,'Error');
  await act(async()=>finishOpenAI(configured));
  assert.equal(document.querySelector('[data-connection-state]').textContent,'Error','Old provider response cannot replace Gemini state');
  await act(async()=>button('Check setup').click());
  assert.equal(checks,2);assert.equal(document.querySelector('[data-connection-state]').textContent,'Ready');
  assert.equal(document.querySelector('section').getAttribute('aria-label'),'Gemini connection');
});
