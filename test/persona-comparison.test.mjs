import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {PersonaComparisonStudio} from '../src/client/settings/PersonaComparisonStudio.tsx';
import {parsePersonaPreview} from '../src/server/modules/persona-preview.ts';
import {api} from '../src/client/api.ts';
import {setupDOM} from './helpers/dom.mjs';
const settings={model:'gpt-5-mini',reasoningEffort:'low'};
const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label);
const click=label=>act(async()=>button(label).click());
function fixture(t){const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));return root;}

test('comparison parser bounds untrusted passage and snapshots supported settings',()=>{
  const body={input:'A group has an identity.',personaId:'tutor',personaExpression:'expressive',modelSettings:{...settings,unexpected:'discard'}};
  const parsed=parsePersonaPreview(body);assert.deepEqual(parsed.modelSettings,settings);body.modelSettings.model='changed';assert.equal(parsed.modelSettings.model,settings.model);
  for(const override of [{input:''},{input:'x'.repeat(6001)},{personaId:'custom'},{personaExpression:'theatrical'},{modelSettings:{model:'unknown',reasoningEffort:'low'}}])assert.throws(()=>parsePersonaPreview({...parsed,...override}));
});

test('comparison makes no automatic calls, snapshots identical settings, renders provider text safely, and chooses explicit defaults',async t=>{
  const root=fixture(t);let calls=[],chosen=[];
  t.mock.method(api,'personaPreview',async(body)=>{calls.push(structuredClone(body));return {text:'<script>synthetic provider output</script>',persona:{id:body.personaId,version:2,origin:'builtin',expression:body.personaExpression},modelSettings:body.modelSettings};});
  await act(async()=>root.render(createElement(PersonaComparisonStudio,{modelSettings:settings,expression:'immersive',onChoose:(...args)=>chosen.push(args)})));
  assert.equal(calls.length,0);assert.match(document.body.textContent,/API charges/);
  await click('Generate comparison');assert.equal(calls.length,2);assert.equal(calls[0].input,calls[1].input);assert.deepEqual(calls[0].modelSettings,calls[1].modelSettings);assert.equal(calls[0].personaExpression,'immersive');assert.equal(document.querySelector('script'),null);
  await click('Just right');assert.equal(document.querySelector('[aria-pressed=true]').textContent,'Just right');assert.match(document.body.textContent,/device storage is unavailable|Feedback saved on this device/);
  await click('Use The Tutor as default');assert.deepEqual(chosen,[['tutor','immersive']]);
  await click('Generate comparison again');assert.equal(calls.length,4);
});

test('cancelled and stale responses are discarded; repeated runs recover after errors',async t=>{
  const root=fixture(t);let calls=[],fail=false;
  t.mock.method(api,'personaPreview',(body,signal)=>new Promise((resolve,reject)=>calls.push({body,signal,finish:()=>fail?reject(new Error('Synthetic provider unavailable')):resolve({text:'Synthetic late output',persona:{id:body.personaId,version:2,origin:'builtin'},modelSettings:settings})})));
  const render=(expression='expressive')=>root.render(createElement(PersonaComparisonStudio,{modelSettings:settings,expression,onChoose:()=>{}}));
  await act(async()=>render());await click('Generate comparison');assert.equal(calls.length,1);
  await click('Cancel comparison');assert.equal(calls[0].signal.aborted,true);await act(async()=>calls[0].finish());assert.equal(document.querySelector('.persona-studio-output'),null);assert.equal(calls.length,1);
  await click('Generate comparison again');await act(async()=>render('subtle'));assert.equal(calls[1].signal.aborted,true);await act(async()=>calls[1].finish());assert.equal(document.querySelector('.persona-studio-output'),null);
  await click('Generate comparison');fail=true;await act(async()=>calls[2].finish());assert.equal(calls.length,4);await act(async()=>calls[3].finish());assert.match(document.querySelector('[role=alert]').textContent,/Synthetic provider unavailable/);
  await click('Generate comparison again');fail=false;await act(async()=>calls[4].finish());await act(async()=>calls[5].finish());assert.equal(document.querySelectorAll('.persona-studio-output').length,2);
});

test('individual cancellation skips queued personas and inactive Settings aborts current work',async t=>{
  const root=fixture(t);const calls=[];
  t.mock.method(api,'personaPreview',(body,signal)=>new Promise(resolve=>calls.push({body,signal,finish:()=>resolve({text:'Synthetic output',persona:{id:body.personaId,version:2,origin:'builtin'},modelSettings:settings})})));
  const render=active=>root.render(createElement(PersonaComparisonStudio,{active,modelSettings:settings,onChoose:()=>{}}));
  await act(async()=>render(true));await click('Generate comparison');await click('Cancel The Tutor');await act(async()=>calls[0].finish());assert.equal(calls.length,1);assert.equal(document.querySelectorAll('.persona-studio-output').length,1);
  await click('Generate comparison again');await act(async()=>render(false));assert.equal(calls[1].signal.aborted,true);await act(async()=>calls[1].finish());assert.equal(document.querySelectorAll('.persona-studio-output').length,0);assert.equal(calls.length,2);
});
