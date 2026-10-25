import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { createApp } from '../src/server/http.ts';
import { Intelligence } from '../src/server/modules/intelligence.ts';
import { AIEnrichments } from '../src/server/modules/ai-enrichments.ts';
import { Pages } from '../src/server/modules/pages.ts';
import { Knowledge } from '../src/server/modules/knowledge.ts';

import {enrichmentResponse} from './helpers/providers.ts';
import {providerBarrier} from './helpers/provider-barrier.mjs';

test('saved enrichments survive restart, refresh safely, and follow page access and lifecycle', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'noema-enrichments-')), filename = path.join(dir, 'test.sqlite');
  let db, server, base, output = 'Saved summary', fail = false, heldProvider, calls = 0;
  const secrets = {value:null, read(){return this.value;}, write(value){this.value=value;}, remove(){this.value=null;}};
  let requestBody;
  const response=summary=>enrichmentResponse(requestBody,{title:'Generated note',summary,primaryDomainId:null,secondaryDomainIds:[],language:'en'});
  const ai = new Intelligence(secrets, async (_url,request) => {
    requestBody=request.body;
    calls++;
    if (fail) throw new Error('Provider unavailable');
    if (heldProvider) {const barrier=heldProvider;heldProvider=undefined;return barrier.enter();}
    return response(output);
  });
  ai.save({apiKey:'sk-test-persisted-enrichments-secret'});
  async function start() {
    db = openDatabase(filename);
    server = createApp(new Store(db), path.resolve('dist/client'), ai);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port + '/api/';
  }
  async function stop() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); }
  async function call(route, method='GET', body, expected=200, vault='default', signal) {
    const response = await fetch(base+route, {method, signal, headers:{'X-Noema-Request':'1','Content-Type':'application/json','X-Vault-Id':vault}, body:body===undefined?undefined:JSON.stringify(body)});
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
  }
  await start();
  try {
    let page = await call('pages', 'POST', {title:'Persistent knowledge'}, 201);
    const route = 'pages/'+page.id;
    assert.deepEqual((await call(route+'/enrichments')).map(item=>item.kind),[]);
    page=await call(route,'PUT',{...page,blocks:[{id:'body',type:'paragraph',content:[{text:'A persistent note about knowledge and careful planning.'}]}]});
    const generated=async()=> (await call(route+'/enrichments')).filter(item=>['summary','topics'].includes(item.kind));
    assert.deepEqual(await generated(),[]);
    const original = await call(route+'/summary', 'POST', {revision:page.revision});
    let items = await generated();
    assert.equal(items.length, 1); assert.equal(items[0].kind, 'summary');
    assert.equal(items[0].data.summary,original.summary);assert.equal(items[0].data.origin,'inferred');assert.equal(items[0].data.generatedContentHash,original.contentHash);assert.equal(items[0].data.baseline,undefined);
    assert.equal(items[0].revision, page.revision); assert.equal(items[0].model, original.model);
    assert.equal(items[0].reasoningEffort, original.reasoningEffort); assert.ok(Date.parse(items[0].updated_at));
    assert.equal((await call(route)).revision, page.revision, 'Enrichments do not modify the editor revision');
    await stop(); await start();
    assert.deepEqual(await generated(), items); assert.equal(calls, 1, 'Loading saved results never calls the provider');
    await call('intelligence/activity', 'DELETE'); assert.deepEqual(await generated(), items);
    const other = await call('vaults', 'POST', {name:'Other'}, 201);
    await call(route+'/enrichments', 'GET', undefined, 404, other.id);
    await call('vaults/default/lock', 'POST', {passphrase:'lock-test'});
    await call(route+'/enrichments', 'GET', undefined, 423);
    await call('vaults/default/unlock', 'POST', {passphrase:'lock-test'});
    assert.deepEqual(await generated(), items);
    output = 'Refreshed summary';
    await call(route+'/summary', 'POST', {revision:page.revision});
    items = await generated(); assert.equal(items.length, 1); assert.equal(items[0].data.summary, output);
    fail = true; await call(route+'/summary', 'POST', {revision:page.revision}, 502); fail = false;
    assert.deepEqual(await generated(), items, 'A provider failure retains the last saved result');
    const barrier=heldProvider=providerBarrier('summary stale-result race'),controller=new AbortController();
    const pending = call(route+'/summary', 'POST', {revision:page.revision}, 409, 'default', controller.signal);
    try {
      await barrier.waitForEntry(pending);
      page = await call(route, 'PUT', {...page, title:'Edited page'});
      barrier.release(response('Stale result')); await pending;
    } finally {
      await barrier.close(pending,{value:new Response('Synthetic provider fixture teardown',{status:503}),controller});
      heldProvider=undefined;
    }
    assert.deepEqual(await generated(), items, 'An in-flight page edit cannot overwrite saved knowledge');
    assert.notEqual(items[0].revision, page.revision, 'Saved revision supports stale-result indicators');
    const store = new Store(db), enrichments = new AIEnrichments(store, new Pages(store, new Knowledge(store)));
    enrichments.save('default', page.id, 'topics', {topics:['Gardening','Planning']}, page.revision, ai.selection());
    enrichments.save('default',page.id,'private_future_evidence',{baseline:{body:'private text',tokenCounts:{private:9},embedding:{vector:[1,2,3]}}},page.revision,ai.selection());
    assert.equal((await call(route+'/enrichments')).some(item=>item.kind==='private_future_evidence'),false,'Unknown evidence kinds require an explicit public projection');
    const versionBefore=await call(route+'/enrichment-status');
    assert.equal(typeof versionBefore.version,'string');assert.ok(JSON.stringify(versionBefore).length<250);
    db.prepare("UPDATE page_ai_enrichments SET data=? WHERE page_id=? AND kind='topics'").run(JSON.stringify({topics:['Gardening','Planting']}),page.id);
    assert.notEqual((await call(route+'/enrichment-status')).version,versionBefore.version,'Same-length same-timestamp external results change the version');
    const changesBefore=db.prepare('SELECT total_changes() AS n').get().n;
    for(let i=0;i<3;i++){await call(route+'/enrichments');await call(route+'/enrichment-status');}
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n,changesBefore,'Public payload and status reads never write');

    assert.equal((await generated()).length, 2, 'Future enrichment kinds coexist with summaries');
    assert.throws(() => enrichments.save('default', page.id, 'topics', {}, page.revision-1, ai.selection()), error => error.status === 409);
    assert.throws(() => enrichments.save(other.id, page.id, 'topics', {}, page.revision, ai.selection()), error => error.status === 404);
    await call(route+'/summary', 'DELETE', undefined, 404, other.id);
    await call('vaults/default/lock', 'POST', {passphrase:'lock-test'});
    await call(route+'/summary', 'DELETE', undefined, 423);
    await call('vaults/default/unlock', 'POST', {passphrase:'lock-test'});
    assert.equal((await generated()).length, 2, 'Rejected deletion preserves the summary');
    const callsBeforeDelete = calls;
    const retained=(await call(route+'/enrichments')).filter(item=>!['summary','enrichment_state','summary_preferences'].includes(item.kind));
    await call(route+'/summary', 'DELETE');
    await call(route+'/summary', 'DELETE');
    const deletedRecords=await call(route+'/enrichments');
    assert.deepEqual(deletedRecords.filter(item=>!['summary','enrichment_state','summary_preferences'].includes(item.kind)),retained);
    assert.equal(deletedRecords.find(item=>item.kind==='summary_preferences'),undefined);
    assert.equal(calls, callsBeforeDelete, 'Deletion does not call the AI provider');
    assert.equal((await call(route)).revision, page.revision, 'Deleting a summary does not change the note');
    await stop(); await start();
    assert.deepEqual((await generated()).map(item=>item.kind), ['topics'], 'Deletion persists and preserves other enrichments');
    await call(route+'/summary', 'POST', {revision:page.revision});
    await call(route, 'DELETE'); await call(route+'/enrichments', 'GET', undefined, 404);
    await call('trash/'+page.id+'/restore', 'POST', {});
    assert.equal((await generated()).length, 2);
    await call(route, 'DELETE'); await call('trash/'+page.id, 'DELETE');
    assert.equal(db.prepare('SELECT count(*) AS count FROM page_ai_enrichments WHERE page_id=?').get(page.id).count, 0);
  } finally { await stop(); rmSync(dir, {recursive:true,force:true}); }
});
