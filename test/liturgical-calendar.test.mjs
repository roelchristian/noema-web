import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {LiturgicalCalendar} from '../src/server/modules/liturgical-calendar.ts';
import {liturgicalProviderKey,validLiturgicalYear} from '../src/shared/liturgical.ts';
import {createApp} from '../src/server/http.ts';

function fixture(t) {const db=openDatabase(':memory:'),store=new Store(db),vaults=new Vaults(store),vault=vaults.create({name:'Liturgical fixture'}).id;const calendars=[];t.after(()=>{for(const calendar of calendars)calendar.close();db.close();});return {db,store,vaults,vault,calendar(provider){const calendar=new LiturgicalCalendar(store,provider);calendars.push(calendar);return calendar;}};}
function synthetic(year,key) {const days={};for(let date=new Date(Date.UTC(year,0,1));date.getUTCFullYear()===year;date.setUTCDate(date.getUTCDate()+1))days[date.toISOString().slice(0,10)]={principal:{id:'fixture_weekday',name:'Synthetic weekday',rank:'WEEKDAY',rankName:'weekday',seasons:['Synthetic season'],colors:['Green'],optional:false},alternatives:[]};return {year,providerKey:key,providerVersion:'fixture',dataVersion:'fixture-data',generatedAt:new Date().toISOString(),days};}

