import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PageTitler } from '../src/client/state/page-titler.ts';
const page = (title='Untitled', text='A detailed plan for the community garden') => ({id:'new',vault_id:'default',title,revision:2,blocks:[{id:'a',type:'paragraph',content:[{text}]}],sourceIds:[]});
const settle = async () => { for(let i=0;i<5;i++) await Promise.resolve(); };
test('observes saved substantial pages after two seconds without triggering generation', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=[],applied=[];
  const titler=new PageTitler(async p=>{calls.push(p);return {title:'Community garden',revision:p.revision};},(p,title)=>applied.push(title));
  try {
    titler.observe(page(),true);t.mock.timers.tick(1000);assert.equal(calls.length,0);
    titler.register(page());titler.observe(page(),true);
    t.mock.timers.tick(1999);assert.equal(calls.length,0);
    titler.observe({...page(),revision:3});t.mock.timers.tick(1000);assert.equal(calls.length,0);
    titler.observe({...page(),revision:3},true);t.mock.timers.tick(2000);await settle();
    assert.equal(calls.length,1);assert.equal(calls[0].revision,3);assert.deepEqual(applied,['Community garden']);
    titler.observe(page(),true);t.mock.timers.tick(1000);assert.equal(calls.length,1);
  } finally {titler.dispose();}
});
test('late results are discarded after edits, manual naming, deletion or vault changes', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for(const cancel of [titler=>titler.observe({...page(),revision:3}),titler=>titler.observe(page('Manual title')),titler=>titler.remove(page()),titler=>titler.dispose()]) {
    let finish;const applied=[];
    const titler=new PageTitler(()=>new Promise(resolve=>{finish=resolve;}),(p,title)=>applied.push(title));
    titler.register(page());titler.observe(page(),true);t.mock.timers.tick(2000);
    cancel(titler);finish({title:'Late title',revision:2});await settle();assert.deepEqual(applied,[]);titler.dispose();
  }
});
test('background failures are quiet and can retry on a later saved edit', async t => {
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const titler=new PageTitler(async p=>{if(++calls===1)throw Error('No key');return {title:'Garden plan',revision:p.revision};},()=>{});
  try {
    titler.register(page());titler.observe(page(),true);t.mock.timers.tick(2000);await settle();
    t.mock.timers.tick(60000);assert.equal(calls,1);
    titler.observe({...page(),revision:3},true);t.mock.timers.tick(2000);await settle();assert.equal(calls,2);
  } finally {titler.dispose();}
});

test('registering an opened page again preserves its in-flight title', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let finish; const applied=[];
  const titler=new PageTitler(()=>new Promise(resolve=>{finish=resolve;}),(_page,title)=>applied.push(title));
  try {
    titler.register(page());titler.observe(page(),true);t.mock.timers.tick(2000);
    titler.register(page());finish({title:'Resumed title',revision:2});await settle();
    assert.deepEqual(applied,['Resumed title']);
  } finally {titler.dispose();}
});

test('read failures do not start an independent enrichment retry loop',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  for(const status of [429,502,503]) {
    let calls=0;
    const titler=new PageTitler(async()=>{calls++;throw Object.assign(new Error('Unavailable'),{status});},()=>assert.fail());
    try {
      titler.observe(page(),true);t.mock.timers.tick(2000);await settle();
      for(const delay of [15000,60000,240000]){t.mock.timers.tick(delay);await settle();}
      assert.equal(calls,1);
    }finally{titler.dispose();}
  }
});

test('automatic entity references retain eligibility for automatic page titles', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const tagged={...page(),blocks:[{id:'p',type:'paragraph',content:[{entityId:'ada'},{text:' and '},{entityId:'ursula'}]}]};
  const names={ada:'Ada Lovelace',ursula:'Ursula K. Le Guin'};
  const applied=[];
  const titler=new PageTitler(async p=>({title:'Connected thinkers',revision:p.revision}),(_page,title)=>applied.push(title),id=>names[id]||'');
  try {
    titler.register(tagged);titler.observe(tagged,true);t.mock.timers.tick(2000);await settle();
    assert.deepEqual(applied,['Connected thinkers']);
  }finally{titler.dispose();}
});

test('stable subjects still check queued summary work once without starting generation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {TAXONOMY_VERSION}=await import('../src/shared/domains.ts');
  let calls=0;
  const titler=new PageTitler(async p=>{calls++;return {...p,enrichmentPending:false};},()=>{});
  const stable={...page('Algebra'),conceptContentHash:'new-body',pageDomains:{primaryDomainId:'mathematics',secondaryDomainIds:[],origin:'inferred',status:'inferred',contentHash:'classified-body',taxonomyVersion:TAXONOMY_VERSION,revision:1}};
  try {
    titler.observe(stable,true);t.mock.timers.tick(2000);await settle();assert.equal(calls,1);t.mock.timers.tick(60000);await settle();assert.equal(calls,1);
  }finally{titler.dispose();}
});
test('pending title and domain metadata are observed at two-second boundaries and stop after completion',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const cases=[
  {label:'untitled page',page:page(),pending:{title:'Untitled'},complete:{title:'Garden plan'},expected:['Untitled','Garden plan']},
  {label:'named page domains',page:{...page('Algebra'),pageDomains:{origin:'inferred',status:'needs_refresh',revision:1}},pending:{pageDomains:{origin:'inferred',status:'needs_refresh',revision:1}},complete:{title:'Unsolicited rename',pageDomains:{origin:'inferred',status:'inferred',revision:1}},expected:['needs_refresh','inferred']},
 ];
 for(const scenario of cases){
  const applied=[];let reads=0;
  const titler=new PageTitler(async p=>({...p,...(++reads===1?scenario.pending:scenario.complete),enrichmentPending:reads===1}),(_page,title,domains)=>{applied.push(domains?.status??title);if(scenario.page.title==='Algebra')assert.equal(title,'Algebra','Background metadata cannot rename an authored title');});
  try{
   titler.observe(scenario.page,true);t.mock.timers.tick(1999);await settle();assert.equal(reads,0,scenario.label);
   t.mock.timers.tick(1);await settle();assert.deepEqual(applied,[scenario.expected[0]],scenario.label);
   t.mock.timers.tick(1999);await settle();assert.equal(reads,1,scenario.label);
   t.mock.timers.tick(1);await settle();assert.deepEqual(applied,scenario.expected,scenario.label);
   t.mock.timers.tick(120000);await settle();assert.equal(reads,2,scenario.label+' completes without an independent polling loop');
  }finally{titler.dispose();}
 }
});
