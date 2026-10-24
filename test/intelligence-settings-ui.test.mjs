import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {VoiceSettings} from '../src/client/settings/VoiceSettings.tsx';
import {NarrationSettings} from '../src/client/settings/NarrationSettings.tsx';
import {api} from '../src/client/api.ts';
import {defaultIntelligencePreferences,defaultPageEnrichmentPreferences} from '../src/shared/intelligence.ts';
import {defaultNarrationPreferences} from '../src/shared/narration.ts';
import {setupDOM} from './helpers/dom.mjs';

const configuration=()=>({...defaultIntelligencePreferences,manualRequestsPerMinute:5,pageEnrichment:{...defaultPageEnrichmentPreferences},ttsEnabled:false,ttsProvider:'kokoro',ttsVoice:'puck',narration:structuredClone(defaultNarrationPreferences),configured:false,expiresAt:null});
const model={ready:true,model:'kokoro-82m-v1.0',missingFiles:[],downloadCommand:'npm run tts:download'};
const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent===label);
const click=label=>act(async()=>button(label).click());
const edit=(id,value)=>act(async()=>{const input=document.getElementById(id);input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value}});});
const submit=()=>act(async()=>document.querySelector('.voice-preferences-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
function fixture(t){const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));t.mock.method(api,'speechModel',async()=>model);return {env,root};}

test('Voice saves only its own draft, survives inactive navigation, and keeps failed/repeated saves explicit',async t=>{
  const {root}=fixture(t);let saved=configuration(),requests=[],events=0,finish,fail=true;
  t.mock.method(api,'intelligence',async()=>saved);
  t.mock.method(api,'saveVoicePreferences',value=>new Promise((resolve,reject)=>{requests.push(structuredClone(value));finish=()=>fail?reject(new Error('Could not save preferences.')):resolve(saved={...saved,...value,model:'gpt-6-luna'});}));
  window.addEventListener('noema:tts-preferences',()=>events++);
  const render=active=>root.render(createElement(VoiceSettings,{active}));
  await act(async()=>render(true));assert.equal(document.querySelector('#ai-tts-enabled').getAttribute('aria-checked'),'false');assert.equal(button('Save voice preferences').disabled,true);
  await edit('ai-tts-voice','echo');await edit('narration-pace','0.75');
  await act(async()=>render(false));await act(async()=>render(true));assert.equal(document.querySelector('#ai-tts-voice').value,'echo');assert.equal(document.querySelector('#narration-pace').value,'0.75');
  await submit();assert.equal(document.querySelector('#ai-tts-voice').disabled,true);assert.equal(events,0);
  await act(async()=>finish());assert.match(document.querySelector('[role=alert]').textContent,/Could not save/);assert.equal(button('Save voice preferences').disabled,false);
  fail=false;await submit();await act(async()=>finish());assert.equal(events,1);assert.equal(button('Save voice preferences').disabled,true);assert.equal(saved.ttsVoice,'echo');assert.equal(saved.ttsEnabled,false);
  assert.deepEqual(Object.keys(requests[1]).sort(),['narration','ttsEnabled','ttsProvider','ttsVoice']);assert.equal(requests[1].narration.pace,0.75);
  await act(async()=>root.render(createElement(VoiceSettings,{key:'reopened'})));assert.equal(document.querySelector('#ai-tts-voice').value,'echo');
});

test('Kokoro setup is secondary, explicit and recoverable after interrupted downloads or checks',async t=>{
  const {root}=fixture(t);let installed=false,downloads=0,checks=0,finish;
  t.mock.method(api,'intelligence',async()=>configuration());
  t.mock.method(api,'speechModel',async()=>{checks++;if(checks===1)throw new Error('Model storage unavailable.');return {...model,ready:installed,missingFiles:installed?[]:['voices-v1.0.bin']};});
  t.mock.method(api,'downloadSpeechModel',()=>new Promise((resolve,reject)=>{downloads++;finish=()=>downloads===1?reject(new Error('Download interrupted.')):resolve(installed=true);}));
  await act(async()=>root.render(createElement(VoiceSettings)));
  assert.equal(document.querySelector('.local-speech-model'),null);assert.match(document.querySelector('#ai-tts-model-status').textContent,/Error/);
  await act(async()=>document.querySelector('#ai-tts-enabled').click());assert.equal(downloads,0);
  await click('Local model setup');assert.match(document.querySelector('[role=alert]').textContent,/Model storage unavailable/);
  await click('Retry model check');assert.match(document.querySelector('.local-speech-model').textContent,/voices-v1.0.bin/);
  await click('Download Kokoro model');assert.equal(button('Download Kokoro model').disabled,true);await act(async()=>finish());assert.match(document.querySelector('[role=alert]').textContent,/Download interrupted/);
  await click('Download Kokoro model');await act(async()=>finish());assert.equal(downloads,2);assert.equal(button('Download Kokoro model'),undefined);assert.match(document.querySelector('.local-speech-model').textContent,/ready for local speech/);
});

