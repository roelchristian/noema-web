import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {TemporalIndex} from '../src/server/modules/temporal.ts';
import {LiturgicalCalendar} from '../src/server/modules/liturgical-calendar.ts';
import {createLiturgicalProvider,normalizeLitcal,normalizeOrdo,normalizeGCatholic} from '../src/server/modules/liturgical-providers.ts';
import {liturgicalCalendars,liturgicalCalendar,liturgicalKey,liturgicalSourceUrl,validLiturgicalYear} from '../src/shared/liturgical.ts';
import {createApp} from '../src/server/http.ts';
const raw=name=>readFileSync(new URL('./fixtures/liturgical/'+name,import.meta.url),'utf8');
const litcal=()=>JSON.parse(raw('litcal-2026.json'));
const ordo=()=>JSON.parse(raw('ordo1962-2026.json'));
function fixture(t) {
 const db=openDatabase(':memory:'),store=new Store(db),vaults=new Vaults(store),vault=vaults.create({name:'Liturgical fixture'}).id,knowledge=new Knowledge(store),pages=new Pages(store,knowledge),index=new TemporalIndex(store),calendars=[];
 let now=new Date('2026-10-23T10:00:00Z');
 t.after(()=>{for(const calendar of calendars)calendar.close();db.close();});
 return {db,store,vaults,vault,knowledge,pages,index,setNow:value=>now=new Date(value),calendar(provider){const calendar=new LiturgicalCalendar(store,provider,()=>now);calendars.push(calendar);return calendar;}};
}
function synthetic(year,id,key=liturgicalKey(id)) {
 const days={};for(let date=new Date(Date.UTC(year,0,1));date.getUTCFullYear()===year;date.setUTCDate(date.getUTCDate()+1))days[date.toISOString().slice(0,10)]={principal:{id:'fixture_weekday',name:'Synthetic '+id,rank:'WEEKDAY',rankName:'weekday',seasons:['Synthetic season'],colors:['Green'],optional:false},alternatives:[]};
 return {year,providerKey:key,providerVersion:'fixture',dataVersion:'fixture-data',generatedAt:'2026-10-23T00:00:00Z',days};
}
const provider=(calls=[])=>id=>({key:liturgicalKey(id),async generate(year){calls.push([id,year]);return synthetic(year,id);}});

test('LitCal normalizes movable feasts, precedence, optional choices and UTC dates from a public response fixture',()=>{
 const data=normalizeLitcal(litcal(),2026,'grc-en');assert.equal(validLiturgicalYear(data,2026),true);
 assert.equal(data.days['2026-04-05'].principal.id,'Easter');assert.equal(data.days['2026-05-24'].principal.id,'Pentecost');
 assert.equal(data.days['2026-01-06'].principal.id,'Epiphany');assert.equal(data.days['2026-05-14'].principal.id,'Ascension');
 assert.equal(data.days['2026-10-04'].principal.id,'OrdSunday27');assert.equal(data.days['2026-10-04'].alternatives.length,0);
 assert.equal(data.days['2026-10-22'].principal.rank,'WEEKDAY');assert.equal(data.days['2026-10-22'].alternatives[0].id,'StJohnPaulII');
 assert.equal(data.days['2026-06-13'].principal.name,'Optional memorials (choice)');assert.equal(data.days['2026-06-13'].alternatives.length,2);
 assert.equal(Object.keys(data.days).length,365);assert.ok(Object.keys(data.days).every(date=>date.startsWith('2026-')));
 const wrong=litcal();wrong.settings.year_type='LITURGICAL';assert.throws(()=>normalizeLitcal(wrong,2026,'grc-en'));
 assert.throws(()=>normalizeLitcal(litcal(),2026,'grc-la'));
});

