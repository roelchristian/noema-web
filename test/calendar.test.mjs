import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {TemporalIndex} from '../src/server/modules/temporal.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {monthBounds,monthCells,shiftMonth,shiftDay,dateLabel,calendarGroups,emptyCuration} from '../src/client/calendar/calendar-model.ts';
import {capturePageSelection,restorePageSelection} from '../src/client/state/use-page-selection.ts';
import {setupDOM} from './helpers/dom.mjs';
import {selectionOffsets} from '../scripts/browser-selection.mjs';

function fixture(t) {const db=openDatabase(':memory:');t.after(()=>db.close());const store=new Store(db),vault=new Vaults(store).create({name:'Calendar fixture'}),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),index=new TemporalIndex(store);return {store,vault,pages,index};}

test('calendar ranges and nested evidence paginate before materialization, retaining coarse precision',t=>{
 const {vault,index,pages}=fixture(t);
 for(let i=1;i<=105;i++){const value=shiftDay('2026-01-01',i-1);index.curate(vault.id,value,{label:'Curated '+i});}
 index.curate(vault.id,'2026',{label:'A whole year'});index.curate(vault.id,'2026-01',{label:'A whole month'});
 let page=pages.create(vault.id,{title:'Repeated evidence'});page=pages.update(vault.id,page.id,{...page,blocks:[{id:'a',type:'paragraph',content:[{text:Array(25).fill('1 January 2026').join('; ')}],checked:false}]});
 const first=index.query(vault.id,'2026-01-01','2026-12-31');assert.equal(first.items.length,100);assert.equal(first.nextOffset,100);
 const second=index.query(vault.id,'2026-01-01','2026-12-31',false,'gregorian',{offset:first.nextOffset});assert.equal(second.items.length,7);assert.equal(second.nextOffset,null);
 assert.equal(new Set([...first.items,...second.items].map(item=>item.date.id)).size,107);
 const day=first.items.find(item=>item.date.value==='2026-01-01');assert.equal(day.mentionCount,25);assert.equal(day.mentions.length,3);
 const detail=index.detail(vault.id,day.date.id);assert.equal(detail.mentions.length,20);assert.equal(detail.nextMentionOffset,20);
 const tail=index.detail(vault.id,day.date.id,20);assert.equal(tail.mentions.length,5);assert.equal(tail.nextMentionOffset,null);
 for(const options of [{limit:101},{limit:0},{offset:-1},{offset:100001},{layers:['guessed']}])assert.throws(()=>index.query(vault.id,'2026-01-01','2026-12-31',false,'gregorian',options),error=>error.status===400);
 assert.deepEqual(index.query(vault.id,'2026-01-01','2026-12-31',false,'gregorian',{layers:[]}).items,[]);
 const grouped=calendarGroups(first.items);assert.equal(grouped.periods.length,2);assert.ok(grouped.days.every(item=>item.date.value.length===10));assert.equal(grouped.periods.find(item=>item.date.precision==='month').date.value,'2026-01');
});

test('Personal and Historical are explicit curation choices; incidental dates remain Knowledge',async t=>{
 const {store,vault,index,pages}=fixture(t);let page=pages.create(vault.id,{title:'History and plans'});page=pages.update(vault.id,page.id,{...page,blocks:[{id:'a',type:'paragraph',checked:false,content:[{text:'12 March 1861 and 23 October 2026.'}]}]});
 assert.equal(index.query(vault.id,'1861-01-01','2026-12-31',true).items.every(item=>item.layer==='knowledge'),true);
 assert.equal(index.query(vault.id,'1861-01-01','2026-12-31').items.length,0);
 index.curate(vault.id,'1861-03-12',{label:'Historical context',layer:'historical'});index.curate(vault.id,'2026-10-23',{label:'My anniversary',layer:'personal'});
 assert.equal(index.query(vault.id,'1861-01-01','2026-12-31',true,'gregorian',{layers:['personal']}).items[0].date.value,'2026-10-23');
 assert.equal(index.query(vault.id,'1861-01-01','2026-12-31',true,'gregorian',{layers:['historical']}).items[0].date.value,'1861-03-12');
 const backups=new VaultBackups(store),bytes=(await backups.export(vault.id)).bytes,restored=await backups.import(bytes,'Explicit layers');
 assert.equal(index.query(restored.id,'2026-01-01','2026-12-31').items[0].curation.layer,'personal');
 const legacy=JSON.parse(gunzipSync(bytes));for(const row of legacy.tables.temporal_curation)delete row.layer;
 const old=await backups.import(gzipSync(JSON.stringify(legacy)),'Prior temporal backup');assert.equal(index.query(old.id,'2026-01-01','2026-12-31').items[0].curation.layer,'knowledge');
 index.uncurate(vault.id,'gregorian:day:2026-10-23');assert.equal(index.query(vault.id,'2026-01-01','2026-12-31').items.length,0);assert.equal(index.query(vault.id,'2026-01-01','2026-12-31',true).items.length,1);
});

