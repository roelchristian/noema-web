import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {speechText,speechChunks,combineSpeechAudio,useSpeech} from '../src/client/editor/speech.tsx';
import {SpeechPlayer} from '../src/client/editor/SpeechPlayer.tsx';
import {api} from '../src/client/api.ts';
import {defaultNarrationPreferences} from '../src/shared/narration.ts';
import {cleanSpeechText} from '../src/shared/speech-text.ts';
import {speechSections,resumeRevision,readSpeechResume,writeSpeechResume,clearSpeechResume} from '../src/client/editor/speech-sections.ts';
import {setupDOM} from './helpers/dom.mjs';
import {fixture as editorFixture} from './fixtures/editor-rendering.mjs';

const paragraph=(id,content,type='paragraph')=>({id,type,content:typeof content==='string'?[{text:content}]:content});
function wav(samples=[1,0,2,0]){
  const data=Buffer.from(samples),header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+data.length,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);return new Blob([header,data],{type:'audio/wav'});
}
const wavResponse=(samples)=>({ok:true,blob:async()=>wav(samples)});

// A DOM click does not return useSpeech's asynchronous resume-identity promise.
// Wait for the observable request/play event, then keep the original assertions.
async function waitForSpeech(predicate,label) {
  const deadline=Date.now()+5000;
  while(!predicate()&&Date.now()<deadline)await act(async()=>new Promise(resolve=>setTimeout(resolve,0)));
  assert.ok(predicate(),label);
}

test('block sections retain order, stable boundaries, protected content and all Unicode text',()=>{
  const source=[paragraph('heading','Title','heading1'),paragraph('body','🙂'.repeat(20)),paragraph('list','Last item','bullet'),paragraph('code','API 2026-10-23','code')];
  const original=structuredClone(source),sections=speechSections(source,['code','list','body','heading'],[],9);
  assert.deepEqual(source,original);
  assert.deepEqual([...new Set(sections.map(section=>section.blockId))],source.map(block=>block.id));
  assert.equal(sections[0].kind,'heading');assert.equal(sections.at(-1).kind,'protected');
  assert.ok(sections.some(section=>section.kind==='list'));
  for(const block of source){
    const chunks=sections.filter(section=>section.blockId===block.id);
    assert.equal(chunks.map(section=>section.text).join(''),speechText(source,[block.id],[]));
    assert.deepEqual(chunks.map(section=>section.sectionIndex),chunks.map((_,index)=>index));
    assert.ok(chunks.every(section=>section.text.length<=9&&!/[\uD800-\uDBFF]$/.test(section.text)));
  }
});

test('protected inline and table-cell content retains structural pause metadata without changing authored blocks',async()=>{
  const source=[paragraph('heading',[{text:'API',code:true}],'heading1'),paragraph('body',[{text:'123',math:true}]),paragraph('list',[{text:'API',code:true}],'bullet'),{...paragraph('table',[],'table'),rows:[[[{text:'API',code:true}]]]}, {...paragraph('columns',[],'columns'),rows:[[[{text:'123',math:true}]]]},paragraph('code','API','code'),paragraph('math','123','math')];
  const original=structuredClone(source),sections=speechSections(source,source.map(block=>block.id),[]);
  assert.deepEqual(source,original);assert.ok(sections.every(section=>section.kind==='protected'));
  assert.deepEqual(sections.map(section=>section.pauseKind),['heading','paragraph','list','paragraph','paragraph',undefined,undefined]);
  assert.deepEqual(sections.map(section=>section.text),['API','123','API','API','123','API','123']);
  const changed=sections.map(section=>({...section,pauseKind:'paragraph'}));
  assert.notEqual(await resumeRevision(sections),await resumeRevision(changed),'Structural pause changes invalidate a previous resume revision');
});

