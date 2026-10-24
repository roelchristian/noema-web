import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRoot} from 'react-dom/client';
import {noteDateItems,noteDateRanges} from '../src/shared/note-dates.ts';
import {segmentsEqual} from '../src/shared/segments-equal.ts';
import {segmentHTML,readSegments,syncEditableSegments} from '../src/client/editor/segments.tsx';
import {ConnectedEntities,connectedNoteItems} from '../src/client/intelligence/ConnectedEntities.tsx';
import {EntityPreview} from '../src/client/components/EntityPreview.tsx';
import {NoteDatePanel} from '../src/client/knowledge/NoteDatePanel.tsx';
import {api} from '../src/client/api.ts';
import {identifyEntityMentions} from '../src/shared/auto-entities.ts';
import {setupDOM} from './helpers/dom.mjs';

const block=(content,type='paragraph',id='a')=>({id,type,checked:false,content});
const pageOf=blocks=>({id:'note',vault_id:'vault',title:'Birth date',revision:1,blocks,sourceIds:[]});
const dateId='gregorian:day:2000-12-05';

test('note dates deduplicate equivalent spellings, count occurrences and preserve precision and calendar',()=>{
 const items=noteDateItems([block([{text:'December 5, 2000; 5 December 2000; December 2000; in 2000; 5 December 2000 (Julian)'}])]);
 assert.deepEqual(items.map(item=>[item.id,item.count]),[[dateId,2],['gregorian:month:2000-12',1],['gregorian:year:2000',1],['julian:day:2000-12-05',1]]);
 assert.equal(items[0].name,'December 5, 2000');
 assert.equal(items[3].name,'December 5, 2000 (Julian)');
 assert.deepEqual(noteDateRanges([{text:'31 February 2026; about 1848; 03/04/2026'}]).map(item=>item.date.id),['gregorian:year:~1848']);
});

test('note dates cross formatting but respect semantic boundaries, cells and explicit exclusions',()=>{
 const styled=[{text:'December ',bold:true},{text:'5, ',italic:true},{text:'2000'}];
 assert.equal(noteDateRanges(styled)[0].date.id,dateId);
 for(const mark of [{math:true},{code:true},{href:'https://example.com'},{skipAutoTag:true},{sourceReference:{id:'cite'}}])assert.deepEqual(noteDateRanges([{text:'December '},{text:'5, 2000',...mark}]),[]);
 assert.deepEqual(noteDateRanges([{text:'December '},{entityId:'other'},{text:'5, 2000'}]),[]);
 for(const type of ['code','math','image','divider'])assert.deepEqual(noteDateItems([block(styled,type)]),[]);
 assert.deepEqual(noteDateItems([{...block([],'table'),rows:[[[{text:'December '}],[{text:'5, 2000'}]]]}]),[]);
 assert.equal(noteDateItems([{...block([],'table'),rows:[[styled]]}])[0].id,dateId);
 assert.deepEqual(noteDateRanges([{text:'See [[December 5, 2000]]'}]),[]);
 assert.match(segmentHTML([{text:'See [[December 5, 2000]]'}],[]),/data-page-title="December 5, 2000"/);
});

test('month names and aliases cannot consume a date during automatic knowledge entity matching',()=>{
 const input=[block([{text:'May 5, 2000; May arrived.'}])];
 const result=identifyEntityMentions(input,[{id:'may',name:'May',vault_id:'vault',type:'person'}],'vault');
 assert.equal(result.count,1);
 assert.equal(result.blocks[0].content[0].text,'May 5, 2000; ');
 assert.equal(noteDateItems(result.blocks)[0].date.value,'2000-05-05');
});

test('inline date decorations round-trip text and formatting without persisting date or entity attributes',t=>{
 setupDOM(t);
 const content=[{text:'Born on '},{text:'December ',bold:true},{text:'5, ',italic:true},{text:'2000.'}];
 const editor=document.createElement('div');editor.innerHTML=segmentHTML(content,[]);
 assert.equal(editor.textContent,'Born on December 5, 2000.');
 assert.equal(editor.querySelectorAll('[data-note-date]').length,3);
 assert.equal(editor.querySelectorAll('[data-note-date] .icon').length,1);
 assert.ok(segmentsEqual(readSegments(editor),content));
 assert.doesNotMatch(JSON.stringify(readSegments(editor)),/noteDate|temporal|entityId/);
 assert.doesNotMatch(segmentHTML(content,[],undefined,false,undefined,false),/data-note-date/,'clipboard markup omits decorations');
});

