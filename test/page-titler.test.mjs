import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PageTitler } from '../src/client/state/page-titler.ts';
const page = (title='Untitled', text='A detailed plan for the community garden') => ({id:'new',vault_id:'default',title,revision:2,blocks:[{id:'a',type:'paragraph',content:[{text}]}],sourceIds:[]});
const settle = async () => { for(let i=0;i<5;i++) await Promise.resolve(); };
test('observes saved substantial pages after ten idle seconds', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=[],applied=[];
  const titler=new PageTitler(async p=>{calls.push(p);return {title:'Community garden',revision:p.revision};},(p,title)=>applied.push(title));
  try {
    titler.observe(page(),true);t.mock.timers.tick(4000);assert.equal(calls.length,0);
    titler.register(page());titler.observe(page(),true);
    t.mock.timers.tick(9999);assert.equal(calls.length,0);
    titler.observe({...page(),revision:3});t.mock.timers.tick(4000);assert.equal(calls.length,0);
    titler.observe({...page(),revision:3},true);t.mock.timers.tick(10000);await settle();
    assert.equal(calls.length,1);assert.equal(calls[0].revision,3);assert.deepEqual(applied,['Community garden']);
    titler.observe(page(),true);t.mock.timers.tick(4000);assert.equal(calls.length,1);
  } finally {titler.dispose();}
});
test('empty drafts do not poll before the idle delay', async t => {
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const titler=new PageTitler(async()=>{calls++;return {title:'Title',revision:2};},()=>assert.fail('Unexpected title'));
  try {
    for(const p of [page('Untitled',''),page('','tiny'),page('My title')]) {
      titler.register(p);titler.observe(p,true);t.mock.timers.tick(4000);await settle();
    }
    assert.equal(calls,0);
  } finally {titler.dispose();}
});
test('late results are discarded after edits, manual naming, deletion or vault changes', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for(const cancel of [titler=>titler.observe({...page(),revision:3}),titler=>titler.observe(page('Manual title')),titler=>titler.remove(page()),titler=>titler.dispose()]) {
    let finish;const applied=[];
    const titler=new PageTitler(()=>new Promise(resolve=>{finish=resolve;}),(p,title)=>applied.push(title));
    titler.register(page());titler.observe(page(),true);t.mock.timers.tick(10000);
    cancel(titler);finish({title:'Late title',revision:2});await settle();assert.deepEqual(applied,[]);titler.dispose();
  }
});
test('background failures are quiet and can retry on a later saved edit', async t => {
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const titler=new PageTitler(async p=>{if(++calls===1)throw Error('No key');return {title:'Garden plan',revision:p.revision};},()=>{});
  try {
    titler.register(page());titler.observe(page(),true);t.mock.timers.tick(10000);await settle();
    t.mock.timers.tick(60000);assert.equal(calls,1);
    titler.observe({...page(),revision:3},true);t.mock.timers.tick(10000);await settle();assert.equal(calls,2);
  } finally {titler.dispose();}
});

test('registering an opened page again preserves its in-flight title', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let finish; const applied=[];
  const titler=new PageTitler(()=>new Promise(resolve=>{finish=resolve;}),(_page,title)=>applied.push(title));
  try {
    titler.register(page());titler.observe(page(),true);t.mock.timers.tick(10000);
    titler.register(page());finish({title:'Resumed title',revision:2});await settle();
    assert.deepEqual(applied,['Resumed title']);
  } finally {titler.dispose();}
});

test('reads persisted results while the server job is pending', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0;const applied=[];
  const titler=new PageTitler(async p=>({title:++calls===1?'Untitled':'Garden plan',revision:p.revision,enrichmentPending:calls===1}),(_page,title)=>applied.push(title));
  try {
    titler.observe(page(),true);t.mock.timers.tick(10000);await settle();
    assert.equal(calls,1);assert.deepEqual(applied,['Untitled']);
    t.mock.timers.tick(5000);await settle();
    assert.equal(calls,2);assert.deepEqual(applied,['Untitled','Garden plan']);
    t.mock.timers.tick(120000);await settle();assert.equal(calls,2);
  }finally{titler.dispose();}
});

test('read failures do not start an independent enrichment retry loop',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  for(const status of [429,502,503]) {
    let calls=0;
    const titler=new PageTitler(async()=>{calls++;throw Object.assign(new Error('Unavailable'),{status});},()=>assert.fail());
    try {
      titler.observe(page(),true);t.mock.timers.tick(10000);await settle();
      for(const delay of [15000,60000,240000]){t.mock.timers.tick(delay);await settle();}
      assert.equal(calls,1);
    }finally{titler.dispose();}
  }
});

test('editing or leaving the vault prevents more reads after failure', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for(const cancel of [titler=>titler.observe({...page(),revision:3}),titler=>titler.dispose()]) {
    let calls=0;
    const titler=new PageTitler(async()=>{calls++;throw Object.assign(new Error('Unavailable'),{status:503});},()=>assert.fail());
    titler.register(page());titler.observe(page(),true);t.mock.timers.tick(10000);await settle();
    cancel(titler);t.mock.timers.tick(120000);await settle();assert.equal(calls,1);titler.dispose();
  }
});

test('automatic entity references retain eligibility for automatic page titles', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const tagged={...page(),blocks:[{id:'p',type:'paragraph',content:[{entityId:'ada'},{text:' and '},{entityId:'ursula'}]}]};
  const names={ada:'Ada Lovelace',ursula:'Ursula K. Le Guin'};
  const applied=[];
  const titler=new PageTitler(async p=>({title:'Connected thinkers',revision:p.revision}),(_page,title)=>applied.push(title),id=>names[id]||'');
  try {
    titler.register(tagged);titler.observe(tagged,true);t.mock.timers.tick(10000);await settle();
    assert.deepEqual(applied,['Connected thinkers']);
  }finally{titler.dispose();}
});

test('stable server-assessed subjects do not schedule for a changed content hash',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {TAXONOMY_VERSION}=await import('../src/shared/domains.ts');
  let calls=0;
  const titler=new PageTitler(async()=>{calls++;throw Error('Unexpected request');},()=>{});
  const stable={...page('Algebra'),conceptContentHash:'new-body',pageDomains:{primaryDomainId:'mathematics',secondaryDomainIds:[],origin:'inferred',status:'inferred',contentHash:'classified-body',taxonomyVersion:TAXONOMY_VERSION,revision:1}};
  try {
    titler.observe(stable,true);t.mock.timers.tick(60000);await settle();assert.equal(calls,0);
  }finally{titler.dispose();}
});
