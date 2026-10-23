import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {speechText,speechChunks,useSpeech} from '../src/client/editor/speech.tsx';
import {api} from '../src/client/api.ts';
import {setupDOM} from './helpers/dom.mjs';
import {fixture as editorFixture} from './fixtures/editor-rendering.mjs';

const paragraph=(id,content,type='paragraph')=>({id,type,content:typeof content==='string'?[{text:content}]:content});

test('speech text follows document order and includes table cells, columns and readable entity labels',()=>{
  const blocks=[paragraph('first',[{text:'Meet '},{entityId:'ada'},{text:' and '},{entityId:'idea'},{text:' ('},{entityId:'ada',mentionText:'Countess'},{text:')'},{entityId:'missing'}]),paragraph('table',[],'table'),paragraph('image','Hidden image text','image'),paragraph('divider','Hidden divider text','divider'),paragraph('empty',' '),paragraph('columns',[],'columns'),paragraph('last','Finish')];
  blocks[1].rows=[[[{text:'A'}],[{entityId:'ada'}]],[[{text:'B'}],[{text:'C'}]]];
  blocks[5].rows=[[[{text:'Left'}],[{text:'Right'}]]];
  assert.equal(speechText(blocks,['last','table','first','image','divider','empty','columns'],[{id:'ada',name:'Ada Lovelace'},{id:'idea',name:'Group Theory',mentionCase:'lowercase'}]),'Meet Ada Lovelace and group theory (Countess)\n\nA. Ada Lovelace\nB. C\n\nLeft. Right\n\nFinish');
  assert.equal(speechText(blocks,['absent'],[]),'');
});

test('speech chunks preserve all trimmed text, readable boundaries and Unicode pairs within provider limits',()=>{
  for(const text of ['', 'short text', ' x '.repeat(3000), 'a'.repeat(4095)+'😀'+'b'.repeat(4200), 'A sentence. '.repeat(1000), 'Line\n'.repeat(1800)]){
    const chunks=speechChunks(text);
    assert.equal(chunks.join(''),text.trim());
    assert.ok(chunks.every(chunk=>chunk.length>0&&chunk.length<=4096));
    assert.ok(chunks.every(chunk=>!/[\uD800-\uDBFF]$/.test(chunk)&&! /^[\uDC00-\uDFFF]/.test(chunk)));
  }
});

async function speechFixture(t){
  const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));
  let hook,enabled=true,sequence=0;
  const requests=[],created=[],revoked=[];
  t.mock.method(api,'intelligence',async()=>({ttsEnabled:enabled}));
  t.mock.method(globalThis,'fetch',async(route,options)=>{assert.equal(route,'/api/intelligence/speech');let resolve;const promise=new Promise(done=>{resolve=done;});requests.push({options,resolve});return promise;});
  t.mock.method(URL,'createObjectURL',blob=>{created.push(blob);return 'blob:speech-'+(++sequence);});
  t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
  function Harness({vault='vault',page='page'}){hook=useSpeech(vault,page);return hook.player;}
  await act(async()=>root.render(createElement(Harness)));
  let mounted=true;
  const unmount=async()=>{if(mounted){mounted=false;await act(async()=>root.unmount());}};
  env.defer(unmount);
  return {env,requests,created,revoked,hook:()=>hook,unmount,async navigate(vault,page){await act(async()=>root.render(createElement(Harness,{vault,page})));},async speak(text){await act(async()=>hook.speak(text));},async resolve(index,response=new Response('wav',{headers:{'Content-Type':'audio/wav'}})){await act(async()=>requests[index].resolve(response));},async toggle(value){enabled=value;await act(async()=>window.dispatchEvent(new Event('noema:tts-preferences')));}};
}

test('speech plays successive chunks, revokes prior URLs, and stops pending work without stale playback',async t=>{
  const f=await speechFixture(t);
  await f.speak('A'.repeat(5000));
  assert.match(document.querySelector('[role=status]').textContent,/Generating speech.*1 \/ 2/);
  assert.equal(f.requests[0].options.headers['X-Vault-Id'],'vault');
  assert.equal(JSON.parse(f.requests[0].options.body).pageId,'page');
  assert.equal(JSON.parse(f.requests[0].options.body).text.length,4096);
  await f.resolve(0);
  assert.equal(document.querySelector('audio').getAttribute('src'),'blob:speech-1');
  assert.ok(document.querySelector('audio').hasAttribute('autoplay'));
  await act(async()=>document.querySelector('audio').dispatchEvent(new Event('ended',{bubbles:true})));
  assert.deepEqual(f.revoked,['blob:speech-1']);assert.equal(f.requests.length,2);
  assert.equal(JSON.parse(f.requests[1].options.body).text.length,904);
  await act(async()=>document.querySelector('.editor-speech button').click());
  assert.equal(f.requests[1].options.signal.aborted,true);assert.equal(document.querySelector('.editor-speech'),null);
  await f.resolve(1);assert.equal(f.created.length,1,'Stopped requests cannot create stale players');
});

