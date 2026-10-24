import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {api} from '../src/client/api.ts';
import {SettingsDialog} from '../src/client/settings/SettingsDialog.tsx';
import {EmbeddingSettings} from '../src/client/settings/EmbeddingSettings.tsx';
import {defaultAppearance} from '../src/client/settings/appearance.ts';
import {defaultCalendarSettings} from '../src/client/settings/calendar-settings.ts';
import {defaultIntelligencePreferences,defaultPageEnrichmentPreferences} from '../src/shared/intelligence.ts';

const initial=()=>({...defaultIntelligencePreferences,pageEnrichment:{...defaultPageEnrichmentPreferences},manualRequestsPerMinute:5,ttsEnabled:false,ttsProvider:'kokoro',ttsVoice:'puck',configured:false,expiresAt:null});
const edit=async(id,value)=>act(async()=>{const input=document.getElementById(id);input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value}});});
const click=label=>act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent===label).click());

test('separate category panels preserve drafts, submit only their own category, and stay lazy',async t=>{
  const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
  env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  let saved=initial(),statusCalls=0,modelCalls=0,geminiCalls=0,writes=[];
  t.mock.method(api,'intelligence',async()=>{statusCalls++;return structuredClone(saved);});
  t.mock.method(api,'speechModel',async()=>{modelCalls++;return {ready:true,missingFiles:[]};});
  t.mock.method(api,'geminiCredential',async()=>{geminiCalls++;return {configured:false,expiresAt:null};});
  t.mock.method(api,'saveAIPreferences',async value=>{writes.push({category:'ai',value});saved={...saved,...value};return structuredClone(saved);});
  t.mock.method(api,'saveVoicePreferences',async value=>{writes.push({category:'voice',value});saved={...saved,...value};return structuredClone(saved);});
  await act(async()=>root.render(createElement(SettingsDialog,{appearance:defaultAppearance(),calendarSettings:defaultCalendarSettings(),vault:null,storageError:false,onChange(){},onCalendarSettingsChange(){},onExitFocus(){},onClose(){},onChangePassphrase:async()=>{},onBeforeNetworkChange:async()=>{},onOpenPassage:async()=>{},onOpenPage:async()=>{},onOpenEntity:async()=>{}})));
  assert.equal(statusCalls,0);assert.equal(modelCalls,0);assert.equal(geminiCalls,0);
  const tab=id=>act(async()=>document.getElementById('settings-tab-'+id).click());
  await tab('intelligence');assert.equal(statusCalls,1);assert.equal(modelCalls,0);assert.equal(geminiCalls,0);
  assert.equal(document.querySelector('#settings-tab-intelligence').getAttribute('aria-controls'),'settings-panel-intelligence');
  await edit('ai-model','gpt-6-luna');await tab('voice');await edit('ai-tts-voice','echo');
  assert.equal(document.querySelector('#settings-tab-voice').getAttribute('aria-controls'),'settings-panel-voice');
  await tab('intelligence');assert.equal(document.querySelector('#ai-model').value,'gpt-6-luna');
  await act(async()=>document.querySelector('.ai-preferences-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(writes.length,1);assert.equal(writes[0].category,'ai');assert.equal('ttsVoice' in writes[0].value,false);assert.equal(saved.ttsVoice,'puck');
  await tab('voice');assert.equal(document.querySelector('#ai-tts-voice').value,'echo');
  await act(async()=>document.querySelector('.voice-preferences-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(writes[1].category,'voice');assert.equal('model' in writes[1].value,false);assert.equal(saved.model,'gpt-6-luna');assert.equal(saved.ttsVoice,'echo');
  await tab('intelligence');assert.equal(document.querySelector('#ai-model').value,'gpt-6-luna');assert.equal(statusCalls,2,'No repeated preference fetch after navigation');
  await tab('voice');await edit('ai-tts-provider','gemini');
  const credential=document.querySelector('.voice-settings input[type=password]');
  await edit(credential.id,'synthetic-unsaved-credential');await tab('intelligence');await tab('voice');
  assert.equal(document.querySelector('.voice-settings input[type=password]'),credential);
  assert.equal(credential.value,'synthetic-unsaved-credential','Credential draft survives category navigation without a write');
  assert.equal(writes.length,2);
});

test('indexing polling stops inactive, discards stale responses and preserves vault drafts when resumed',async t=>{
  const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
  let refresh,cleared=0,calls=0,pending;
  t.mock.method(window,'setInterval',callback=>{refresh=callback;return 7;});t.mock.method(window,'clearInterval',()=>{cleared++;});
  const status={model:'synthetic',dimensions:3,configured:true,settings:{automatic:false,minCharacters:100},counts:{indexed:0,partial:0,missing:0,stale:0,ineligible:0,eligible:0,queued:0,running:0},jobs:[],notes:[]};
  t.mock.method(api,'embeddings',async()=>{calls++;if(calls===2)return new Promise(resolve=>pending=resolve);return structuredClone(status);});
  const props={vault:{id:'synthetic',name:'Synthetic',locked:false},onOpenPassage:async()=>{},onOpenPage:async()=>{},onOpenEntity:async()=>{}};
  const render=active=>act(async()=>root.render(createElement(EmbeddingSettings,{...props,active})));
  await render(false);assert.equal(calls,0);await render(true);assert.equal(calls,1);
  await edit('embedding-minimum','222');await act(async()=>refresh());assert.equal(calls,2);
  await render(false);assert.equal(cleared,1);await act(async()=>pending({...status,settings:{automatic:true,minCharacters:333}}));
  assert.equal(document.querySelector('#embedding-minimum').value,'222');
  await render(true);assert.equal(calls,3);assert.equal(document.querySelector('#embedding-minimum').value,'222','Reactivation preserves unsaved vault-specific settings');
});

test('settings restore their category, AI subview and scroll after a refresh, and stay closed after dismissal',async t=>{
  const {useSettingsOpen,readSettingsSession}=await import('../src/client/settings/settings-session.ts');
  const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
  env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  t.mock.method(api,'intelligence',async()=>initial());
  t.mock.method(api,'aiDebugSettings',async()=>({enabled:false,expiresAt:null}));
  const props={appearance:defaultAppearance(),calendarSettings:defaultCalendarSettings(),vault:null,storageError:false,onChange(){},onCalendarSettingsChange(){},onExitFocus(){},onChangePassphrase:async()=>{},onBeforeNetworkChange:async()=>{},onOpenPassage:async()=>{},onOpenPage:async()=>{},onOpenEntity:async()=>{}};
  function Harness(){const [open,setOpen]=useSettingsOpen();return createElement('div',null,createElement('button',{id:'open-settings',onClick:()=>setOpen(true)},'Open settings'),open&&createElement(SettingsDialog,{...props,onClose:()=>setOpen(false)}));}
  const reload=async()=>{await act(async()=>root.render(null));await act(async()=>root.render(createElement(Harness)));};
  await reload();assert.equal(document.querySelector('.settings-modal'),null);
  await act(async()=>document.getElementById('open-settings').click());
  await act(async()=>document.getElementById('settings-tab-intelligence').click());
  await click('Advanced diagnostics');
  const panel=document.querySelector('.settings-panels');panel.scrollTop=245;
  await act(async()=>panel.dispatchEvent(new Event('scroll')));
  assert.deepEqual(readSettingsSession(),{tab:'intelligence',aiView:'diagnostics',scrollTop:245});
  await reload();
  assert.equal(document.getElementById('settings-tab-intelligence').getAttribute('aria-selected'),'true');
  assert.ok([...document.querySelectorAll('button')].some(button=>button.textContent==='Back to AI'));
  assert.equal(document.querySelector('.settings-panels').scrollTop,245);
  await click('Done');assert.equal(readSettingsSession(),null);
  await reload();assert.equal(document.querySelector('.settings-modal'),null);
  await act(async()=>document.getElementById('open-settings').click());
  assert.equal(document.getElementById('settings-tab-appearance').getAttribute('aria-selected'),'true');
});

test('invalid or unavailable settings session storage does not prevent opening settings',async t=>{
  const {readSettingsSession}=await import('../src/client/settings/settings-session.ts');
  const env=setupDOM(t);
  for(const value of ['not json','null','{}','{"tab":"unknown"}']){
    env.dom.window.sessionStorage.setItem('noema-settings-session',value);assert.equal(readSettingsSession(),null);
  }
  env.dom.window.sessionStorage.setItem('noema-settings-session','{"tab":"calendar","scrollTop":-10,"aiView":"unknown"}');
  assert.deepEqual(readSettingsSession(),{tab:'calendar',aiView:'overview',scrollTop:0});
  t.mock.getter(env.dom.window,'sessionStorage',()=>{throw new Error('Storage blocked');});
  assert.equal(readSettingsSession(),null);
});
