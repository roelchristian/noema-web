import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {speechText,speechChunks,combineSpeechAudio,useSpeech} from '../src/client/editor/speech.tsx';
import {SpeechPlayer} from '../src/client/editor/SpeechPlayer.tsx';
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
  const openMenus=new WeakSet(),originalMatches=env.dom.window.HTMLElement.prototype.matches;
  t.mock.method(env.dom.window.HTMLElement.prototype,'matches',function(selector){return selector===':popover-open'?openMenus.has(this):originalMatches.call(this,selector);});
  env.dom.window.HTMLElement.prototype.showPopover=function(){openMenus.add(this);};
  env.dom.window.HTMLElement.prototype.hidePopover=function(){openMenus.delete(this);};
  const previousGroup=Object.getOwnPropertyDescriptor(globalThis,'HTMLOptGroupElement');
  Object.defineProperty(globalThis,'HTMLOptGroupElement',{configurable:true,value:env.dom.window.HTMLOptGroupElement});
  env.defer(()=>{if(previousGroup)Object.defineProperty(globalThis,'HTMLOptGroupElement',previousGroup);else delete globalThis.HTMLOptGroupElement;});
  let hook,enabled=true,voice='puck',provider='kokoro',sequence=0;
  const requests=[],created=[],revoked=[],autoplayed=[];
  t.mock.method(env.dom.window.HTMLMediaElement.prototype,'play',async function(){autoplayed.push(this);});
  t.mock.method(api,'intelligence',async()=>({ttsEnabled:enabled,ttsVoice:voice,ttsProvider:provider}));
  t.mock.method(globalThis,'fetch',async(route,options)=>{assert.equal(route,'/api/intelligence/speech');let resolve;const promise=new Promise(done=>{resolve=done;});requests.push({options,resolve});return promise;});
  t.mock.method(URL,'createObjectURL',blob=>{created.push(blob);return 'blob:speech-'+(++sequence);});
  t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
  function Harness({vault='vault',page='page'}){hook=useSpeech(vault,page);return hook.player;}
  await act(async()=>root.render(createElement(Harness)));
  let mounted=true;
  const unmount=async()=>{if(mounted){mounted=false;await act(async()=>root.unmount());}};
  env.defer(unmount);
  return {env,requests,created,revoked,autoplayed,hook:()=>hook,unmount,externalVoice(value){voice=value;},externalProvider(value,nextVoice){provider=value;voice=nextVoice;},async setProvider(value,nextVoice){provider=value;voice=nextVoice;await act(async()=>window.dispatchEvent(new Event('noema:tts-preferences')));},async setVoice(value){voice=value;await act(async()=>window.dispatchEvent(new Event('noema:tts-preferences')));},async navigate(vault,page){await act(async()=>root.render(createElement(Harness,{vault,page})));},async speak(text){await act(async()=>hook.speak(text));},async resolve(index,response=wavResponse()){await act(async()=>requests[index].resolve(response));},async toggle(value){enabled=value;await act(async()=>window.dispatchEvent(new Event('noema:tts-preferences')));}};
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

test('speech progress reports completed sections and keeps single-section work indeterminate',async t=>{
  const f=await speechFixture(t);await f.speak('Short selection');
  assert.equal(document.querySelector('progress').hasAttribute('value'),false);
  assert.equal(document.querySelector('button').getAttribute('aria-label'),'Cancel speech generation');
  await f.speak('A'.repeat(5000));
  assert.equal(document.querySelector('progress').value,0);
  assert.equal(document.querySelector('progress').max,2);
  await f.resolve(1);
  assert.equal(document.querySelector('progress').value,1);
  assert.match(document.querySelector('.speech-generation-detail').textContent,/1 of 2 sections complete/);
  await f.resolve(2);
  assert.equal(document.querySelector('progress'),null);
  assert.match(document.querySelector('[role=status]').textContent,/Ready to listen/);
});

