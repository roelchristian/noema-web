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
import {monthBounds,monthCells,civilWeek,civilRowWeek,isoRowWeek,dateSummary,dateAssociations,shiftMonth,shiftDay,dateLabel,calendarGroups,emptyCuration} from '../src/client/calendar/calendar-model.ts';
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
 assert.equal(monthBounds('0001-02').to,'0001-02-28');const cells=monthCells('2026-10').flat();assert.equal(cells.filter(value=>value?.startsWith('2026-10')).length,31);assert.equal(monthCells('2026-11')[0][0],'2026-11-01');assert.deepEqual(cells.slice(0,5),['2026-09-27','2026-09-28','2026-09-29','2026-09-30','2026-10-01']);
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


test('week-start layouts and ISO row labels retain ISO week-year across civil boundaries',()=>{
 assert.deepEqual(monthCells('2026-11',1)[0],['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
 assert.deepEqual(isoRowWeek('2021-01',0,1),{year:2020,week:53,label:'2020-W53'});
 assert.deepEqual(isoRowWeek('2021-01',0,0),{year:2020,week:53,label:'2020-W53'});
 assert.equal(isoRowWeek('2026-11',0,0).label,'2026-W45','Sunday Nov 1 is W44; row label explicitly describes Monday Nov 2');
 assert.equal(isoRowWeek('2026-11',0,1).label,'2026-W44');
 assert.equal(isoRowWeek('2018-12',5,1).label,'2019-W01');
 assert.equal(isoRowWeek('0001-01',0,0).label,'0001-W01');
 assert.equal(isoRowWeek('9999-12',4,0).label,'9999-W52');
 for(const start of [0,1])for(const month of ['0001-01','1900-02','2000-02','2026-11','9999-12'])assert.equal(new Set(monthCells(month,start).flat().filter(date=>date?.startsWith(month))).size,Number(monthBounds(month).to.slice(-2)));
});

test('civil weeks use Sunday with January 1 by default and ISO rules for Monday layouts',()=>{
 assert.deepEqual(civilWeek('2026-10-23'),{year:2026,week:43,weekStart:0,from:'2026-10-18',to:'2026-10-24',label:'2026-W43'});
 assert.equal(civilRowWeek('2026-10',4).week,44);
 assert.deepEqual(civilRowWeek('2026-11',0),{year:2026,week:45,weekStart:0,from:'2026-11-01',to:'2026-11-07',label:'2026-W45'});
 assert.deepEqual(civilRowWeek('2026-11',0,1),{year:2026,week:44,weekStart:1,from:'2026-10-26',to:'2026-11-01',label:'2026-W44'});
 assert.deepEqual(civilWeek('2021-01-01'),{year:2021,week:1,weekStart:0,from:'2020-12-27',to:'2021-01-02',label:'2021-W01'});
 assert.deepEqual(civilWeek('2021-01-01',1),{year:2020,week:53,weekStart:1,from:'2020-12-28',to:'2021-01-03',label:'2020-W53'});
 assert.equal(civilWeek('2023-12-31').label,'2024-W01');
 assert.equal(civilWeek('2023-12-31',1).label,'2023-W52');
 assert.equal(civilWeek('2028-12-30').label,'2028-W53');
 assert.equal(civilWeek('2024-02-29').week,9);
 for(const start of [0,1])for(const date of ['0001-01-01','1900-01-01','2000-01-01','2026-12-31','9999-12-31']){
  const week=civilWeek(date,start);assert.equal(new Date(`${week.from}T00:00:00Z`).getUTCDay(),start);assert.equal(shiftDay(week.from,6),week.to);assert.ok(week.week>=1&&week.week<=53);
 }
});

test('day summaries distinguish loaded documents, full occurrence totals and accepted links',()=>{
 const item={curation:{label:'My date'},mentions:[{id:'m1',pageId:'p1',title:'Notebook',text:'23 October 2026'},{id:'m2',pageId:'p1',title:'Notebook',text:'23 October 2026'}],mentionCount:25,sourceCount:7,propertyCount:2,relations:[{id:'r1',entityId:'e1',kind:'occurs_on',name:'Accepted entity'}],relationCount:4,proposals:[{name:'Pending'}],proposalCount:10};
 const summary=dateSummary(item);
 assert.equal(summary.title,'My date');assert.equal(summary.total,36);assert.equal(summary.counts,'1+ document · 32 occurrences · 4 linked items');
 assert.equal(dateAssociations(item).filter(entry=>entry.kind==='reference').length,1);
 assert.deepEqual(dateAssociations(item,false).map(entry=>entry.title),['My date','Accepted entity']);
});

test('distinct association ordering retains roles and excludes pending or incidental records by default policy',()=>{
 const item={curation:{label:'Pinned research',pinned:true},mentions:[{id:'m1',pageId:'p1',title:'Repeated',text:'A'},{id:'m2',pageId:'p1',title:'Repeated',text:'B'}],relations:[{id:'r2',entityId:'e1',name:'Event',kind:'ends_on'},{id:'r1',entityId:'e1',name:'Event',kind:'occurs_on'}],properties:[{id:'p1',entityId:'e2',title:'Unreviewed',name:'date',raw:'1815'}],proposals:[{id:'proposal',name:'Never accepted'}]};
 assert.deepEqual(dateAssociations(item,false).map(entry=>entry.description),['Curated date','occurs on','ends on']);
 assert.deepEqual(dateAssociations(item).map(entry=>entry.kind),['curation','event','event','property','reference']);
 assert.deepEqual(dateAssociations({...item,relations:[...item.relations].reverse()}),dateAssociations(item));
});
