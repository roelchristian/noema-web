import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {speechText,speechChunks,combineSpeechAudio,useSpeech} from '../src/client/editor/speech.tsx';
import {api} from '../src/client/api.ts';
import {cleanSpeechText} from '../src/shared/speech-text.ts';
import {setupDOM} from './helpers/dom.mjs';
import {fixture as editorFixture} from './fixtures/editor-rendering.mjs';

const paragraph=(id,content,type='paragraph')=>({id,type,content:typeof content==='string'?[{text:content}]:content});
function wav(samples=[1,0,2,0]){
  const data=Buffer.from(samples),header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+data.length,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);return new Blob([header,data],{type:'audio/wav'});
}
const wavResponse=(samples)=>({ok:true,blob:async()=>wav(samples)});

test('audio assembly joins all PCM samples into one WAV and preserves single-part files',async()=>{
  const first=wav([1,0,2,0]),second=wav([3,0,4,0]);
  assert.equal(await combineSpeechAudio([first]),first);
  const combined=await combineSpeechAudio([first,second]),bytes=Buffer.from(await combined.arrayBuffer());
  assert.equal(combined.type,'audio/wav');assert.equal(bytes.length,52);assert.equal(bytes.readUInt32LE(4),44);assert.equal(bytes.readUInt32LE(40),8);
  assert.deepEqual([...bytes.subarray(44)],[1,0,2,0,3,0,4,0]);
});

test('audio assembly rejects non-WAV, truncated, mismatched, and non-PCM24k files',async()=>{
  await assert.rejects(combineSpeechAudio([]),/No speech audio/);
  await assert.rejects(combineSpeechAudio([new Blob(['bad'],{type:'audio/mpeg'})]),/invalid speech audio/);
  await assert.rejects(combineSpeechAudio([new Blob(['bad'],{type:'audio/wav'})]),/invalid speech audio/);
  for(const [offset,value] of [[4,999],[16,18],[20,3],[22,2],[24,48000],[28,96000],[32,4],[34,32],[40,999]]){
    const bytes=Buffer.from(await wav().arrayBuffer());bytes.writeUInt32LE(value,offset);
    await assert.rejects(combineSpeechAudio([wav(),new Blob([bytes],{type:'audio/wav'})]),/invalid speech audio/);
  }
  await assert.rejects(combineSpeechAudio([wav([1,0,2])]),/invalid speech audio/);
});

test('speech text follows document order and includes table cells, columns and readable entity labels',()=>{
  const blocks=[paragraph('first',[{text:'Meet '},{entityId:'ada'},{text:' and '},{entityId:'idea'},{text:' ('},{entityId:'ada',mentionText:'Countess'},{text:')'},{entityId:'missing'}]),paragraph('table',[],'table'),paragraph('image','Hidden image text','image'),paragraph('divider','Hidden divider text','divider'),paragraph('empty',' '),paragraph('columns',[],'columns'),paragraph('last','Finish')];
  blocks[1].rows=[[[{text:'A'}],[{entityId:'ada'}]],[[{text:'B'}],[{text:'C'}]]];
  blocks[5].rows=[[[{text:'Left'}],[{text:'Right'}]]];
  assert.equal(speechText(blocks,['last','table','first','image','divider','empty','columns'],[{id:'ada',name:'Ada Lovelace'},{id:'idea',name:'Group Theory',mentionCase:'lowercase'}]),'Meet Ada Lovelace and group theory (Countess)\n\nA. Ada Lovelace\nB. C\n\nLeft. Right\n\nFinish');
  assert.equal(speechText(blocks,['absent'],[]),'');
});