test('real universal provider calculates movable observances, Sunday precedence, and solemnity transfers',async t=>{
 const f=fixture(t),calendar=f.calendar();
 const y2024=await calendar.year(f.vault,2024);assert.equal(validLiturgicalYear(y2024,2024),true);assert.equal(Object.keys(y2024.days).length,366);
 assert.equal(y2024.days['2024-03-31'].principal.id,'easter_sunday');assert.equal(y2024.days['2024-05-19'].principal.id,'pentecost_sunday');
 assert.equal(y2024.days['2024-03-25'].principal.id,'holy_monday');assert.equal(y2024.days['2024-04-08'].principal.id,'annunciation_of_the_lord');
 const y2023=await calendar.year(f.vault,2023);assert.match(y2023.days['2023-03-19'].principal.id,/lent/);assert.match(y2023.days['2023-03-20'].principal.id,/joseph/);
 const y2026=await calendar.year(f.vault,2026);assert.equal(y2026.days['2026-10-04'].principal.id,'ordinary_time_27_sunday');assert.equal(y2026.days['2026-10-04'].alternatives.length,0,'impeded Francis memorial must not be invented as an observed feast');
 assert.equal(y2026.days['2026-01-06'].principal.id,'epiphany_of_the_lord');assert.equal(y2026.days['2026-05-14'].principal.id,'ascension_of_the_lord');assert.equal(y2026.days['2026-06-04'].principal.id,'most_holy_body_and_blood_of_christ');
 assert.equal(y2026.days['2026-10-22'].principal.rank,'WEEKDAY');assert.ok(y2026.days['2026-10-22'].alternatives.some(day=>day.id==='john_paul_ii_pope'&&day.optional));
 assert.deepEqual(y2026.days['2026-10-04'].principal.colors,['Green']);assert.deepEqual(y2026.days['2026-04-04'].principal.colors,[],'missing provider colour is preserved, not fabricated');assert.ok(y2026.days['2026-04-02'].alternatives.some(day=>day.id==='thursday_of_the_lords_supper'&&!day.optional));
});
test('yearly cache survives service restarts, invalidates by provider/data key, rejects corruption and remains bounded',async t=>{
 const f=fixture(t);let calls=0;const provider={key:liturgicalProviderKey,async generate(year){calls++;return synthetic(year,this.key);}};
 await f.calendar(provider).year(f.vault,2026);assert.equal(calls,1);await f.calendar(provider).year(f.vault,2026);assert.equal(calls,1);
 const newer={key:liturgicalProviderKey+'-updated-data',async generate(year){calls++;return synthetic(year,this.key);}};await f.calendar(newer).year(f.vault,2026);assert.equal(calls,2);assert.equal(f.store.get('SELECT provider_key FROM liturgical_year_cache WHERE year=2026').provider_key,newer.key);
 f.store.run('UPDATE liturgical_year_cache SET data=? WHERE year=2026','{"days":{}}');await f.calendar(newer).year(f.vault,2026);assert.equal(calls,3);
 const calendar=f.calendar(newer);for(let year=2000;year<2010;year++)await calendar.year(f.vault,year);assert.equal(f.store.get('SELECT count(*) n FROM liturgical_year_cache').n,8);
});
test('concurrent generation is deduplicated, serial and bounded; failures leave the civil index unchanged',async t=>{
 const f=fixture(t);let calls=0,release;const hold=new Promise(resolve=>release=resolve);
 const calendar=f.calendar({key:liturgicalProviderKey,async generate(year){calls++;if(year===2026)await hold;return synthetic(year,liturgicalProviderKey);}});
 const a=calendar.year(f.vault,2026),b=calendar.year(f.vault,2026),c=calendar.year(f.vault,2027);await assert.rejects(calendar.year(f.vault,2028),error=>error.status===429);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);release();assert.deepEqual(await a,await b);await c;assert.equal(calls,2);
 const tables=['temporal_dates','temporal_mentions','temporal_source_mentions','temporal_relations','temporal_curation','entities','pages'],before=tables.map(table=>f.store.get(`SELECT count(*) n FROM ${table}`).n);
 const failing=f.calendar({key:'failed-provider',async generate(){throw new Error('Synthetic provider failure');}});await assert.rejects(failing.year(f.vault,2026),error=>error.status===503);assert.deepEqual(tables.map(table=>f.store.get(`SELECT count(*) n FROM ${table}`).n),before);
});
test('supported range, cache shape, and vault access are explicit, including a lock during generation',async t=>{
 const f=fixture(t),calendar=f.calendar();for(const year of [1969,2100,2026.1,NaN])await assert.rejects(calendar.year(f.vault,year),error=>error.status===400);
 assert.equal(validLiturgicalYear(synthetic(2026,'wrong-version'),2026),false);assert.equal(validLiturgicalYear({...synthetic(2026,liturgicalProviderKey),days:{}},2026),false);
 let release;const hold=new Promise(resolve=>release=resolve),pending=f.calendar({key:liturgicalProviderKey,async generate(year){await hold;return synthetic(year,liturgicalProviderKey);}}).year(f.vault,2026);await new Promise(resolve=>setImmediate(resolve));f.vaults.lock(f.vault,{passphrase:'synthetic'});release();await assert.rejects(pending,error=>error.status===423);await assert.rejects(calendar.year(f.vault,2026),error=>error.status===423);
 f.vaults.unlock(f.vault,{passphrase:'synthetic'});assert.equal((await calendar.year(f.vault,2026)).year,2026);
});
test('liturgical HTTP endpoint uses the local provider and validates range without creating knowledge items',async t=>{
 const f=fixture(t),app=createApp(f.store,'dist/client');app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>{app.close(resolve);app.closeAllConnections();}));
 const base=`http://127.0.0.1:${app.address().port}/api/temporal/liturgical`,headers={'x-vault-id':f.vault,'x-noema-request':'1'};
 assert.equal((await fetch(base+'/1960',{headers})).status,400);const response=await fetch(base+'/2026',{headers});assert.equal(response.status,200);const result=await response.json();assert.equal(validLiturgicalYear(result,2026),true);
 for(const table of ['temporal_dates','temporal_relations','temporal_curation','pages','entities'])assert.equal(f.store.get(`SELECT count(*) n FROM ${table} WHERE vault_id=?`,f.vault).n,0,table);
 assert.equal(f.store.get('SELECT count(*) n FROM ai_activity').n,0);
});
