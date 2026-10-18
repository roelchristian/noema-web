import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '../src/client/state/workspace.ts';
import {api} from '../src/client/api.ts';
import {TAXONOMY_VERSION} from '../src/shared/domains.ts';
const organization={collections:[],folders:[],locations:[],memberships:[],favourites:[]};
test('manual subjects flush drafts and cannot reschedule classification during a slow write',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const domains={primaryDomainId:'mathematics',secondaryDomainIds:[],origin:'inferred',status:'inferred',contentHash:'initial',taxonomyVersion:TAXONOMY_VERSION,revision:1};
  const page={id:'p',vault_id:'v',title:'Algebra',blocks:[{id:'b',type:'paragraph',checked:false,content:[{text:'A field has multiplicative inverses.'}]}],sourceIds:[],revision:1,updated_at:'',conceptContentHash:'initial',pageDomains:domains};
  t.mock.method(api,'vaults',async()=>[{id:'v',name:'Vault',locked:false}]);
  t.mock.method(api,'pages',async()=>[page]);t.mock.method(api,'entities',async()=>[]);t.mock.method(api,'organization',async()=>organization);t.mock.method(api,'page',async()=>page);
  const events=[];let saved,finish;
  t.mock.method(api,'savePage',async(_v,_id,draft)=>{events.push('save');saved={...draft,revision:2,conceptContentHash:'changed'};return saved;});
  t.mock.method(api,'setPageDomains',async(v,id,revision,primaryDomainId,secondaryDomainIds)=>{
    events.push('domains');assert.equal(revision,2);assert.equal(v,'v');assert.equal(id,'p');
    return new Promise(resolve=>{finish=()=>resolve({...saved,revision:3,pageDomains:{...domains,primaryDomainId,secondaryDomainIds,origin:'manual',status:'manual',revision:2},entityMatchCache:undefined});});
  });
  t.mock.method(api,'generateTitle',async()=>assert.fail('Domain edit scheduled classification'));
  const workspace=new Workspace();
  try {
    await workspace.selectVault('v');await workspace.openPage('p');
    workspace.updatePage({blocks:[{...page.blocks[0],content:[{text:'An updated algebra note on multiplicative inverses.'}]}]});
    const pending=workspace.setPageDomains('psychology',['philosophy']);
    for(let i=0;i<30&&!finish;i++)await Promise.resolve();
    assert.deepEqual(events,['save','domains']);assert.equal(workspace.snapshot().domainSavingPageId,'p');
    t.mock.timers.tick(4000);for(let i=0;i<5;i++)await Promise.resolve();
    finish();await pending;t.mock.timers.tick(4000);for(let i=0;i<5;i++)await Promise.resolve();
    assert.equal(api.generateTitle.mock.callCount(),0);
    assert.equal(workspace.snapshot().page.revision,3);assert.equal(workspace.snapshot().page.pageDomains.primaryDomainId,'psychology');assert.equal(workspace.snapshot().domainSavingPageId,null);
    assert.equal(workspace.snapshot().page.blocks[0].content[0].text,'An updated algebra note on multiplicative inverses.');
  }finally{workspace.saver.dispose();workspace.titler.dispose();}
});
