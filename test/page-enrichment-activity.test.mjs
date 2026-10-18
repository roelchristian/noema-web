import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
import {notificationMessage,runningMessage} from '../src/shared/ai-notifications.ts';

test('unified enrichment has running, failure and completion notification labels',()=>{
  assert.equal(runningMessage({action:'page_enrichment',pageTitle:'Algebra'}),'Enriching page: Algebra');
  assert.equal(notificationMessage({action:'page_enrichment',status:'failed',pageTitle:'Algebra'}),'Page enrichment failed for Algebra');
  assert.equal(notificationMessage({action:'page_enrichment',status:'interrupted',pageTitle:'Algebra'}),'Page enrichment interrupted for Algebra');
  assert.equal(notificationMessage({action:'page_enrichment',status:'completed',pageTitle:'Algebra'}),'Page enriched: Algebra');
});

test('enrichment usage records cached and reasoning tokens with versioned optional estimates',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-enrichment-usage-'));
  const db=openDatabase(path.join(dir,'vault.sqlite'));
  try{
    const log=new AIActivityLog(new Store(db));
    log.savePricing({version:'test-rates-v1',currency:'USD',models:{'test-model':{inputPerMillion:2,cachedInputPerMillion:1,outputPerMillion:4}}});
    const id=log.start('page_enrichment',{model:'test-model',reasoningEffort:'none'},'default');
    const observer=log.request(id,100,1);
    observer.usage({input_tokens:1000,input_tokens_details:{cached_tokens:400},output_tokens:200,output_tokens_details:{reasoning_tokens:50}});
    log.finish(id,'completed',200);
    const item=log.list(null).items.find(item=>item.id===id);
    assert.equal(item.reasoningTokens,50);
    assert.equal(item.cachedInputTokens,400);
    assert.equal(item.pricingVersion,'test-rates-v1');
    assert.equal(item.estimatedCost,0.0024);
    assert.equal(log.enrichmentMetrics('default').providerRequests,1);
    assert.equal(log.enrichmentMetrics('another-vault').providerRequests,0);
    assert.throws(()=>log.savePricing({version:'invalid',currency:'USD',models:{model:{inputPerMillion:-1,outputPerMillion:0}}}),error=>error.status===400);
    db.prepare('UPDATE vaults SET locked=1 WHERE id=?').run('default');
    assert.equal(log.enrichmentMetrics().providerRequests,0);
    assert.equal(log.list(null).items.length,0);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('unconfigured costs remain unknown rather than implying zero spend',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-unpriced-usage-'));
  const db=openDatabase(path.join(dir,'vault.sqlite'));
  try{
    const log=new AIActivityLog(new Store(db));
    const id=log.start('page_enrichment',{model:'unpriced-model',reasoningEffort:'none'},'default');
    log.request(id,100,1).usage({input_tokens:100,output_tokens:25});
    log.finish(id,'completed',200);
    assert.equal(log.list(null).items[0].estimatedCost,null);
    assert.equal(log.enrichmentMetrics().estimatedCost,null);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