test('Vetus Ordo keeps the 1962 calendar distinct and strips provider HTML from names',()=>{
 const data=normalizeOrdo(ordo(),2026);assert.equal(validLiturgicalYear(data,2026,liturgicalKey('vetus-ordo')),true);
 assert.match(data.days['2026-01-18'].principal.name,/Dominica/);
 assert.match(data.days['2026-10-25'].principal.name,/Christi Regis/);
 assert.ok(Object.values(data.days).every(day=>!day.principal.name.includes('<')));
 const wrong=ordo();wrong.source='gallia';assert.throws(()=>normalizeOrdo(wrong,2026));
 assert.equal(data.providerKey===liturgicalKey('grc-la'),false);
});

test('GCatholic iCalendar preserves Philippine propers, all-day dates, escaped text and optional memorials',()=>{
 const source=raw('gcatholic-ph-2026.ics'),data=normalizeGCatholic(source,2026,'ph');
 assert.equal(validLiturgicalYear(data,2026,liturgicalKey('ph')),true);
 assert.match(data.days['2026-01-09'].principal.name,/Nazareno/);assert.equal(data.days['2026-01-18'].principal.name,'Santo Niño');
 assert.equal(data.days['2026-10-22'].principal.rank,'WEEKDAY');assert.equal(data.days['2026-10-22'].alternatives[0].optional,true);
 assert.equal(data.days['2026-10-22'].principal.seasons.length,0,'missing ICS seasons are not invented');
 const folded=source.replace('SUMMARY:⚪ [F] Santo Niño','SUMMARY:⚪ [F] Santo\r\n  Niño');assert.equal(normalizeGCatholic(folded,2026,'ph').days['2026-01-18'].principal.name,'Santo Niño');
 assert.throws(()=>normalizeGCatholic(source,2026,'mx'),'a national feed cannot populate another calendar');
});

test('all eight provider URLs use explicit calendar, locale and civil-year identities without note data',()=>{
 assert.equal(liturgicalCalendars.length,8);
 assert.equal(new URL(liturgicalSourceUrl('grc-la',2026)).searchParams.get('locale'),'la');
 for(const id of ['us','ph','mx','fr','de'])assert.match(liturgicalSourceUrl(id,2026),new RegExp(`2026-en-${liturgicalCalendar(id).code}\\.ics`));
 assert.equal(new URL(liturgicalSourceUrl('vetus-ordo',2026)).searchParams.get('congregation'),'');
 assert.equal(new Set(liturgicalCalendars.map(item=>liturgicalKey(item.id))).size,8);
});

test('first launch queues exactly three years for all supported calendars and caches survive service restart',async t=>{
 const f=fixture(t),calls=[],calendar=f.calendar(provider(calls));
 assert.equal(calendar.status(f.vault).total,0);const planned=calendar.prepare(f.vault,2026);
 assert.equal(planned.total,24);assert.equal(planned.queued,24);assert.deepEqual(planned.years,[2025,2026,2027]);assert.equal(calls.length,0,'preparing does not block on network');
 for(let i=0;i<24;i++)await calendar.tick();assert.equal(calls.length,24);assert.equal(calendar.status(f.vault).ready,24);
 await calendar.tick();calendar.prepare(f.vault,2026);await f.calendar(provider(calls)).year(f.vault,2026,'grc-la');assert.equal(calls.length,24);
 const row=f.store.get("SELECT data FROM liturgical_calendar_cache WHERE calendar_id='grc-en' AND year=2026");assert.equal(JSON.parse(row.data).days['2026-01-01'].principal.name,'Synthetic grc-en');
 assert.equal(f.store.get('SELECT count(*) n FROM temporal_dates').n,0);assert.equal(f.store.get('SELECT count(*) n FROM ai_activity').n,0);
});

