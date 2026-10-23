import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CalendarWorkspace} from '../src/client/calendar/CalendarWorkspace.tsx';
import {initialCalendarView} from '../src/client/calendar/calendar-model.ts';
import {normalizeLitcal} from '../src/server/modules/liturgical-providers.ts';
import {temporalDate} from '../src/shared/temporal.ts';
import {api} from '../src/client/api.ts';
import {setupDOM} from './helpers/dom.mjs';

test('GRC overlay shows regular weekdays in the month grid and inspector alongside optional memorials',async t=>{
 const env=setupDOM(t),previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:env.dom.window.localStorage});
 env.defer(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const data=normalizeLitcal(JSON.parse(readFileSync(new URL('./fixtures/liturgical/litcal-2026.json',import.meta.url),'utf8')),2026,'grc-en');
 let downloads=0;
 t.mock.method(api,'temporalDates',async()=>({items:[],nextOffset:null,indexing:{pending:0,refreshed:0}}));
 t.mock.method(api,'temporalDetail',async(_vault,id)=>({date:temporalDate(id.split(':').at(-1)),curation:null,layer:'knowledge',mentions:[],mentionCount:0,relations:[],relationCount:0,nextMentionOffset:null,nextRelationOffset:null}));
 t.mock.method(api,'liturgicalYear',async()=>{downloads++;return data;});
 function Harness({optional=false,enabled=true}) {
  const [view,setView]=useState(()=>({...initialCalendarView(),month:'2026-10',selected:'2026-10-23'}));
  return createElement(CalendarWorkspace,{vaultId:'vault',view,onChange:patch=>setView(value=>({...value,...patch})),settings:{enabled,calendarId:'grc-en',optional},onOpenSettings(){},mobile:false,onOpenMention:async()=>{}});
 }
 await act(async()=>root.render(createElement(Harness)));
 assert.equal(document.querySelectorAll('.calendar-overlay-info a').length,0,'provider links are confined to advanced settings');
 const friday='Friday of the 29th Week of Ordinary Time';
 const fridayCell=document.querySelector('[data-date="2026-10-23"]');
 assert.equal(fridayCell.querySelector('.calendar-liturgical-cell').textContent,friday);
 assert.equal(fridayCell.querySelector('.calendar-liturgical-rank').textContent,'Weekday');
 assert.ok(fridayCell.getAttribute('aria-label').includes('Weekday'));
 assert.equal(fridayCell.querySelector('.calendar-liturgical-color').dataset.color,'green');
 assert.match(fridayCell.getAttribute('aria-label'),/Liturgical color: Green/);
 assert.equal(document.querySelector('[data-date="2026-10-01"] .calendar-liturgical-color').dataset.color,'white');
 assert.ok(document.querySelector('[data-date="2026-10-17"] .calendar-liturgical-color[data-color=red]'));
 assert.ok(fridayCell.getAttribute('aria-label').includes(friday));
 let inspector=document.querySelector('.calendar-inspector .calendar-liturgical-panel');
 assert.equal(inspector.querySelector('.calendar-observance-title').textContent,friday);
 assert.match(inspector.textContent,/Weekday · Ordinary Time · Green/);
 assert.doesNotMatch(inspector.textContent,/Saint John of Capestrano/);

 await act(async()=>root.render(createElement(Harness,{optional:true})));
 inspector=document.querySelector('.calendar-inspector .calendar-liturgical-panel');
 assert.equal(inspector.querySelector('.calendar-observance-title').textContent,friday,'optional memorials retain the regular weekday as principal');
 assert.match(inspector.textContent,/Saint John of Capestrano/);
 assert.equal(downloads,1,'optional detail reuses the downloaded year');
 assert.equal(fridayCell.querySelector('.calendar-liturgical-color').dataset.color,'green','optional memorial white does not replace the principal color');

 await act(async()=>document.querySelector('[data-date="2026-10-24"]').click());
 assert.equal(document.querySelector('.calendar-inspector .calendar-observance-title').textContent,'Saturday of the 29th Week of Ordinary Time','weekday labels follow the selected date');
 await act(async()=>document.querySelector('[data-date="2026-10-25"]').click());
 assert.equal(document.querySelector('.calendar-inspector .calendar-observance-title').textContent,'30th Sunday of Ordinary Time','Sunday precedence remains intact');
 assert.equal(document.querySelector('[data-date="2026-10-01"] .calendar-liturgical-cell').textContent,'Saint Thérèse of the Child Jesus, Virgin and Doctor of the Church','obligatory memorials remain principal');
 await act(async()=>root.render(createElement(Harness,{enabled:false})));
 assert.equal(document.querySelectorAll('.calendar-liturgical-colors').length,0,'color markers disappear when the overlay is disabled');
});