test('resume stores only revision and a stable section boundary, isolated by vault/page and invalidated on edits or deletion',async()=>{
  const records=new Map(),store={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};
  const sections=speechSections([paragraph('one','Private first'),paragraph('two','Private second')],['one','two'],[]),revision=await resumeRevision(sections);
  writeSpeechResume('vault','page',revision,sections,1,store);
  assert.equal(readSpeechResume('vault','page',revision,sections,store),1);
  assert.equal(readSpeechResume('other-vault','page',revision,sections,store),null);
  assert.equal(readSpeechResume('vault','other-page',revision,sections,store),null);
  assert.ok(!JSON.stringify([...records]).includes('Private'));
  const edited=sections.map(section=>({...section,text:section.text+' edit'}));
  assert.equal(readSpeechResume('vault','page',await resumeRevision(edited),edited,store),null);
  writeSpeechResume('vault','page',revision,sections,1,store);
  assert.equal(readSpeechResume('vault','page',revision,sections.slice(0,1),store),null);
  writeSpeechResume('vault','page',revision,sections,0,store);clearSpeechResume('vault','page',store);
  assert.equal(records.size,0);
  const unavailable={getItem(){throw new Error('Unavailable');},setItem(){throw new Error('Unavailable');},removeItem(){throw new Error('Unavailable');}};
  assert.doesNotThrow(()=>writeSpeechResume('vault','page',revision,sections,0,unavailable));
  assert.equal(readSpeechResume('vault','page',revision,sections,unavailable),null);
});

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

async function speechFixture(t,narration){
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
  t.mock.method(api,'intelligence',async()=>({ttsEnabled:enabled,ttsVoice:voice,ttsProvider:provider,...(narration?{narration}:{})}));
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

test('speech starts the first section immediately and exposes only a complete download',async t=>{
  const f=await speechFixture(t);
  await f.speak('A'.repeat(5000));
  assert.match(document.querySelector('[role=status]').textContent,/Generating speech.*1 \/ 2/);
  assert.equal(f.requests[0].options.headers['X-Vault-Id'],'vault');
  assert.equal(JSON.parse(f.requests[0].options.body).pageId,'page');
  assert.equal(JSON.parse(f.requests[0].options.body).text.length,4096);
  await f.resolve(0,wavResponse([1,0,2,0]));
  assert.ok(document.querySelector('audio'));assert.equal(document.querySelector('a[download]'),null);
  assert.match(document.querySelector('[role=status]').textContent,/2 \/ 2/);
  assert.equal(f.requests.length,2);assert.equal(JSON.parse(f.requests[1].options.body).text.length,904);
  await f.resolve(1,wavResponse([3,0,4,0]));
  assert.equal(document.querySelector('audio').getAttribute('src'),'blob:speech-1');
  assert.equal(f.autoplayed.length,1,'Playback starts through the source-validated play action');
  const download=document.querySelector('a[download]');assert.equal(download.getAttribute('download'),'noema-speech.wav');assert.equal(download.getAttribute('href'),'blob:speech-2');assert.equal(download.textContent,'Download audio');
  const bytes=Buffer.from(await f.created[1].arrayBuffer());assert.deepEqual([...bytes.subarray(44)],[1,0,2,0,3,0,4,0]);assert.equal(bytes.readUInt32LE(40),8);
  download.addEventListener('click',event=>event.preventDefault());
  await act(async()=>download.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));assert.equal(f.requests.length,2);
  await act(async()=>document.querySelector('.editor-speech button').click());
  assert.deepEqual(f.revoked,['blob:speech-1','blob:speech-2']);assert.equal(document.querySelector('.editor-speech'),null);
});

test('stopping later selection chunks aborts requests and releases early playback',async t=>{
  const f=await speechFixture(t);await f.speak('A'.repeat(5000));await f.resolve(0);
  await act(async()=>document.querySelector('.editor-speech button').click());
  assert.equal(f.requests[1].options.signal.aborted,true);
  await f.resolve(1);assert.equal(f.created.length,1);assert.deepEqual(f.revoked,['blob:speech-1']);assert.equal(document.querySelector('.editor-speech'),null);
});