test('idle date decoration preserves the caret and waits for composition to finish',t=>{
 setupDOM(t,{html:'<article class="page" data-entity-composing="true"><div id="editor" contenteditable="true">December 5, 2000</div></article>'});
 t.mock.timers.enable({apis:['setTimeout']});
 const editor=document.querySelector('#editor'),content=[{text:editor.textContent}];
 const range=document.createRange();range.setStart(editor.firstChild,9);range.collapse(true);document.getSelection().addRange(range);
 syncEditableSegments(editor,content,[],{blockId:'a'});
 t.mock.timers.tick(1200);assert.equal(editor.querySelector('[data-note-date]'),null);
 delete document.querySelector('.page').dataset.entityComposing;t.mock.timers.tick(300);
 assert.ok(editor.querySelector('[data-note-date]'));
 const caret=document.getSelection().getRangeAt(0),prefix=caret.cloneRange();prefix.selectNodeContents(editor);prefix.setEnd(caret.startContainer,caret.startOffset);
 assert.equal(prefix.toString(),'December ');
 assert.ok(segmentsEqual(readSegments(editor),content));
});

test('editing a decorated date removes obsolete detection and updates its identity',t=>{
 setupDOM(t,{html:'<article class="page"><div id="editor" contenteditable="true"></div></article>'});
 t.mock.timers.enable({apis:['setTimeout']});
 const editor=document.querySelector('#editor');
 syncEditableSegments(editor,[{text:'December 5, 2000'}],[],{blockId:'a'});
 assert.equal(editor.querySelector('[data-note-date]').dataset.noteDate,dateId);
 editor.querySelector('[data-note-date]').lastChild.textContent='December 5, 2001';
 syncEditableSegments(editor,readSegments(editor),[],{blockId:'a'});
 assert.equal(editor.querySelector('[data-note-date]').dataset.noteDate,'gregorian:day:2001-12-05');
 editor.querySelector('[data-note-date]').lastChild.textContent='December 99, 2001';
 syncEditableSegments(editor,readSegments(editor),[],{blockId:'a'});
 assert.equal(editor.querySelector('[data-note-date]'),null);
 assert.equal(editor.textContent,'December 99, 2001');
});

test('connected dates share entity sorting, counts and the Date filter',()=>{
 const page=pageOf([block([{text:'December 5, 2000; '},{entityId:'ada'},{text:'; 5 December 2000; October 2026'}])]);
 const entities=[{id:'ada',name:'Ada',type:'person',vault_id:'vault',updated_at:'2026'}];
 assert.deepEqual(connectedNoteItems(page,entities,'mentions').map(item=>[item.id,item.count]),[[dateId,2],['ada',1],['gregorian:month:2026-10',1]]);
 assert.deepEqual(connectedNoteItems(page,entities,'page-order').map(item=>item.id),[dateId,'ada','gregorian:month:2026-10']);
 const html=renderToStaticMarkup(createElement(ConnectedEntities,{page,entities,onOpenEntity(){}}));
 assert.match(html,/aria-label="Date \(2\)"/);assert.match(html,/data-note-date="gregorian:day:2000-12-05"/);
});

