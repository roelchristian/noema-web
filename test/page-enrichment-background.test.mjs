import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/http.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';

test('legacy background requests observe queue state without dispatching or resetting retries',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'noema-background-'));
  const db=openDatabase(path.join(directory,'test.sqlite')),store=new Store(db);
  const ai=new Intelligence({read:()=>null,write(){},remove(){}});
  let calls=0;
  ai.generatePageEnrichment=async()=>{calls++;return {summary:'A summary persisted by an explicit request.'};};
  const server=createApp(store,path.resolve('dist/client'),ai);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/`;
  async function call(route,method='GET',body,expected=200){
    const response=await fetch(base+route,{method,headers:{'X-Noema-Request':'1','Content-Type':'application/json','X-Vault-Id':'default'},body:body===undefined?undefined:JSON.stringify(body)});
    const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;
  }
  try {
    let page=await call('pages','POST',{title:'Untitled'},201);
    page=await call(`pages/${page.id}`,'PUT',{...page,blocks:[{id:'body',type:'paragraph',content:[{text:'A substantial page about mathematical proofs and polynomial equations.'}]}]});
    const route=`pages/${page.id}`;
    // A retrying server generation is the sole owner of this saved snapshot's budget.
    store.run('UPDATE page_enrichment_jobs SET attempts=2,due_at=? WHERE page_id=?',Date.now()+3_600_000,page.id);
    const queued=store.get('SELECT * FROM page_enrichment_jobs WHERE page_id=?',page.id);
    for(let session=0;session<3;session++)for(const endpoint of ['title','enrich','summary']){
      const result=await call(`${route}/${endpoint}`,'POST',{revision:page.revision,background:true});
      assert.equal(result.title,'Untitled');assert.equal(result.enrichmentPending,true);
    }
    await call(route);
    for(let refresh=0;refresh<3;refresh++) {
      const metadata=await call(`${route}/metadata`);
      assert.equal(metadata.title,'Untitled');assert.equal(metadata.revision,page.revision);assert.equal(metadata.enrichmentPending,true);
      assert.equal(metadata.blocks,undefined);assert.equal(metadata.entityMatchCache,undefined);
    }
    assert.equal(calls,0);
    assert.deepEqual(store.get('SELECT * FROM page_enrichment_jobs WHERE page_id=?',page.id),queued);
    assert.equal(store.get('SELECT count(*) AS n FROM ai_activity').n,0);
    // Once the budget is exhausted, stale clients cannot recreate a queue generation.
    store.run('DELETE FROM page_enrichment_jobs WHERE page_id=?',page.id);
    assert.equal((await call(`${route}/title`,'POST',{revision:page.revision,background:true})).enrichmentPending,false);
    assert.equal(store.get('SELECT * FROM page_enrichment_jobs WHERE page_id=?',page.id),undefined);
    assert.equal(calls,0);
    await call(`${route}/title`,'POST',{revision:page.revision-1,background:true},409);
    const explicit=await call(`${route}/enrich`,'POST',{revision:page.revision,requestedFields:['summary']});
    assert.equal(calls,1);assert.equal(explicit.summary,'A summary persisted by an explicit request.');
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    db.close();rmSync(directory,{recursive:true,force:true});
  }
});