test('only curated dates and accepted relationships expand downloads; incidental mentions, pending/rejected proposals and browsing do not',async t=>{
 const f=fixture(t),calls=[],calendar=f.calendar(provider(calls));calendar.prepare(f.vault,2026);
 let page=f.pages.create(f.vault,{title:'Old dates'});f.pages.update(f.vault,page.id,{...page,blocks:[{id:'a',type:'paragraph',checked:false,content:[{text:'12 March 1998'}]}]});f.index.pageEvidence(f.vault,page.id);
 await assert.rejects(calendar.year(f.vault,1998),error=>error.status===409);assert.equal(calls.length,0);
 f.index.curate(f.vault,'1999-03-12',{label:'Curated year'});calendar.prepare(f.vault,2026);assert.deepEqual(calendar.status(f.vault).years,[1999,2025,2026,2027]);
 const event=f.knowledge.create(f.vault,{name:'Explicit event',type:'event'});f.index.curate(f.vault,'1997',{label:''});const relation=f.index.relate(f.vault,'gregorian:year:1997',{entityId:event.id,kind:'discusses'});f.index.uncurate(f.vault,'gregorian:year:1997');
 assert.ok(calendar.status(f.vault).years.includes(1997));
 for(const status of ['pending','rejected']){f.store.run('UPDATE temporal_relations SET status=? WHERE id=?',status,relation.id);assert.equal(calendar.status(f.vault).years.includes(1997),false);}
 f.store.run("UPDATE temporal_relations SET status='accepted' WHERE id=?",relation.id);await calendar.year(f.vault,1997);assert.deepEqual(calls,[['grc-en',1997]]);
 assert.equal(calendar.status(f.vault).years.includes(2000),false,'do not fill intervening years');
 f.store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-10-23',event.id);assert.equal(calendar.status(f.vault).years.includes(1997),false);
});

test('calendars and languages have independent caches; invalidated or corrupt data is downloaded again',async t=>{
 const f=fixture(t),calls=[],calendar=f.calendar(provider(calls));calendar.prepare(f.vault,2026);
 for(const id of ['grc-en','grc-la','vetus-ordo','ph'])await calendar.year(f.vault,2026,id);assert.equal(calls.length,4);
 f.store.run("UPDATE liturgical_calendar_cache SET data='{}' WHERE calendar_id='grc-en'");await calendar.year(f.vault,2026);assert.equal(calls.length,5);
 const newer=f.calendar(id=>({key:liturgicalKey(id)+'-updated',async generate(year){calls.push([id,year]);return synthetic(year,id,this.key);}}));
 await newer.year(f.vault,2026);assert.equal(calls.length,6);assert.equal(calendar.status(f.vault).ready,3);
});

test('concurrent downloads are deduplicated, serial and bounded',async t=>{
 const f=fixture(t),calls=[];let release;const hold=new Promise(resolve=>release=resolve);
 const calendar=f.calendar(id=>({key:liturgicalKey(id),async generate(year){calls.push([id,year]);if(id==='grc-en')await hold;return synthetic(year,id);}}));calendar.prepare(f.vault,2026);
 const a=calendar.year(f.vault,2026),b=calendar.year(f.vault,2026),c=calendar.year(f.vault,2026,'grc-la');await assert.rejects(calendar.year(f.vault,2027),error=>error.status===429);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);release();assert.deepEqual(await a,await b);await c;assert.equal(calls.length,2);
});

test('unsupported years and calendar IDs fail closed, qualifying years remain vault-scoped, and locking during download prevents commit',async t=>{
 const f=fixture(t),calendar=f.calendar(provider());calendar.prepare(f.vault,2026);
 for(const year of [1969,10000,2026.1,NaN])await assert.rejects(calendar.year(f.vault,year),error=>error.status===400);
 await assert.rejects(calendar.year(f.vault,2100,'ph'),error=>error.status===400);await assert.rejects(calendar.year(f.vault,2026,'invalid'),error=>error.status===400);
 const other=f.vaults.create({name:'Other'}).id;f.index.curate(other,'1990',{label:'Private qualification'});await assert.rejects(calendar.year(f.vault,1990),error=>error.status===409);
 let release;const hold=new Promise(resolve=>release=resolve),pending=f.calendar(id=>({key:liturgicalKey(id),async generate(year){await hold;return synthetic(year,id);}})).year(f.vault,2026);
 await new Promise(resolve=>setImmediate(resolve));f.vaults.lock(f.vault,{passphrase:'synthetic'});release();await assert.rejects(pending,error=>error.status===423);assert.equal(f.store.get('SELECT count(*) n FROM liturgical_calendar_cache').n,0);
 await assert.rejects(calendar.year(f.vault,2026),error=>error.status===423);
});

