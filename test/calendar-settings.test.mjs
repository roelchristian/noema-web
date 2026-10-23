import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CalendarSettings} from '../src/client/settings/CalendarSettings.tsx';
import {CalendarWorkspace} from '../src/client/calendar/CalendarWorkspace.tsx';
import {useCalendarSettings,parseCalendarSettings,defaultCalendarSettings,calendarSettingsStorageKey} from '../src/client/settings/calendar-settings.ts';
import {initialCalendarView} from '../src/client/calendar/calendar-model.ts';
import {useLiturgicalYear} from '../src/client/calendar/use-liturgical-year.ts';
import {liturgicalKey} from '../src/shared/liturgical.ts';
import {api} from '../src/client/api.ts';
import {setupDOM} from './helpers/dom.mjs';
function domFixture(t) {
 const env=setupDOM(t),previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:env.dom.window.localStorage});
 env.defer(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));return {...env,root};
}
const synthetic=(year,id)=>{const days={};for(let date=new Date(Date.UTC(year,0,1));date.getUTCFullYear()===year;date.setUTCDate(date.getUTCDate()+1))days[date.toISOString().slice(0,10)]={principal:{id:'fixture',name:id,rank:'WEEKDAY',rankName:'Weekday',seasons:[],colors:[],optional:false},alternatives:[]};return {year,providerKey:liturgicalKey(id),providerVersion:'fixture',dataVersion:'fixture',generatedAt:'2026-10-23T00:00:00Z',days};};

test('calendar preferences validate persisted calendar IDs and survive reopening Settings',async t=>{
 const env=domFixture(t);
 assert.deepEqual(parseCalendarSettings('{"calendarId":"not-a-calendar","enabled":"true","optional":1}'),defaultCalendarSettings());
 assert.deepEqual(parseCalendarSettings('bad json'),defaultCalendarSettings());
 function Harness(){const {settings,setSettings,storageError}=useCalendarSettings();return createElement(CalendarSettings,{value:settings,onChange:setSettings,storageError,vault:null});}
 await act(async()=>env.root.render(createElement(Harness)));
 assert.equal(document.querySelectorAll('#settings-liturgical-calendar option').length,8);
 await act(async()=>document.querySelector('input[type=checkbox]').click());
 await act(async()=>{const select=document.querySelector('#settings-liturgical-calendar');select.value='vetus-ordo';select.dispatchEvent(new env.dom.window.Event('change',{bubbles:true}));});
 await act(async()=>document.querySelectorAll('input[type=checkbox]')[1].click());
 assert.deepEqual(JSON.parse(localStorage.getItem(calendarSettingsStorageKey)),{enabled:true,calendarId:'vetus-ordo',optional:true});
 await act(async()=>env.root.render(createElement(Harness,{key:'reopened'})));
 assert.equal(document.querySelector('#settings-liturgical-calendar').value,'vetus-ordo');assert.equal(document.querySelector('input[type=checkbox]').checked,true);
});

test('Settings exposes queued download progress, provider attribution and a retry action',async t=>{
 const env=domFixture(t),calls=[];
 t.mock.method(api,'liturgicalStatus',async()=>({ready:8,queued:15,failed:1,total:24,years:[2025,2026,2027],calendars:[]}));
 t.mock.method(api,'prepareLiturgical',async(...args)=>{calls.push(args);return {};});
 await act(async()=>env.root.render(createElement(CalendarSettings,{value:defaultCalendarSettings(),onChange(){},storageError:false,vault:{id:'vault',locked:false}})));
 assert.match(document.body.textContent,/8 \/ 24 calendar years ready · 15 queued · 1 failed/);
 for(const provider of ['LitCal v5','Ordo1962','GCatholic'])assert.ok(document.body.textContent.includes(provider));
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Retry calendar downloads')).click());assert.equal(calls[0][0],'vault');assert.equal(calls[0][2],true);
});

test('calendar workspace keeps date filters but moves configurable liturgical controls to Settings',async t=>{
 const env=domFixture(t),opened=[];let liturgicalRequests=0;
 t.mock.method(api,'temporalDates',async()=>({items:[],nextOffset:null,indexing:{pending:0,refreshed:0}}));
 t.mock.method(api,'liturgicalYear',async()=>{liturgicalRequests++;throw new Error('Should not run when disabled');});
 await act(async()=>env.root.render(createElement(CalendarWorkspace,{vaultId:'vault',view:{...initialCalendarView(),month:'2026-10'},settings:defaultCalendarSettings(),onChange(){},onOpenSettings:()=>opened.push(true),mobile:false,onOpenMention:async()=>{}})));
 assert.equal(document.querySelectorAll('.calendar-overlay-controls input').length,0);assert.equal(liturgicalRequests,0);
 assert.match(document.querySelector('.calendar-filters').textContent,/All references/);
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Calendar settings')).click());assert.deepEqual(opened,[true]);
});

test('changing the selected liturgical calendar rejects late data and isolates offline caches by identity',async t=>{
 const env=domFixture(t),calls=[];let release;
 t.mock.method(api,'liturgicalYear',async(_vault,year,_signal,id)=>{calls.push(id);if(id==='grc-en')return new Promise(resolve=>release=()=>resolve(synthetic(year,id)));return synthetic(year,id);});
 function Harness(){const [id,setId]=useState('grc-en'),state=useLiturgicalYear('vault',2028,true,id);return createElement('div',null,createElement('button',{onClick:()=>setId('grc-la')},'Latin'),createElement('output',null,state.data?.days['2028-01-01'].principal.name??state.error));}
 await act(async()=>env.root.render(createElement(Harness)));assert.deepEqual(calls,['grc-en']);
 await act(async()=>document.querySelector('button').click());assert.equal(document.querySelector('output').textContent,'grc-la');
 await act(async()=>release());assert.equal(document.querySelector('output').textContent,'grc-la');
 assert.ok(localStorage.getItem('noema.liturgical.v2:grc-la:2028'));assert.equal(localStorage.getItem('noema.liturgical.v2:grc-en:2028'),null);
});