test('floating speech follows the workspace bounds as sidebars and focus layout change',async t=>{
  const env=setupDOM(t,{html:'<main><div id="mount"></div></main>'});
  const main=document.querySelector('main'),root=createRoot(document.querySelector('#mount'));
  let left=240,width=720,resize=()=>{},disconnected=false;
  t.mock.method(main,'getBoundingClientRect',()=>new env.dom.window.DOMRect(left,0,width,900));
  const previous=Object.getOwnPropertyDescriptor(globalThis,'ResizeObserver');
  Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:class {
    constructor(callback){resize=()=>callback([],this);}
    observe(target){assert.equal(target,main);}
    disconnect(){disconnected=true;}
  }});
  env.defer(()=>{if(previous)Object.defineProperty(globalThis,'ResizeObserver',previous);else delete globalThis.ResizeObserver;});
  env.defer(async()=>act(async()=>root.unmount()));
  await act(async()=>root.render(createElement(SpeechPlayer,{state:{loading:true,url:'',error:'',part:1,total:1},voice:'puck',onClose(){},onError(){}})));
  const player=document.querySelector('.editor-speech');
  assert.equal(player.parentElement,document.body,'The floating player stays outside the note layout');
  assert.equal(player.style.getPropertyValue('--speech-workspace-center'),'600px');
  assert.equal(player.style.getPropertyValue('--speech-workspace-width'),'720px');
  width=1040;await act(async()=>resize());
  assert.equal(player.style.getPropertyValue('--speech-workspace-center'),'760px','Closing the right sidebar shifts the player with the workspace');
  left=0;width=1280;await act(async()=>resize());
  assert.equal(player.style.getPropertyValue('--speech-workspace-center'),'640px','Focus mode centers within the full workspace');
  left=240;width=480;await act(async()=>window.dispatchEvent(new Event('resize')));
  assert.equal(player.style.getPropertyValue('--speech-workspace-center'),'480px');
  assert.equal(player.dataset.compact,'true','Compact controls depend on available workspace width');
  await act(async()=>root.unmount());assert.equal(disconnected,true);
});