test('date preview opens the date and unlinking suppresses only that occurrence while retaining formatting',async t=>{
 const env=setupDOM(t),{dom}=env;
 const prior=Object.getOwnPropertyDescriptor(globalThis,'PointerEvent');Object.defineProperty(globalThis,'PointerEvent',{configurable:true,value:dom.window.MouseEvent});
 env.defer(()=>{if(prior)Object.defineProperty(globalThis,'PointerEvent',prior);else delete globalThis.PointerEvent;});
 t.mock.timers.enable({apis:['setTimeout']});
 const content=[{text:'December ',bold:true},{text:'5, 2000'},{text:' and December 5, 2000'}],page=pageOf([block(content)]),opened=[];
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 await act(async()=>root.render(createElement(Fragment,null,
  createElement('article',{className:'page'},createElement('div',{id:'blocks'},createElement('div',{className:'block-content',contentEditable:true,suppressContentEditableWarning:true,dangerouslySetInnerHTML:{__html:segmentHTML(content,[])}}))),
  createElement(EntityPreview,{entities:[],dates:noteDateItems(page.blocks),onOpen(){assert.fail('must not open a knowledge entity');},onOpenDate:id=>opened.push(id)})
 )));
 const editor=document.querySelector('.block-content'),target=editor.querySelector('[data-note-date]');
 await act(async()=>{target.dispatchEvent(new dom.window.FocusEvent('focusin',{bubbles:true}));t.mock.timers.tick(1);});
 assert.match(document.querySelector('#entity-preview').textContent,/Gregorian · day precision/);
 await act(async()=>document.querySelector('.entity-preview-open').click());assert.deepEqual(opened,[dateId]);
 await act(async()=>{target.dispatchEvent(new dom.window.FocusEvent('focusin',{bubbles:true}));t.mock.timers.tick(1);});
 await act(async()=>document.querySelector('.remove-entity-tag').click());
 const saved=readSegments(editor);assert.equal(editor.textContent,'December 5, 2000 and December 5, 2000');
 assert.equal(saved[0].bold,true);assert.equal(saved[0].skipAutoTag,true);
 assert.equal(noteDateItems([block(saved)])[0].count,1);
});

test('date inspector shows local mentions and only note references from saved evidence',async t=>{
 const env=setupDOM(t);t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(api,'temporalDetail',async()=>({date:{id:dateId,value:'2000-12-05',calendar:'gregorian',precision:'day'},curation:null,relations:[],relationCount:0,mentionCount:2,nextRelationOffset:null,mentions:[{id:'here',pageId:'note',title:'Birth date',text:'December 5, 2000'},{id:'other',pageId:'other',title:'Another note',text:'5 December 2000'}],nextMentionOffset:null,sources:[{title:'Source to exclude'}]}));
 const page=pageOf([block([{text:'December 5, 2000'}])]),opened=[],root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 await act(async()=>root.render(createElement(NoteDatePanel,{page,item:noteDateItems(page.blocks)[0],onClose(){},onOpenPage:id=>opened.push(id)})));
 await act(async()=>t.mock.timers.tick(300));
 assert.equal(document.querySelector('.date-overview').dataset.dateId,dateId);assert.match(document.querySelector('#note-date-panel').textContent,/5 December 2000/);
 assert.match(document.querySelector('#note-date-panel').textContent,/Another note/);
 assert.doesNotMatch(document.querySelector('#note-date-panel').textContent,/Source to exclude/);
 await act(async()=>[...document.querySelectorAll('#note-date-panel button')].find(button=>button.textContent.includes('Another note')).click());
 assert.deepEqual(opened,['other']);
});


test('date inspector waits for saved curation before edits so secondary metadata survives a compact save',async t=>{
 const env=setupDOM(t);t.mock.timers.enable({apis:['setTimeout']});let resolveDetail,saved;
 const date={id:dateId,value:'2000-12-05',precision:'day',calendar:'gregorian'},curation={label:'Existing',annotation:'Historical research',pinned:false,importance:'important',personalPriority:'important',layer:'historical'};
 t.mock.method(api,'temporalDetail',()=>new Promise(resolve=>resolveDetail=resolve));
 t.mock.method(api,'curateDate',async(vault,value,body)=>{saved=body;});
 const page=pageOf([block([{text:'December 5, 2000'}])]),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 await act(async()=>root.render(createElement(NoteDatePanel,{page,item:noteDateItems(page.blocks)[0],onClose(){},onOpenPage(){}})));
 assert.equal(document.querySelector('input:not([type=checkbox])').disabled,true);
 await act(async()=>t.mock.timers.tick(300));
 assert.equal(document.querySelector('input:not([type=checkbox])').disabled,true);
 await act(async()=>resolveDetail({date,curation,mentions:[],mentionCount:0,relations:[],relationCount:0,nextMentionOffset:null,nextRelationOffset:null}));
 const pin=document.querySelector('input[type=checkbox]');assert.equal(pin.disabled,false);
 await act(async()=>pin.click());
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Save date note').click());
 assert.deepEqual(saved,{...curation,pinned:true});
});