test('civil grid handles leap years and year boundaries without assigning coarse dates to day cells',()=>{
 assert.deepEqual(monthBounds('2024-02'),{from:'2024-02-01',to:'2024-02-29'});assert.equal(monthBounds('1900-02').to,'1900-02-28');assert.equal(shiftMonth('2026-01',-1),'2025-12');assert.equal(shiftDay('2026-01-01',-1),'2025-12-31');
 assert.equal(monthBounds('0001-02').to,'0001-02-28');const cells=monthCells('2026-10').flat();assert.equal(cells.filter(Boolean).length,31);assert.deepEqual(cells.slice(0,4),[null,null,null,'2026-10-01']);
 assert.equal(dateLabel('2026'),'2026');assert.equal(dateLabel('2026-10'),'October 2026');assert.equal(dateLabel('2026-10-23'),'October 23, 2026');assert.equal(emptyCuration().layer,'knowledge');
});

test('editor selection bookmarks retain UTF-16 ranges and refuse changed or detached surfaces',t=>{
 setupDOM(t,{html:'<div id="content"><div data-block-id="a"><div class="block-content" contenteditable="true">😀 text <b>bold</b></div></div><div data-block-id="table"><div class="block-content" contenteditable="true">first cell</div><div class="block-content" contenteditable="true">second cell</div></div></div>'});
 const a=document.querySelector('[data-block-id=a] .block-content'),cell=document.querySelectorAll('[data-block-id=table] .block-content')[1];
 getSelection().setBaseAndExtent(a.firstChild,3,cell.firstChild,4);const saved=capturePageSelection();assert.equal(saved.anchor.offset,3);assert.equal(saved.focus.surface,1);
 getSelection().removeAllRanges();assert.equal(restorePageSelection(saved),true);assert.equal(getSelection().anchorNode,a.firstChild);assert.equal(getSelection().focusOffset,4);assert.equal(getSelection().focusNode,cell.firstChild);
 cell.textContent='changed cell';assert.equal(restorePageSelection(saved),false);cell.remove();assert.equal(restorePageSelection(saved),false);
});

test('browser selection assertions measure both endpoints across nested date spans in UTF-16',t=>{
 setupDOM(t,{html:'<div id="editor" contenteditable="true">😀<strong>é</strong><span data-note-date="fixture">23 October <i>2026</i></span><span> tail</span></div><p id="outside">Other</p>'});
 const editor=document.querySelector('#editor'),selection=getSelection(),tail=editor.lastChild.firstChild,accent=editor.querySelector('strong').firstChild,year=editor.querySelector('i').firstChild;
 selection.setBaseAndExtent(tail,5,tail,5);
 assert.equal(selection.anchorOffset,5);
 assert.deepEqual(selectionOffsets(editor),{anchor:editor.textContent.length,focus:editor.textContent.length});
 selection.setBaseAndExtent(year,2,accent,2);
 const anchor=editor.textContent.indexOf('2026')+2,focus=4;
 assert.deepEqual(selectionOffsets(editor),{anchor,focus});
 assert.equal(selection.toString(),editor.textContent.slice(focus,anchor));
 selection.setBaseAndExtent(editor,1,editor,3);
 assert.deepEqual(selectionOffsets(editor),{anchor:2,focus:editor.textContent.indexOf(' tail')});
 selection.setBaseAndExtent(editor.firstChild,0,document.querySelector('#outside').firstChild,1);
 assert.equal(selectionOffsets(editor),null,'a selection leaving the editor is not a valid local bookmark');
 selection.removeAllRanges();assert.equal(selectionOffsets(editor),null);
});