test('unmount aborts requests and releases generated speech URLs',async t=>{
  const f=await speechFixture(t);await f.speak('First');await f.resolve(0);
  await f.unmount();assert.deepEqual(f.revoked,['blob:speech-1']);
  assert.equal(f.requests[0].options.signal.aborted,true);
});

test('unmount prevents an in-flight replacement from reviving playback',async t=>{
  const f=await speechFixture(t);await f.speak('First');await f.resolve(0);
  await f.speak('Second');assert.deepEqual(f.revoked,['blob:speech-1']);
  await f.unmount();assert.equal(f.requests[1].options.signal.aborted,true);
  await f.resolve(1);assert.equal(f.created.length,1);
});

test('page and vault navigation stop playback and abort pending speech from the old context',async t=>{
  const f=await speechFixture(t);await f.speak('Page one');await f.resolve(0);
  await f.navigate('vault','page-two');
  assert.equal(document.querySelector('.editor-speech'),null);assert.deepEqual(f.revoked,['blob:speech-1']);
  await f.speak('Page two');assert.equal(JSON.parse(f.requests[1].options.body).pageId,'page-two');
  await f.navigate('other-vault','page-two');
  assert.equal(f.requests[1].options.signal.aborted,true);assert.equal(document.querySelector('.editor-speech'),null);
  await f.resolve(1);assert.equal(f.created.length,1);
  await f.speak('New vault');assert.equal(f.requests[2].options.headers['X-Vault-Id'],'other-vault');
});

test('generation and playback failures can be dismissed, and global disable stops speech',async t=>{
  const f=await speechFixture(t);await f.speak(' ');
  assert.match(document.querySelector('[role=status]').textContent,/no text to speak/);assert.equal(f.requests.length,0);
  await f.speak('Failure');await f.resolve(0,Response.json({error:'Speech disabled.'},{status:403}));
  assert.match(document.querySelector('[role=status]').textContent,/Speech disabled/);
  assert.equal(document.querySelector('.editor-speech button').textContent,'Dismiss');
  await act(async()=>document.querySelector('.editor-speech button').click());assert.equal(document.querySelector('.editor-speech'),null);
  await f.speak('Audio');await f.resolve(1);
  await act(async()=>document.querySelector('audio').dispatchEvent(new Event('error',{bubbles:true})));
  assert.match(document.querySelector('[role=status]').textContent,/Could not play/);assert.deepEqual(f.revoked,['blob:speech-1']);
  await f.speak('Pending');await f.toggle(false);
  assert.equal(f.hook().enabled,false);assert.equal(f.requests[2].options.signal.aborted,true);assert.equal(document.querySelector('.editor-speech'),null);
  await f.speak('Disabled');assert.equal(f.requests.length,3);
});

test('editor block options expose Speak only when globally enabled and speak the selected block',async t=>{
  let enabled=true;const requests=[];
  t.mock.method(api,'intelligence',async()=>({ttsEnabled:enabled}));
  t.mock.method(globalThis,'fetch',async(route,options)=>{requests.push({route,options});return new Promise(()=>{});});
  await editorFixture(async({dom,host})=>{
    const open=()=>act(async()=>host('b2').closest('[data-block-id]').querySelector('[aria-label="Block options"]').click());
    await open();
    const speak=[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('Speak'));
    assert.ok(speak);await act(async()=>speak.click());
    assert.equal(requests.length,1);assert.equal(JSON.parse(requests[0].options.body).text,'Fictitious paragraph 2');
    enabled=false;await act(async()=>window.dispatchEvent(new dom.window.Event('noema:tts-preferences')));
    assert.equal(requests[0].options.signal.aborted,true);
    await open();assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent.startsWith('Speak')),false);
  });
});