test('background failures back off durably and a retry resets failed jobs without modifying note knowledge',async t=>{
 const f=fixture(t);let calls=0;const calendar=f.calendar(id=>({key:liturgicalKey(id),async generate(){calls++;throw new Error('Synthetic outage');}}));calendar.prepare(f.vault,2026);await calendar.tick();
 assert.equal(calls,1);const failed=f.store.get("SELECT * FROM liturgical_calendar_downloads WHERE status='failed'");assert.equal(failed.attempts,1);assert.ok(failed.next_attempt>new Date('2026-10-23T10:00:00Z').getTime());
 const restarted=f.calendar(provider());assert.equal(restarted.status(f.vault).failed,1);restarted.prepare(f.vault,2026,true);assert.equal(restarted.status(f.vault).failed,0);
 assert.equal(f.store.get('SELECT count(*) n FROM temporal_dates').n,0);assert.equal(f.store.get('SELECT count(*) n FROM entities WHERE vault_id=?',f.vault).n,0);
});

test('provider downloads reject oversized responses, HTTP failures and aborted requests',async()=>{
 await assert.rejects(createLiturgicalProvider('grc-en',async()=>new Response('x',{headers:{'content-length':'8000001'}})).generate(2026,new AbortController().signal),/too large/);
 await assert.rejects(createLiturgicalProvider('grc-en',async()=>new Response('no',{status:503})).generate(2026,new AbortController().signal),/failed/);
 const controller=new AbortController();controller.abort();let received;
 await assert.rejects(createLiturgicalProvider('grc-en',async(_url,options)=>{received=options;options.signal.throwIfAborted();}).generate(2026,controller.signal));assert.equal(received.signal,controller.signal);assert.equal(received.redirect,'error');
});

test('HTTP preload and selected calendar endpoints preserve source identity and never send vault data to providers',async t=>{
 const f=fixture(t),originalFetch=globalThis.fetch,outbound=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).startsWith('https://')){outbound.push({url,options});return new Response(String(url).includes('gcatholic.org')?raw('gcatholic-ph-2026.ics'):JSON.stringify(litcal()),{headers:{'content-type':'application/json'}});}
  return originalFetch(url,options);
 });
 const app=createApp(f.store,'dist/client');app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>{app.close(resolve);app.closeAllConnections();}));
 const base=`http://127.0.0.1:${app.address().port}/api/temporal/liturgical`,headers={'x-vault-id':f.vault,'x-noema-request':'1','content-type':'application/json'};
 const preload=await fetch(base+'/preload',{method:'POST',headers,body:JSON.stringify({year:new Date().getFullYear()})});assert.equal(preload.status,202);assert.equal((await preload.json()).total,24);
 for(const id of ['grc-en','ph']){const response=await fetch(base+'/2026?rite='+id,{headers});assert.equal(response.status,200);assert.equal(validLiturgicalYear(await response.json(),2026,liturgicalKey(id)),true);}
 assert.equal((await fetch(base+'/3000',{headers})).status,409);assert.equal(outbound.length,2);
 for(const request of outbound){assert.equal(request.url.includes(f.vault),false);assert.equal(JSON.stringify(request.options).includes(f.vault),false);}
 assert.equal((await (await fetch(base+'/status',{headers})).json()).ready,2);
 for(const table of ['temporal_dates','temporal_relations','temporal_curation','pages','entities'])assert.equal(f.store.get(`SELECT count(*) n FROM ${table} WHERE vault_id=?`,f.vault).n,0);
});