test('speech generation shows a compact spinner, elapsed time and section status until ready',async t=>{
  const f=await speechFixture(t);await f.speak('Short selection');
  assert.equal(document.querySelector('progress'),null);
  assert.ok(document.querySelector('.speech-status .scan-spinner[aria-hidden=true]'));
  assert.equal(document.querySelector('.speech-generation-time').textContent,'0:00');
  assert.equal(document.querySelector('button').getAttribute('aria-label'),'Cancel speech generation');
  await f.speak('A'.repeat(5000));
  assert.match(document.querySelector('[role=status]').textContent,/1 \/ 2/);
  await f.resolve(1);
  assert.match(document.querySelector('[role=status]').textContent,/2 \/ 2/);
  assert.ok(document.querySelector('.scan-spinner'));
  await f.resolve(2);
  assert.equal(document.querySelector('.scan-spinner'),null);
  assert.equal(document.querySelector('.speech-generation-time'),null);
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

test('first section starts automatically once and keeps voice details in the info disclosure',async t=>{
  const f=await speechFixture(t);await f.speak('A'.repeat(5000));await f.resolve(0);
  assert.equal(f.autoplayed.length,1,'The first complete section starts playback');
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
  assert.match(document.querySelector('[role=status]').textContent,/Speech unavailable/);assert.equal(f.created.length,1);assert.ok(document.querySelector('audio'));assert.equal(document.querySelector('a[download]'),null);
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
    await waitForSpeech(()=>requests.length>0,'Speak must start a synthesis request');
    assert.equal(requests.length,1);assert.equal(JSON.parse(requests[0].options.body).text,'Fictitious paragraph 2');
    enabled=false;await act(async()=>window.dispatchEvent(new dom.window.Event('noema:tts-preferences')));
    assert.equal(requests[0].options.signal.aborted,true);
    await open();assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent.startsWith('Speak')),false);
  });
});

test('editor speech cancels on a different block selection and on a current entity narration change without moving selection',async t=>{
  const requests=[];
  t.mock.method(api,'intelligence',async()=>({ttsEnabled:true}));
  t.mock.method(globalThis,'fetch',async(route,options)=>new Promise(resolve=>requests.push({options,resolve})));
  t.mock.method(URL,'createObjectURL',()=> 'blob:editor-speech');t.mock.method(URL,'revokeObjectURL',()=>{});
  await editorFixture(async({dom,host,caret,blocks,set,entities})=>{
    t.mock.method(dom.window.HTMLMediaElement.prototype,'play',async()=>{});
    const speak=async()=>{
      const previous=requests.length;
      await act(async()=>host('b2').closest('[data-block-id]').querySelector('[aria-label="Block options"]').click());
      await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('Speak')).click());
      await waitForSpeech(()=>requests.length>previous,'Speak must start its next synthesis request');
      assert.equal(requests.length,previous+1);
    };
    caret(host('b2'),0);await speak();
    const outside=document.createElement('span');outside.textContent='Player controls';document.body.append(outside);
    const range=document.createRange();range.selectNodeContents(outside);
    getSelection().removeAllRanges();getSelection().addRange(range);
    await act(async()=>document.dispatchEvent(new Event('selectionchange')));
    assert.equal(requests[0].options.signal.aborted,false,'Focus outside the editor preserves narration');
    caret(host('b2'),3);await act(async()=>document.dispatchEvent(new Event('selectionchange')));
    assert.equal(requests[0].options.signal.aborted,false,'Caret movement inside the same block preserves narration');
    caret(host('b3'),0);const selected=getSelection().anchorNode,offset=getSelection().anchorOffset;
    await act(async()=>document.dispatchEvent(new Event('selectionchange')));
    assert.equal(requests[0].options.signal.aborted,true);assert.equal(document.querySelector('.editor-speech'),null);
    assert.equal(getSelection().anchorNode,selected);assert.equal(getSelection().anchorOffset,offset);
    await entities([{id:'person',name:'Fictitious Ada',type:'person'}]);
    await set(blocks().map(block=>block.id==='b2'?{...block,content:[{entityId:'person'}]}:block));
    caret(host('b2'),0);await speak();await act(async()=>requests[1].resolve(wavResponse()));
    await act(async()=>document.querySelector('audio').dispatchEvent(new Event('playing')));
    assert.ok(host('b2').closest('[data-block-id]').hasAttribute('data-speech-current'));
    await entities([{id:'person',name:'Fictitious Grace',type:'person'}]);
    assert.equal(requests[1].options.signal.aborted,true);assert.equal(document.querySelector('.editor-speech'),null);
  });
});