test('speech excludes citation segments and Noema metadata while preserving readable body text',()=>{
  const reference={id:'private-citation-id',sourceId:'private-source-id',fileId:'private-file-id',startLine:8,endLine:12,sourceHash:'private-source-hash',excerpt:'PRIVATE CITED EXCERPT',contextLabel:'PRIVATE CITATION CONTEXT'};
  const content=[{text:'Read ',bold:true},{entityId:'person',mentionText:'Ada',href:'https://private-target.invalid'},{text:' explains this',skipAutoTag:true},{text:' [ref] Bibliographic details must not be spoken',sourceReference:reference},{text:'.'}];
  const blocks=[{...paragraph('private-block-id',content),semantic:'definition',semanticGroup:{id:'private-group-id',kind:'definition',persona:{id:'private-persona-id',version:7},source:{blockIds:['private-origin-id'],excerpt:'PRIVATE SEMANTIC EXCERPT'}},column:{id:'private-column-id',index:0}},{...paragraph('private-table-id',[],'table'),rows:[[[{text:'A'},{text:' [1]',sourceReference:reference}],[{entityId:'person',sourceReference:reference}]],[[{text:'B'}],[{text:'C'}]]]},{...paragraph('private-columns-id',[],'columns'),rows:[[[{text:'Left'},{text:'Citation words',sourceReference:reference}],[{text:'Right'}]]]}];
  const entities=[{id:'person',name:'Ada Lovelace',description:'PRIVATE ENTITY DESCRIPTION',aliases:['PRIVATE ALIAS']}];
  assert.equal(speechText(blocks,blocks.map(block=>block.id),entities),'Read Ada explains this.\n\nA\nB. C\n\nLeft. Right');
  assert.equal(speechText([paragraph('citation-only',[{text:'Citation only',sourceReference:reference}])],['citation-only'],entities),'');
});

test('reference markers and footnotes are excluded without stripping ordinary brackets or numbers',()=>{
  const prose='First [ref] claim [L: 2–4]. Second[^note] claim [??]. Values [1, 2] and [1] stay.\n\n[^note]: Private footnote text\n    Private continuation\n\nFinal paragraph.';
  const cleaned=cleanSpeechText(prose);
  assert.equal(cleaned,'First claim. Second claim. Values [1, 2] and [1] stay.\n\nFinal paragraph.');
  assert.equal(cleanSpeechText(cleaned),cleaned);
  assert.equal(cleanSpeechText('Read [[Private target|visible words]] and [[Title]].'),'Read visible words and Title.');
  assert.equal(cleanSpeechText('[ref] [??] [L: 3] [^note]'),'');
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
  let hook,enabled=true,voice='marin',sequence=0;
  const requests=[],created=[],revoked=[];
  t.mock.method(api,'intelligence',async()=>({ttsEnabled:enabled,ttsVoice:voice}));
  t.mock.method(globalThis,'fetch',async(route,options)=>{assert.equal(route,'/api/intelligence/speech');let resolve;const promise=new Promise(done=>{resolve=done;});requests.push({options,resolve});return promise;});
  t.mock.method(URL,'createObjectURL',blob=>{created.push(blob);return 'blob:speech-'+(++sequence);});
  t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
  function Harness({vault='vault',page='page'}){hook=useSpeech(vault,page);return hook.player;}
  await act(async()=>root.render(createElement(Harness)));
  let mounted=true;
  const unmount=async()=>{if(mounted){mounted=false;await act(async()=>root.unmount());}};
  env.defer(unmount);
  return {env,requests,created,revoked,hook:()=>hook,unmount,externalVoice(value){voice=value;},async setVoice(value){voice=value;await act(async()=>window.dispatchEvent(new Event('noema:tts-preferences')));},async navigate(vault,page){await act(async()=>root.render(createElement(Harness,{vault,page})));},async speak(text){await act(async()=>hook.speak(text));},async resolve(index,response=wavResponse()){await act(async()=>requests[index].resolve(response));},async toggle(value){enabled=value;await act(async()=>window.dispatchEvent(new Event('noema:tts-preferences')));}};
}

test('speech assembles every selection chunk before playback and exposes a complete download without another request',async t=>{
  const f=await speechFixture(t);
  await f.speak('A'.repeat(5000));
  assert.match(document.querySelector('[role=status]').textContent,/Generating speech.*1 \/ 2/);
  assert.equal(f.requests[0].options.headers['X-Vault-Id'],'vault');
  assert.equal(JSON.parse(f.requests[0].options.body).pageId,'page');
  assert.equal(JSON.parse(f.requests[0].options.body).text.length,4096);
  await f.resolve(0,wavResponse([1,0,2,0]));
  assert.equal(document.querySelector('audio'),null);assert.equal(document.querySelector('a[download]'),null);
  assert.match(document.querySelector('[role=status]').textContent,/2 \/ 2/);
  assert.equal(f.requests.length,2);assert.equal(JSON.parse(f.requests[1].options.body).text.length,904);
  await f.resolve(1,wavResponse([3,0,4,0]));
  assert.equal(document.querySelector('audio').getAttribute('src'),'blob:speech-1');
  assert.ok(document.querySelector('audio').hasAttribute('autoplay'));
  const download=document.querySelector('a[download]');assert.equal(download.getAttribute('download'),'noema-speech.wav');assert.equal(download.getAttribute('href'),'blob:speech-1');assert.equal(download.textContent,'Download audio');
  const bytes=Buffer.from(await f.created[0].arrayBuffer());assert.deepEqual([...bytes.subarray(44)],[1,0,2,0,3,0,4,0]);assert.equal(bytes.readUInt32LE(40),8);
  download.addEventListener('click',event=>event.preventDefault());
  await act(async()=>download.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));assert.equal(f.requests.length,2);
  await act(async()=>document.querySelector('.editor-speech button').click());
  assert.deepEqual(f.revoked,['blob:speech-1']);assert.equal(document.querySelector('.editor-speech'),null);
});

