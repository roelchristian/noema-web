import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {PageEnrichmentState} from '../src/server/modules/page-enrichment-state.ts';

test('pending fields reflect queued work without altering the queue and respect summary preferences',()=>{
  const db=openDatabase(':memory:'),store=new Store(db),pages=new Pages(store,new Knowledge(store));
  try {
    const page=pages.create('default',{title:'Note'});
    assert.deepEqual(page.enrichmentPendingFields,[]);
    store.run('INSERT INTO page_enrichment_jobs (page_id,vault_id,fields,due_at,updated_at) VALUES (?,?,?,?,?)',page.id,'default','["summary","domains"]',1000,1000);
    const queued=store.get('SELECT * FROM page_enrichment_jobs WHERE page_id=?',page.id);
    assert.deepEqual(pages.get('default',page.id).enrichmentPendingFields,['domains','summary']);
    assert.deepEqual(store.get('SELECT * FROM page_enrichment_jobs WHERE page_id=?',page.id),queued);
    store.run('UPDATE page_enrichment_jobs SET fields=? WHERE page_id=?','["domains"]',page.id);
    assert.deepEqual(pages.get('default',page.id).enrichmentPendingFields,['domains']);
    store.run('UPDATE page_enrichment_jobs SET fields=? WHERE page_id=?','["domains","summary"]',page.id);
    store.run('INSERT INTO page_enrichment_settings (vault_id,automatic_summaries) VALUES (?,0)','default');
    assert.deepEqual(pages.get('default',page.id).enrichmentPendingFields,['domains']);
    store.run('UPDATE page_enrichment_settings SET automatic_summaries=1 WHERE vault_id=?','default');
    new PageEnrichmentState(store).suppressSummary(page.id);
    assert.deepEqual(pages.get('default',page.id).enrichmentPendingFields,['domains']);
    store.run('DELETE FROM page_enrichment_jobs WHERE page_id=?',page.id);
    const done=pages.get('default',page.id);assert.equal(done.enrichmentPending,false);assert.deepEqual(done.enrichmentPendingFields,[]);
  }finally{db.close();}
});