test('speech controls follow media playback, seek, speed, buffering and completion',async t=>{
  const f=await speechFixture(t);await f.speak('Audio');await f.resolve(0);
  const audio=document.querySelector('audio');
  let paused=true,ended=false;
  Object.defineProperties(audio,{duration:{value:90},paused:{get:()=>paused},ended:{get:()=>ended}});
  t.mock.method(audio,'play',async()=>{paused=false;audio.dispatchEvent(new Event('play'));audio.dispatchEvent(new Event('playing'));});
  t.mock.method(audio,'pause',()=>{paused=true;audio.dispatchEvent(new Event('pause'));});
  await act(async()=>audio.dispatchEvent(new Event('loadedmetadata')));
  const seek=document.querySelector('[aria-label="Seek speech"]');
  assert.equal(seek.disabled,false);assert.equal(seek.max,'90');
  await act(async()=>document.querySelector('[aria-label="Play speech"]').click());
  assert.match(document.querySelector('[role=status]').textContent,/Playing/);
  await act(async()=>document.querySelector('[aria-label="Pause speech"]').click());
  assert.equal(paused,true);assert.match(document.querySelector('[role=status]').textContent,/Paused/);
  const speed=document.querySelector('select');
  await act(async()=>{speed.value='1.5';speed.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(audio.playbackRate,1.5);
  await act(async()=>{
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(seek,'30');
    seek.dispatchEvent(new Event('input',{bubbles:true}));seek.dispatchEvent(new Event('change',{bubbles:true}));
  });
  assert.equal(audio.currentTime,30);assert.equal(seek.getAttribute('aria-valuetext'),'0:30 of 1:30');
  await act(async()=>audio.dispatchEvent(new Event('waiting')));
  assert.match(document.querySelector('[role=status]').textContent,/Loading audio/);
  await act(async()=>{ended=true;audio.dispatchEvent(new Event('ended'));});
  assert.match(document.querySelector('[role=status]').textContent,/Finished reading/);
  await act(async()=>document.querySelector('[aria-label="Replay speech"]').click());
  assert.equal(audio.currentTime,0);assert.match(document.querySelector('[role=status]').textContent,/Playing/);
});

test('completed speech starts automatically once and keeps voice details in the info disclosure',async t=>{
  const f=await speechFixture(t);await f.speak('A'.repeat(5000));await f.resolve(0);
  assert.equal(f.autoplayed.length,0,'Partial selections do not start playback');
  await f.resolve(1);assert.deepEqual(f.autoplayed,[document.querySelector('audio')]);
  const details=document.querySelector('.speech-info');
  assert.equal(details.open,false);assert.match(details.textContent,/Puck.*AI-generated voice/);
  assert.doesNotMatch(document.querySelector('.speech-heading').textContent,/Puck|AI-generated voice|Reading aloud/);
  await act(async()=>{details.open=true;details.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
  assert.equal(details.open,false);assert.equal(document.activeElement,details.querySelector('summary'));
  await act(async()=>{details.open=true;document.body.dispatchEvent(new Event('pointerdown',{bubbles:true}));});
  assert.equal(details.open,false);
  assert.equal(f.autoplayed.length,1,'Info interactions do not restart playback');
});

test('blocked autoplay retains manual play and download',async t=>{
  const f=await speechFixture(t);await f.speak('Audio');
  t.mock.method(f.env.dom.window.HTMLMediaElement.prototype,'play',async()=>{throw new Error('User gesture required');});
  await f.resolve(0);
  assert.match(document.querySelector('.speech-notice').textContent,/Press play to listen/);
  assert.ok(document.querySelector('[aria-label="Play speech"]'));
  assert.ok(document.querySelector('a[download]'));
});

test('speech speed uses the shared Noema dropdown and applies keyboard selections',async t=>{
  const f=await speechFixture(t);await f.speak('Audio');await f.resolve(0);
  const trigger=document.querySelector('.speech-speed [role=combobox]'),menu=document.querySelector('.speech-speed [role=listbox]');
  assert.equal(trigger.getAttribute('aria-label'),'Playback speed');
  assert.equal(trigger.textContent,'1×');
  t.mock.method(trigger,'getBoundingClientRect',()=>new f.env.dom.window.DOMRect(300,720,50,30));
  Object.defineProperty(menu,'scrollHeight',{value:180});
  await act(async()=>trigger.click());
  assert.equal(trigger.getAttribute('aria-expanded'),'true');
  assert.equal(menu.querySelectorAll('[role=option]').length,5);
  assert.ok(parseFloat(menu.style.top)<720,'The speed menu opens above the bottom bar');
  await act(async()=>{
    trigger.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    trigger.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  });
  assert.equal(document.querySelector('audio').playbackRate,1.25);
  assert.equal(trigger.textContent,'1.25×');
  assert.equal(document.activeElement,trigger);
});

test('a blocked play attempt leaves audio downloadable with a useful message',async t=>{
  const f=await speechFixture(t);await f.speak('Audio');await f.resolve(0);
  t.mock.method(document.querySelector('audio'),'play',async()=>{throw new Error('Not allowed');});
  await act(async()=>document.querySelector('[aria-label="Play speech"]').click());
  assert.match(document.querySelector('.speech-notice').textContent,/Press play to try again/);
  assert.ok(document.querySelector('[aria-label="Play speech"]'));
  assert.ok(document.querySelector('a[download]'));
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
  assert.equal(JSON.parse(f.requests[0].options.body).voice,'puck');await f.resolve(0);
  await f.setVoice('echo');assert.equal(document.querySelector('audio'),null);assert.deepEqual(f.revoked,['blob:speech-1']);
  await f.speak('a'.repeat(5000));assert.equal(JSON.parse(f.requests[1].options.body).voice,'echo');
  await f.resolve(1);assert.equal(JSON.parse(f.requests[2].options.body).voice,'echo');await f.resolve(2);
  assert.ok(document.querySelector('audio'));
  await f.speak('Pending');await f.setVoice('puck');assert.equal(f.requests[3].options.signal.aborted,true);
  await f.resolve(3);assert.equal(document.querySelector('audio'),null);
  await f.speak('Fresh Puck');assert.equal(JSON.parse(f.requests[4].options.body).voice,'puck');
});

test('a voice changed in another tab is refreshed for the next explicit Speak without retrying generation',async t=>{
  const f=await speechFixture(t);await f.speak('Selection');f.externalVoice('echo');
  await f.resolve(0,Response.json({error:'The speech voice changed. Start Speak again.'},{status:409}));
  assert.equal(f.requests.length,1);assert.match(document.querySelector('[role=status]').textContent,/voice changed/);
  await f.speak('Selection');assert.equal(JSON.parse(f.requests[1].options.body).voice,'echo');
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


test('provider changes cancel pending speech and pin OpenAI voices and provider on every chunk',async t=>{
  const f=await speechFixture(t);await f.speak('Pending local');
  assert.equal(JSON.parse(f.requests[0].options.body).provider,'kokoro');
  await f.setProvider('openai','marin');assert.equal(f.requests[0].options.signal.aborted,true);
  await f.resolve(0);assert.equal(f.created.length,0);
  await f.speak('a'.repeat(5000));
  assert.equal(JSON.parse(f.requests[1].options.body).provider,'openai');assert.equal(JSON.parse(f.requests[1].options.body).voice,'marin');
  await f.resolve(1);
  assert.equal(JSON.parse(f.requests[2].options.body).provider,'openai');assert.equal(JSON.parse(f.requests[2].options.body).voice,'marin');
  await f.resolve(2);assert.ok(document.querySelector('audio'));
  await f.setProvider('kokoro','puck');assert.equal(document.querySelector('audio'),null);assert.deepEqual(f.revoked,['blob:speech-1']);
});

test('cross-tab provider changes refresh the next explicit request without retrying',async t=>{
  const f=await speechFixture(t);await f.speak('Selection');f.externalProvider('openai','cedar');
  await f.resolve(0,Response.json({error:'The speech provider changed. Start Speak again.'},{status:409}));
  assert.equal(f.requests.length,1);assert.match(document.querySelector('[role=status]').textContent,/provider changed/);
  await f.speak('Selection');const body=JSON.parse(f.requests[1].options.body);assert.equal(body.provider,'openai');assert.equal(body.voice,'cedar');
});