test('stopping later selection chunks aborts requests and prevents partial playback or download',async t=>{
  const f=await speechFixture(t);await f.speak('A'.repeat(5000));await f.resolve(0);
  await act(async()=>document.querySelector('.editor-speech button').click());
  assert.equal(f.requests[1].options.signal.aborted,true);
  await f.resolve(1);assert.equal(f.created.length,0);assert.equal(document.querySelector('.editor-speech'),null);
});

test('a later failed chunk never exposes a partial selection download',async t=>{
  const f=await speechFixture(t);await f.speak('A'.repeat(5000));await f.resolve(0);
  await f.resolve(1,Response.json({error:'Speech unavailable.'},{status:503}));
  assert.match(document.querySelector('[role=status]').textContent,/Speech unavailable/);assert.equal(f.created.length,0);assert.equal(document.querySelector('audio'),null);assert.equal(document.querySelector('a[download]'),null);
});

test('speech payloads exclude reference markers before leaving the client',async t=>{
  const f=await speechFixture(t);await f.speak('Read [ref] this[^note].\n\n[^note]: Private footnote');
  assert.equal(JSON.parse(f.requests[0].options.body).text,'Read this.');
  assert.equal(f.requests.length,1);
  await f.resolve(0);
  await f.speak('[ref] [L: 2–4] [??]');
  assert.equal(f.requests.length,1,'Reference-only selections never request speech');
});

test('saved voice changes stop old playback and pin every chunk to the selected voice',async t=>{
  const f=await speechFixture(t);await f.speak('First');
  assert.equal(JSON.parse(f.requests[0].options.body).voice,'marin');await f.resolve(0);
  await f.setVoice('cedar');assert.equal(document.querySelector('audio'),null);assert.deepEqual(f.revoked,['blob:speech-1']);
  await f.speak('a'.repeat(5000));assert.equal(JSON.parse(f.requests[1].options.body).voice,'cedar');
  await f.resolve(1);assert.equal(JSON.parse(f.requests[2].options.body).voice,'cedar');await f.resolve(2);
  assert.ok(document.querySelector('audio'));
  await f.speak('Pending');await f.setVoice('marin');assert.equal(f.requests[3].options.signal.aborted,true);
  await f.resolve(3);assert.equal(document.querySelector('audio'),null);
  await f.speak('Fresh Marin');assert.equal(JSON.parse(f.requests[4].options.body).voice,'marin');
});

test('a voice changed in another tab is refreshed for the next explicit Speak without retrying generation',async t=>{
  const f=await speechFixture(t);await f.speak('Selection');f.externalVoice('cedar');
  await f.resolve(0,Response.json({error:'The speech voice changed. Start Speak again.'},{status:409}));
  assert.equal(f.requests.length,1);assert.match(document.querySelector('[role=status]').textContent,/voice changed/);
  await f.speak('Selection');assert.equal(JSON.parse(f.requests[1].options.body).voice,'cedar');
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
