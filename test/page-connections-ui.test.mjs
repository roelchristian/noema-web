import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {setupDOM} from './helpers/dom.mjs';
import {api} from '../src/client/api.ts';
import {NoteConnections} from '../src/client/intelligence/NoteConnections.tsx';
import {completePageLink} from '../src/client/editor/page-links.tsx';
import {readSegments} from '../src/client/editor/segments.tsx';

const target={id:'target',title:'Target',updated_at:'2026-10-01',pinned:true,annotation:'Original',created_at:''};
const page={id:'page',vault_id:'vault',title:'Page',revision:1,updated_at:'',blocks:[{id:'b',type:'paragraph',checked:false,content:[{text:'[[page:target|Label]] [[Target]]'}]}]};
test('page connection aggregates inline/incoming/associated reasons, preserves note drafts on save errors, and removes with Undo',async t=>{
 const env=setupDOM(t),{createRoot}=await import('react-dom/client');
 t.mock.method(api,'pageBacklinks',async()=>[target]);t.mock.method(api,'pageAssociations',async()=>[target]);
 const save=t.mock.method(api,'associatePages',async()=>[target]),remove=t.mock.method(api,'removePageAssociation',async()=>[]);
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 await act(async()=>root.render(React.createElement(NoteConnections,{page,pages:[target],onOpenPage(){}})));
 assert.equal(document.querySelectorAll('.knowledge-note-link-list>li').length,1);assert.match(document.body.textContent,/Associated · Inline link · Incoming link · Featured/);
 const textarea=document.querySelector('textarea');textarea.value='Draft retained';
 await act(async()=>root.render(React.createElement(NoteConnections,{page:{...page,revision:2},pages:[target],onOpenPage(){}})));
 assert.equal(document.querySelector('textarea'),textarea);assert.equal(textarea.value,'Draft retained');
 save.mock.mockImplementation(async()=>{throw new Error('Disk full');});
 await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.match(document.querySelector('[role=alert]').textContent,/Disk full/);assert.equal(document.querySelector('textarea').value,'Draft retained');
 const click=async text=>act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===text).click());
 await click('Remove association');assert.equal(remove.mock.callCount(),1);assert.match(document.body.textContent,/Association removed/);assert.equal(document.querySelectorAll('.knowledge-note-link-list>li').length,1);
 save.mock.mockImplementation(async()=>[target]);await click('Undo');assert.deepEqual(save.mock.calls.at(-1).arguments,['vault','page','target',{pinned:true,annotation:'Original'}]);
 await env.close();
});
test('typed completion stores a stable ID only for a unique destination and retains the visible alias',async t=>{
 const env=setupDOM(t);const host=document.createElement('div');document.body.append(host);
 const complete=text=>{host.textContent=text;const range=document.createRange();range.setStart(host.firstChild,text.length);range.collapse(true);document.getSelection().removeAllRanges();document.getSelection().addRange(range);completePageLink(host,[target]);};
 complete('[[Target|Custom label]]');assert.equal(host.querySelector('a').dataset.pageId,'target');assert.equal(readSegments(host)[0].text,'[[page:target|Custom label]]');
 host.textContent='[[Target]]';const range=document.createRange();range.selectNodeContents(host);range.collapse(false);document.getSelection().removeAllRanges();document.getSelection().addRange(range);
 // Select a text caret, as the editor does after actual typing.
 range.setStart(host.firstChild,host.firstChild.length);range.collapse(true);document.getSelection().removeAllRanges();document.getSelection().addRange(range);
 completePageLink(host,[target,{...target,id:'duplicate'}]);assert.equal(host.querySelector('a').dataset.pageId,undefined);assert.equal(readSegments(host)[0].text,'[[Target]]');
 await env.close();
});
test('explicitly resolving an ambiguous table-cell link updates that cell without changing other cells',async t=>{
 const env=setupDOM(t),{createRoot}=await import('react-dom/client'),{BlockEditor}=await import('../src/client/editor/BlockEditor.tsx');
 t.mock.method(api,'entitySchema',async()=>({properties:[],subtypes:[],subtypeProperties:{}}));
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 let current=[{id:'table',type:'table',checked:false,content:[],rows:[[[{text:'Untouched first cell'}],[{text:'[[Target|Visible label]]'}]]]}],opened='';
 const render=()=>root.render(React.createElement(BlockEditor,{vaultId:'vault',blocks:current,entities:[],pages:[target,{...target,id:'second'}],onChange:next=>{current=next;render();},onOpenPage:id=>{opened=id;},onOpenEntity(){},onCreateEntity(){},onSave(){},onAddAlias:async()=>{}}));
 await act(async()=>render());await act(async()=>document.querySelector('[data-wikilink]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
 const choices=document.querySelectorAll('[role=menu][aria-label="CHOOSE NOTE"] button');assert.equal(choices.length,2);
 await act(async()=>choices[1].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
 assert.equal(opened,'second');assert.deepEqual(current[0].content,[]);assert.equal(current[0].rows[0][0][0].text,'Untouched first cell');assert.equal(current[0].rows[0][1][0].text,'[[page:second|Visible label]]');
 await env.close();
});