test('editor validates paused and future block sources before resuming or advancing narration',async t=>{
  const plays=[];
  t.mock.method(api,'intelligence',async()=>({ttsEnabled:true}));
  t.mock.method(globalThis,'fetch',async()=>wavResponse());
  t.mock.method(URL,'createObjectURL',()=> 'blob:guarded-speech');t.mock.method(URL,'revokeObjectURL',()=>{});
  await editorFixture(async({dom,host,blocks,set})=>{
    t.mock.method(dom.window.HTMLMediaElement.prototype,'play',async function(){plays.push(this);});
    const speak=async()=>{
      const previous=plays.length;
      const range=document.createRange();range.selectNodeContents(host('b2'));range.setEndAfter(host('b3').lastChild);
      getSelection().removeAllRanges();getSelection().addRange(range);
      await act(async()=>host('b2').closest('[data-block-id]').querySelector('[aria-label="Block options"]').click());
      await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('Speak')).click());
      await waitForSpeech(()=>plays.length>previous,'Speak must activate validated section playback');
    };
    const edit=async id=>set(blocks().map(block=>block.id===id?{...block,content:[{text:'Edited source '+id}]}:block));
    await speak();assert.equal(plays.length,1);
    await act(async()=>document.querySelector('audio').dispatchEvent(new Event('pause')));
    await edit('b2');assert.equal(document.querySelector('.editor-speech'),null,'A paused source edit invalidates its recording');
    await speak();assert.equal(plays.length,2);
    const first=document.querySelector('audio');
    await edit('b3');assert.equal(document.querySelector('audio'),first,'Future edits do not interrupt the unchanged current block');
    await act(async()=>first.dispatchEvent(new Event('ended')));
    assert.equal(plays.length,2,'A stale future section never reaches automatic playback');
    assert.equal(document.querySelector('audio'),null);
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
  await f.setProvider('kokoro','puck');assert.equal(document.querySelector('audio'),null);assert.deepEqual(f.revoked,['blob:speech-1','blob:speech-2']);
});

test('cross-tab provider changes refresh the next explicit request without retrying',async t=>{
  const f=await speechFixture(t);await f.speak('Selection');f.externalProvider('openai','cedar');
  await f.resolve(0,Response.json({error:'The speech provider changed. Start Speak again.'},{status:409}));
  assert.equal(f.requests.length,1);assert.match(document.querySelector('[role=status]').textContent,/provider changed/);assert.ok(!document.body.textContent.includes('Retry unfinished section'));
  await f.speak('Selection');const body=JSON.parse(f.requests[1].options.body);assert.equal(body.provider,'openai');assert.equal(body.voice,'cedar');
});