test('unsaved cloud voices preview independently while disabled, gate controls, and discard cancelled or inactive responses',async t=>{
  const {root}=fixture(t);let requests=[],saved=configuration(),revoked=[];
  t.mock.method(api,'intelligence',async()=>saved);t.mock.method(api,'saveVoicePreferences',async()=>{throw new Error('Preview must never save');});
  t.mock.method(URL,'createObjectURL',()=> 'blob:preview');t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'/api/intelligence/speech/preview');return new Promise(resolve=>requests.push({options,finish:()=>resolve({ok:true,blob:async()=>new Blob(['synthetic'],{type:'audio/wav'})})}));});
  const render=active=>root.render(createElement(VoiceSettings,{active,vaultId:'synthetic-vault'}));
  await act(async()=>render(true));assert.equal(document.querySelector('#narration-preset'),null);assert.equal(button('Listen to sample').disabled,false);
  await edit('ai-tts-provider','gemini');assert.equal(saved.ttsProvider,'kokoro');assert.ok(document.querySelector('#narration-preset'));assert.equal(document.querySelector('#ai-tts-voice').options.length,4);assert.match(document.querySelector('#ai-tts-description').textContent,/Google.*API credential.*charges/);
  await click('Browse all voices');assert.equal(document.querySelector('#ai-tts-voice').options.length,30);await edit('ai-tts-voice','Sulafat');
  await edit('voice-search','Puck');assert.equal(document.querySelector('#ai-tts-voice').value,'Sulafat');assert.match(document.querySelector('#ai-tts-voice option:checked').textContent,/selected; outside search/);assert.deepEqual([...document.querySelector('#ai-tts-voice').options].map(option=>option.value),['Sulafat','Puck']);
  await edit('voice-search','no-such-voice');assert.equal(document.querySelector('#ai-tts-voice').value,'Sulafat');assert.match(document.body.textContent,/No matching voices/);await edit('voice-search','');
  await edit('narration-pace','0.75');await click('Listen to sample');
  const body=JSON.parse(requests[0].options.body);assert.equal(body.provider,'gemini');assert.equal(body.voice,'Sulafat');assert.equal(body.narration.pace,0.75);assert.equal(saved.ttsEnabled,false);assert.equal(saved.ttsProvider,'kokoro');assert.equal(requests[0].options.headers['X-Vault-Id'],'synthetic-vault');
  await click('Cancel preview');assert.equal(requests[0].options.signal.aborted,true);await act(async()=>requests[0].finish());assert.equal(document.querySelector('audio'),null);
  await click('Listen to sample');await act(async()=>render(false));assert.equal(requests[1].options.signal.aborted,true);await act(async()=>requests[1].finish());assert.equal(document.querySelector('audio'),null);
  await act(async()=>render(true));await click('Listen to sample');await act(async()=>requests[2].finish());assert.ok(document.querySelector('audio'));await edit('ai-tts-provider','kokoro');assert.deepEqual(revoked,['blob:preview']);assert.equal(document.querySelector('#narration-preset'),null);
  await click('Narration & pronunciation');for(const id of ['narration-accent','narration-warmth','narration-expression'])assert.equal(document.getElementById(id),null);
});

test('pronunciation audition isolates one entry and cancels stale responses without changing the draft',async t=>{
  const {root}=fixture(t);let value=structuredClone(defaultNarrationPreferences),calls=[],pending,revoked=[];
  t.mock.method(URL,'createObjectURL',()=> 'blob:preview');t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
  t.mock.method(globalThis,'fetch',async(_url,options)=>{calls.push(options);return new Promise(resolve=>{pending=()=>resolve({ok:true,blob:async()=>new Blob(['synthetic'],{type:'audio/wav'})});});});
  const render=()=>root.render(createElement(NarrationSettings,{value,onChange:next=>{value=next;render();},provider:'gemini',voice:'Puck',vaultId:'default',disabled:false,previewEnabled:true}));
  await act(async()=>render());await click('Add pronunciation');await edit('pronunciation-word-0','Noema');await edit('pronunciation-spoken-0','noh ee mah');assert.equal(calls.length,0);
  await edit('pronunciation-language-0','de');await act(async()=>{value={...value,rules:{...value.rules,numbers:'digits'}};render();});
  await click('Listen to pronunciation 1');const body=JSON.parse(calls[0].body);assert.equal(body.text,'Noema');assert.equal(body.narration.locale,'de-DE');assert.equal(body.narration.pronunciations.length,1);assert.equal(body.narration.pronunciations[0].language,'');assert.equal(body.narration.rules.numbers,'preserve');assert.equal(value.locale,'en-US');assert.equal(value.rules.numbers,'digits');
  await edit('pronunciation-spoken-0','no eh mah');assert.equal(calls[0].signal.aborted,true);await act(async()=>pending());assert.equal(document.querySelector('audio'),null);
  await click('Listen to sample');await act(async()=>pending());assert.equal(document.querySelector('audio').getAttribute('src'),'blob:preview');await click('Remove pronunciation 1');assert.equal(value.pronunciations.length,0);assert.equal(document.querySelector('audio'),null);assert.deepEqual(revoked,['blob:preview']);assert.equal(calls.length,2);
});