test('Latin temporal labels use Roman week ordinals in the grid, inspector and agenda',async t=>{
 const {liturgicalLabel}=await import('../src/client/calendar/liturgical-label.ts');
 const cases=[
  ['Feria IV Hebdomadæ Secundæ Temporis Paschali','Feria IV hebd. II Paschae'],
  ['Feria VI Hebdomadae Vigesimae nonae Temporis Ordinarii','Feria VI hebd. XXIX per annum'],
  ['Sabbato Hebdomadæ Duodevicesimæ Temporis Ordinarii','Sabbato hebd. XVIII per annum'],
  ['Feria III Hebdomadæ Undevicesimæ Temporis Ordinarii','Feria III hebd. XIX per annum'],
  ['Feria II Hebdomadæ Trigesimæ quartæ Temporis Ordinarii','Feria II hebd. XXXIV per annum'],
  ['Feria quarta hebdomadae secundae Paschae','Feria IV hebd. II Paschae'],
  ['Dominica Tertia Adventus (Gaudete)','Dominica III Adventus (Gaudete)'],
  ['Dominica II «Per Annum»','Dominica II per annum'],
  ['Dominica XXIX “PER ANNUM”','Dominica XXIX per annum'],
  ['Dominica III Per Annum','Dominica III per annum'],
  ['Sanctae Secundae, Martyris','Sanctae Secundae, Martyris'],
 ];
 for(const [name,expected] of cases){
  assert.equal(liturgicalLabel(name,'grc-la'),expected);
  assert.equal(liturgicalLabel(name,'grc-en'),name,'English calendar labels are unchanged');
 }
 const env=setupDOM(t),previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:env.dom.window.localStorage});
 env.defer(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/liturgical/litcal-2026.json',import.meta.url),'utf8'));
 fixture.settings.locale='la';
 const data=normalizeLitcal(fixture,2026,'grc-la');
 data.days['2026-10-23'].principal.name=cases[1][0];
 data.days['2026-10-23'].principal.colors=['Viridis'];
 t.mock.method(api,'temporalDates',async()=>({items:[],nextOffset:null,indexing:{pending:0,refreshed:0}}));
 t.mock.method(api,'temporalDetail',async(_vault,id)=>({date:temporalDate(id.split(':').at(-1)),curation:null,layer:'knowledge',mentions:[],mentionCount:0,relations:[],relationCount:0,nextMentionOffset:null,nextRelationOffset:null}));
 t.mock.method(api,'liturgicalYear',async()=>data);
 function Harness(){
  const [view,setView]=useState(()=>({...initialCalendarView(),month:'2026-10',selected:'2026-10-23'}));
  return createElement(CalendarWorkspace,{vaultId:'vault',view,onChange:patch=>setView(value=>({...value,...patch})),settings:{enabled:true,calendarId:'grc-la',optional:false},onOpenSettings(){},mobile:false,onOpenMention:async()=>{}});
 }
 await act(async()=>root.render(createElement(Harness)));
 const cell=document.querySelector('[data-date="2026-10-23"]');
 assert.equal(cell.querySelector('.calendar-liturgical-cell').textContent,cases[1][1]);
 assert.equal(cell.querySelector('.calendar-liturgical-color').dataset.color,'green','Latin provider color names use the same palette');
 assert.ok(cell.getAttribute('aria-label').includes(cases[1][1]));
 assert.equal(document.querySelector('.calendar-inspector .calendar-observance-title').textContent,cases[1][1]);
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Agenda').click());
 assert.ok(document.querySelector('.calendar-liturgical-agenda').textContent.includes(cases[1][1]));
 assert.equal(document.querySelectorAll('.calendar-liturgical-agenda .calendar-liturgical-rank').length,31);
 assert.equal(data.days['2026-10-23'].principal.name,cases[1][0],'display formatting preserves cached provider data');
});


test('liturgical color markers preserve multiple principal colors and omit unknown colors',async t=>{
 const {LiturgicalColorIndicator}=await import('../src/client/calendar/LiturgicalColorIndicator.tsx');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 await act(async()=>root.render(createElement(LiturgicalColorIndicator,{colors:['Rosea','Purpura','Purple','Unknown']})));
 assert.deepEqual([...document.querySelectorAll('.calendar-liturgical-color')].map(marker=>marker.dataset.color),['rose','purple']);
 assert.equal(document.querySelector('.calendar-liturgical-colors').getAttribute('aria-hidden'),'true');
 await act(async()=>root.render(createElement(LiturgicalColorIndicator,{colors:[]})));
 assert.equal(document.querySelector('.calendar-liturgical-colors'),null);
});


test('rank labels use consistent sentence case without losing proper names or Roman classes',async()=>{
 const {liturgicalRankLabel}=await import('../src/client/calendar/liturgical-label.ts');
 for(const [input,expected] of [
  ['weekday','Weekday'],['FEAST','Feast'],['optional memorial','Optional memorial'],
  ['FEAST OF THE LORD','Feast of the Lord'],['SOLLEMNITAS','Sollemnitas'],
  ['FESTUM DOMINI','Festum Domini'],['memoria ad libitum','Memoria ad libitum'],
  ['  Memoria   obligatoria ','Memoria obligatoria'],['class iv','Class IV'],
 ])assert.equal(liturgicalRankLabel(input),expected);
});