test('date entity view shows the selected liturgy, metadata, optional detail and provider links',async t=>{
 const env=domFixture(t),{NoteDatePanel}=await import('../src/client/knowledge/NoteDatePanel.tsx'),{temporalDate}=await import('../src/shared/temporal.ts');
 const calls=[],opened=[],date=temporalDate('2029-10-22'),item={id:date.id,date,name:'October 22, 2029',count:1,position:0};
 const page={id:'note',vault_id:'vault',title:'A note',revision:1,blocks:[],sourceIds:[]};
 t.mock.method(api,'temporalDetail',async()=>({mentions:[],nextMentionOffset:null}));
 t.mock.method(api,'liturgicalYear',async(_vault,year,_signal,id)=>{
  calls.push([year,id]);const data=synthetic(year,id);
  data.days[date.value]={principal:{id:'weekday',name:id==='grc-en'?'Monday of Ordinary Time':'Feria Secunda',rank:'WEEKDAY',rankName:'Weekday',seasons:['Ordinary Time'],colors:['Green'],optional:false},alternatives:[{id:'john-paul',name:'Saint John Paul II',rank:'OPTIONAL_MEMORIAL',rankName:'Optional memorial',seasons:['Ordinary Time'],colors:['White'],optional:true}]};return data;
 });
 const render=settings=>createElement(NoteDatePanel,{item,page,calendarSettings:settings,onClose(){},onOpenPage(){},onOpenCalendarSettings:()=>opened.push(true)});
 await act(async()=>env.root.render(render({enabled:true,calendarId:'grc-en',optional:false})));
 const panel=document.querySelector('#note-date-panel');assert.match(panel.textContent,/Monday of Ordinary Time/);assert.match(panel.textContent,/Weekday · Ordinary Time · Green/);assert.doesNotMatch(panel.textContent,/Saint John Paul II/);
 assert.ok(panel.querySelector('a[href*="litcal.johnromanodorazio.com"]'));assert.ok(panel.querySelector('a[href*="gcatholic.org"]'));
 await act(async()=>env.root.render(render({enabled:true,calendarId:'grc-en',optional:true})));
 assert.match(panel.textContent,/Saint John Paul II/);assert.equal(calls.length,1,'changing optional detail reuses the selected calendar');
 await act(async()=>env.root.render(render({enabled:true,calendarId:'vetus-ordo',optional:true})));
 assert.match(panel.textContent,/Feria Secunda/);assert.doesNotMatch(panel.textContent,/Monday of Ordinary Time/);assert.ok(panel.querySelector('a[href*="ordo.fsspx.org"]'));
 await act(async()=>panel.querySelector('[aria-label="Calendar settings"]').click());assert.deepEqual(opened,[true]);
});

test('coarse, Julian and disabled date entity views do not fetch or invent an observance',async t=>{
 const env=domFixture(t),{DateLiturgicalDetails}=await import('../src/client/knowledge/DateLiturgicalDetails.tsx'),{temporalDate}=await import('../src/shared/temporal.ts');let calls=0;
 t.mock.method(api,'liturgicalYear',async()=>{calls++;throw new Error('Unexpected calendar lookup');});
 for(const date of [temporalDate('2031'),temporalDate('2031-10'),temporalDate('2031-10-22','julian')]){
  await act(async()=>env.root.render(createElement(DateLiturgicalDetails,{vaultId:'vault',date,settings:{enabled:true,calendarId:'grc-en',optional:false}})));
  assert.match(document.body.textContent,date.calendar==='julian'?/has not been converted/:/require an exact day/);
 }
 await act(async()=>env.root.render(createElement(DateLiturgicalDetails,{vaultId:'vault',date:temporalDate('2031-10-22'),settings:defaultCalendarSettings()})));
 assert.match(document.body.textContent,/Enable a liturgical calendar/);assert.equal(calls,0);
});

test('an unqualified date year explains download eligibility in the entity view and leaves date details intact',async t=>{
 const env=domFixture(t),{NoteDatePanel}=await import('../src/client/knowledge/NoteDatePanel.tsx'),{temporalDate}=await import('../src/shared/temporal.ts'),{ApiError}=await import('../src/client/api.ts');let calls=0;
 const date=temporalDate('2033-10-22'),item={id:date.id,date,name:'October 22, 2033',count:1,position:0},page={id:'note',vault_id:'vault',title:'A note',revision:1,blocks:[],sourceIds:[]};
 t.mock.method(api,'temporalDetail',async()=>({mentions:[],nextMentionOffset:null}));
 t.mock.method(api,'liturgicalYear',async()=>{calls++;throw new ApiError(409,'This year has no curated dates or accepted date relationships.');});
 await act(async()=>env.root.render(createElement(NoteDatePanel,{item,page,calendarSettings:{enabled:true,calendarId:'ph',optional:false},onClose(){},onOpenPage(){}})));
 assert.match(document.body.textContent,/2033-10-22/);assert.match(document.body.textContent,/no curated dates or accepted date relationships/);assert.equal(calls,1);assert.equal(document.querySelector('.calendar-liturgical-panel'),null);
});