test('incremental speech applies backpressure, navigates ordered blocks and retries only unfinished audio',async t=>{
  const f=await speechFixture(t);
  const sections=Array.from({length:5},(_,index)=>({text:'Paragraph '+index,blockId:'b'+index,kind:'paragraph',sectionIndex:0}));
  await act(async()=>f.hook().speak('ignored',sections));
  await f.resolve(0);await f.resolve(1);await f.resolve(2);
  assert.equal(f.requests.length,3,'At most the current section plus two ahead are generated');
  assert.equal(document.querySelector('a[download]'),null);
  const first=document.querySelector('audio');
  await act(async()=>first.dispatchEvent(new Event('playing')));
  assert.equal(f.hook().currentBlockId,'b0');
  await act(async()=>first.dispatchEvent(new Event('ended')));
  assert.equal(f.requests.length,4);
  assert.equal(document.querySelector('audio').getAttribute('src'),'blob:speech-2');
  await f.resolve(3,Response.json({error:'Temporary provider failure.'},{status:502}));
  assert.ok(document.querySelector('audio'));assert.equal(document.querySelector('a[download]'),null);
  await act(async()=>document.querySelector('[aria-label="Next paragraph"]').click());
  assert.match(document.querySelector('[role=status]').textContent,/Temporary provider failure/,'Navigation retains partial failure and retry controls');
  await act(async()=>document.querySelector('[aria-label="Previous paragraph"]').click());
  await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Retry unfinished section').click());
  assert.equal(f.requests.length,5);assert.equal(JSON.parse(f.requests[4].options.body).text,'Paragraph 3');
  await f.resolve(4);
  assert.equal(f.requests.length,5,'Backpressure still holds after retry');
  await act(async()=>document.querySelector('[aria-label="Next paragraph"]').click());
  assert.equal(f.requests.length,6);assert.equal(JSON.parse(f.requests[5].options.body).text,'Paragraph 4');
  await f.resolve(5);
  assert.ok(document.querySelector('a[download]'));
  await act(async()=>document.querySelector('[aria-label="Previous paragraph"]').click());
  assert.equal(document.querySelector('audio').getAttribute('src'),'blob:speech-2');
  assert.equal(f.requests.length,6,'Navigation reuses generated sections without additional synthesis');
});

test('explicit full-download preparation drains bounded generation without playback and resume validates boundaries',async t=>{
  const f=await speechFixture(t);
  const sections=Array.from({length:4},(_,index)=>({text:'Part '+index,blockId:'part'+index,kind:'paragraph',sectionIndex:0}));
  await act(async()=>f.hook().speak('ignored',sections));
  await f.resolve(0);await f.resolve(1);await f.resolve(2);
  assert.equal(f.requests.length,3);
  await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Prepare complete download').click());
  assert.equal(f.requests.length,4);await f.resolve(3);
  assert.ok(document.querySelector('a[download]'));
  await act(async()=>document.querySelector('[aria-label="Next paragraph"]').click());
  await act(async()=>document.querySelector('audio').dispatchEvent(new Event('playing')));
  assert.equal(f.hook().currentBlockId,'part1');
  await act(async()=>document.querySelector('.speech-dismiss').click());
  await act(async()=>f.hook().speak('ignored',sections));
  await f.resolve(4);
  assert.equal(document.querySelector('audio'),null,'Earlier sections are retained for the complete download without playing before the resume boundary');
  await f.resolve(5);
  await act(async()=>document.querySelector('audio').dispatchEvent(new Event('playing')));
  assert.equal(f.hook().currentBlockId,'part1');
});


test('protected heading, paragraph and list sections send their configured pauses independently of reading-rule protection',async t=>{
  const narration={...structuredClone(defaultNarrationPreferences),pauses:{heading:800,paragraph:400,listItem:200}},f=await speechFixture(t,narration);
  const source=[paragraph('heading',[{text:'API',code:true}],'heading1'),paragraph('body',[{text:'123',math:true}]),paragraph('list',[{text:'API',code:true}],'bullet')];
  const original=structuredClone(source),sections=speechSections(source,source.map(block=>block.id),[]);
  await act(async()=>f.hook().speak('ignored',sections));await f.resolve(0);await f.resolve(1);await f.resolve(2);
  assert.deepEqual(f.requests.map(request=>{const body=JSON.parse(request.options.body);return {text:body.text,pauseAfterMs:body.pauseAfterMs,protectedText:body.protectedText};}),[{text:'API',pauseAfterMs:800,protectedText:true},{text:'123',pauseAfterMs:400,protectedText:true},{text:'API',pauseAfterMs:200,protectedText:true}]);
  assert.deepEqual(source,original);
});
