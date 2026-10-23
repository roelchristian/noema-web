// Saved synthetic embeddings and explicit fake description/rule providers only.
// Browser traffic is restricted to the local fixture. No screenshots are taken.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Organizer} from '../src/server/modules/organization.ts';
import {PageSegments} from '../src/server/modules/page-segments.ts';
import {PageSegmentIndex} from '../src/server/modules/page-segment-index.ts';
import {embeddingDimensions} from '../src/shared/embeddings.ts';
import {createApp} from '../src/server/http.ts';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-semantic-browser-'));
const vector=axis=>Array.from({length:embeddingDimensions},(_,index)=>index===axis?1:0);
let db,server,vite,browser;const errors=[];let descriptionCalls=0,ruleGenerationCalls=0;
try {
  db=openDatabase(join(directory,'fixture.sqlite'));
  const store=new Store(db),pages=new Pages(store,new Knowledge(store)),organizer=new Organizer(store);
  store.run('DELETE FROM pages');
  store.run("INSERT INTO embedding_settings(vault_id,automatic,min_characters) VALUES('default',0,20) ON CONFLICT(vault_id) DO UPDATE SET automatic=0");
  const makePage=(title,text)=>{const page=pages.create('default',{title});return pages.update('default',page.id,{title,revision:page.revision,blocks:[{id:title,type:'paragraph',checked:false,content:[{text}]}]});};
  const alpha=makePage('Substantial algebra','This synthetic document discusses mathematical structures, groups, rings, fields and algebraic proofs throughout.');
  const beta=makePage('Unrelated history','This synthetic document discusses historical chronology, archival methods and historical interpretations throughout.');
  const second=makePage('Second algebra example','This synthetic document is a second representative note about groups, rings, fields and algebraic proofs.');
  const gap=makePage('Not indexed yet','This synthetic document has no saved semantic embedding. Its membership must remain unknown until indexed.');
  new PageSegments(store).synchronize('default');
  const index=new PageSegmentIndex(store);
  for(const segment of store.all('SELECT * FROM page_segments WHERE vault_id=?','default'))if(segment.page_id!==gap.id)index.save(segment,vector(segment.page_id===alpha.id?0:1),25);
  index.close();
  const folder=organizer.saveFolder('default',{name:'Physical folder'}).folders[0].id;
  organizer.locate('default',{kind:'page',item_id:alpha.id,folder_id:folder});
  const selection=()=>({model:'synthetic-disabled',reasoningEffort:'none'});
  const ai={selection,enrichmentSelection:selection,personaSelection:()=>({id:'oxford_don',version:1,origin:'builtin'}),status:()=>({configured:true}),embed:async()=>{descriptionCalls++;return {embedding:vector(0),tokens:8};},embedBatch:async()=>{throw Error('Document embedding calls are forbidden in this fixture');},generate:async request=>{if(request.kind!=='collectionRules')throw Error('Unrequested LLM work is forbidden in this fixture');ruleGenerationCalls++;return JSON.stringify({version:1,root:{op:'all',children:[{field:'title',operator:'contains',value:'Substantial'}]}});},purgeExpired(){}};
  server=createApp(store,join(repo,'dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
  vite=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:`http://127.0.0.1:${server.address().port}`,changeOrigin:false}}}});await vite.listen();
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
  page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
  // The rest exercises the same Collections dialog as manual and rule-based collections.
  await page.getByRole('button',{name:'New collection',exact:true}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('textbox',{name:'Name',exact:true}).fill('Semantic algebra');
  await dialog.getByRole('combobox',{name:'Collection type',exact:true}).click();
  await page.getByRole('option',{name:'Smart collection',exact:true}).click();
  await dialog.getByRole('combobox',{name:'Matching method',exact:true}).click();
  await page.getByRole('option',{name:'Semantic matching',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Description',exact:true}).fill('Synthetic algebra and mathematical structures');
  assert.equal(descriptionCalls,0,'Typing cannot embed the description');
  await dialog.getByRole('button',{name:'Evaluate description',exact:true}).click();
  await dialog.getByRole('listitem').filter({hasText:'Substantial algebra'}).waitFor();
  assert.equal(descriptionCalls,1);
  await dialog.getByRole('button',{name:'Save collection',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  await page.getByRole('button').filter({has:page.locator('strong',{hasText:'Semantic algebra'})}).first().click();
  await page.getByText('Substantial algebra',{exact:true}).first().waitFor();
  await page.getByText(/Indexing gaps · Some pages have not been evaluated/).waitFor();
  await page.getByText('Why is this here?',{exact:true}).click();
  await page.getByText(/Semantic support in 1 of 1 passages/).waitFor();
  await page.getByRole('button',{name:'Exclude from this collection',exact:true}).click();
  await page.getByRole('heading',{name:'This collection is empty',exact:true}).waitFor();
  await page.getByText('Explicit decisions (1)',{exact:true}).click();
  await page.getByRole('button',{name:'Use matching again',exact:true}).click();
  await page.getByText('Substantial algebra',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Re-evaluate',exact:true}).click();
  await page.getByText(/Indexing gaps · Some pages have not been evaluated/).waitFor();
  assert.equal(descriptionCalls,1,'Save, membership overrides and refresh reuse the prepared description vector');
  const beginCollection=async(name,method)=>{
    await page.getByRole('button',{name:'Pages',exact:true}).first().click();
    await page.getByRole('button',{name:'New collection',exact:true}).first().click();
    const dialog=page.getByRole('dialog');
    await dialog.getByRole('textbox',{name:'Name',exact:true}).fill(name);
    await dialog.getByRole('combobox',{name:'Collection type',exact:true}).click();
    await page.getByRole('option',{name:'Smart collection',exact:true}).click();
    if(method!=='Rules'){
      await dialog.getByRole('combobox',{name:'Matching method',exact:true}).click();
      await page.getByRole('option',{name:method,exact:true}).click();
    }
    return dialog;
  };
  const saveAndOpen=async(dialog,name)=>{
    await dialog.getByRole('button',{name:'Save collection',exact:true}).click();
    await dialog.waitFor({state:'detached'});
    await page.getByRole('button').filter({has:page.locator('strong',{hasText:name})}).first().click();
  };
  // Hybrid eligibility excludes the unrelated and unindexed pages before semantic scoring.
  const hybrid=await beginCollection('Hybrid algebra','Rules + semantic matching');
  await hybrid.getByRole('textbox',{name:'Condition value',exact:true}).fill('Substantial');
  await hybrid.getByRole('textbox',{name:'Description',exact:true}).fill('Synthetic algebra and mathematical structures');
  await hybrid.getByRole('button',{name:'Evaluate description',exact:true}).click();
  await hybrid.getByRole('listitem').filter({hasText:'Substantial algebra'}).waitFor();
  await saveAndOpen(hybrid,'Hybrid algebra');
  await page.getByText('Substantial algebra',{exact:true}).first().waitFor();
  await page.getByText('Why is this here?',{exact:true}).click();
  await page.getByText('Rule: Title contains Substantial',{exact:true}).waitFor();
  assert.equal(descriptionCalls,1,'Hybrid evaluation reuses an identical saved description');
  // Prepare a second coherent positive example locally; no embedding provider is involved.
  const updatedIndex=new PageSegmentIndex(store);
  for(const segment of store.all('SELECT * FROM page_segments WHERE page_id=?',second.id))updatedIndex.save(segment,vector(0),25);
  updatedIndex.close();
  const examples=await beginCollection('Example algebra','Example matching');
  await examples.getByRole('checkbox',{name:'Positive example: Substantial algebra',exact:true}).check();
  await examples.getByRole('checkbox',{name:'Positive example: Second algebra example',exact:true}).check();
  await examples.getByRole('checkbox',{name:'Negative example: Unrelated history',exact:true}).check();
  await examples.getByRole('button',{name:'Evaluate examples',exact:true}).click();
  await examples.getByRole('button',{name:'Save collection',exact:true}).waitFor();
  await saveAndOpen(examples,'Example algebra');
  await page.getByText('Substantial algebra',{exact:true}).first().waitFor();
  await page.getByText('Second algebra example',{exact:true}).first().waitFor();
  assert.equal(descriptionCalls,1,'Example matching uses only existing document vectors');
  // Generated rules stay editable and unsaved until an explicit confirmation action.
  const generated=await beginCollection('Generated algebra','Rules');
  await generated.getByText('Describe rules in natural language',{exact:true}).click();
  await generated.getByRole('textbox',{name:'Describe rule conditions',exact:true}).fill('Only pages whose title contains Substantial');
  assert.equal(ruleGenerationCalls,0,'Typing cannot generate rules');
  await generated.getByRole('button',{name:'Generate editable rules',exact:true}).click();
  const draft=generated.locator('.generated-rule-draft');
  await draft.getByRole('heading',{name:'Generated rule draft · Review before use',exact:true}).waitFor();
  assert.equal(await generated.getByRole('button',{name:'Save collection',exact:true}).isDisabled(),true);
  assert.equal(store.get('SELECT count(*) n FROM collections WHERE name=?','Generated algebra').n,0);
  await draft.getByRole('textbox',{name:'Condition value',exact:true}).fill('Second');
  await draft.getByRole('listitem').filter({hasText:'Second algebra example'}).waitFor();
  await draft.getByRole('button',{name:'Use these rules',exact:true}).click();
  await draft.waitFor({state:'detached'});
  await saveAndOpen(generated,'Generated algebra');
  await page.getByText('Second algebra example',{exact:true}).first().waitFor();
  assert.equal(ruleGenerationCalls,1,'Only explicit generation invokes the synthetic LLM');
  const savedRule=organizer.list('default').collections.find(item=>item.name==='Generated algebra').rule;
  assert.equal(savedRule.root.children[0].value,'Second','The saved AST contains the user edit, not the original provider output');
  assert.equal(organizer.list('default').locations.find(row=>row.item_id===alpha.id)?.folder_id,folder);
  assert.equal(await page.locator('nav').getByRole('button',{name:'Semantic collections',exact:true}).count(),0);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,synthetic:true,screenshots:false,descriptionCalls,ruleGenerationCalls,checks:['existing collection flow','explicit description evaluation','saved vectors','indexing gaps','semantic membership','hybrid eligibility and evidence','coherent positive and negative examples','editable generated AST','explicit rule confirmation','overrides','refresh reuse','physical location preservation','mobile overflow'],errors}));
  await context.close();
} finally {
  if(browser)await browser.close();if(vite)await vite.close();if(server)await new Promise(resolve=>server.close(resolve));if(db)db.close();await rm(directory,{recursive:true,force:true});
}
