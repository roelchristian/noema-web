// Synthetic in-memory fixture; no real vault, credentials, or provider calls.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {createApp} from '../src/server/http.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
const require=createRequire(import.meta.url);
const playwright=await import(process.env.PLAYWRIGHT_MODULE??require.resolve('playwright'));
const {chromium}=playwright.default??playwright;
const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
store.run('DELETE FROM pages');
for(let i=0;i<6;i++){
  const page=pages.create('default',{title:`Library note ${i}`});
  pages.update('default',page.id,{...page,blocks:[{id:'body-'+i,type:i===1?'table':'paragraph',checked:false,content:i===1?[]:[{text:i===0?'Needle evidence in opening text.':'Synthetic opening text for library inspection.'}],...(i===1?{rows:[[[{text:'Synthetic opening text for library inspection.'}]]]}:{})}]});
}
store.run("UPDATE pages SET ai_status='ai_generated',ai_review_accepted=1 WHERE title='Library note 5'");
const ai=new Intelligence({read:()=>null,write(){},remove(){}},async()=>{throw new Error('Provider calls forbidden in library browser fixture');});
const server=createApp(store,resolve('dist/client'),ai);
let browser;
const artifacts=process.env.NOEMA_SCREENSHOTS??'/tmp/noema-library-evidence';await mkdir(artifacts,{recursive:true});
try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
  const timeout=Number(process.env.NOEMA_BROWSER_TIMEOUT_MS??30000);if(!Number.isSafeInteger(timeout)||timeout<1000||timeout>120000)throw new Error('NOEMA_BROWSER_TIMEOUT_MS must be between 1000 and 120000');page.setDefaultTimeout(timeout);
  const errors=[],snippetRequests=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().endsWith('/search/snippets'))snippetRequests.push(JSON.parse(request.postData()).pageIds.length);});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const root=page.locator('.organization-browser:not(.knowledge-library)');
  const choose=async(name,option)=>{
    const secondary=name!=='Sort library',options=root.getByRole('button',{name:'View options',exact:true});
    if(secondary)await options.click();
    await page.getByRole('combobox',{name,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();
    if(secondary)await options.click();
  };
  const setDensity=async name=>{const options=root.getByRole('button',{name:'View options',exact:true});await options.click();await root.getByRole('button',{name,exact:true}).click();await options.click();};
  await page.goto(base+'/?vault=default&view=organization');await root.locator('[data-library-row="page:'+pages.list('default')[0].id+'"]').waitFor();
  await choose('Sort library','Name · A–Z');
  const identities=await root.locator('article[data-library-row]').evaluateAll(rows=>rows.map(row=>row.dataset.libraryRow));
  const checks=root.getByRole('checkbox',{name:/^Select Library note/});
  await checks.nth(0).check();await checks.nth(2).click({modifiers:['Shift']});
  assert.equal(await checks.evaluateAll(inputs=>inputs.filter(input=>input.checked).length),3);
  for(const mode of ['Grid','Compact','List','Compact','Grid','List']){
    await root.getByRole('button',{name:mode+' view',exact:true}).click();
    assert.deepEqual(await root.locator('article[data-library-row]').evaluateAll(rows=>rows.map(row=>row.dataset.libraryRow)),identities);
    assert.equal(await checks.evaluateAll(inputs=>inputs.filter(input=>input.checked).length),3);
  }
  await root.getByRole('button',{name:'Clear',exact:true}).click();
  await root.getByRole('button',{name:'Actions for Library note 0',exact:true}).click();
  await page.getByRole('menuitem',{name:'Quick preview',exact:true}).click();await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
  // Closing the preview restores the Actions trigger on the next animation frame.
  // Wait for that contract before starting a separate row-navigation interaction.
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Actions for Library note 0');
  const primary=root.locator('[data-library-focus]').first();await primary.focus();await page.keyboard.press('ArrowDown');
  assert.equal(await root.locator('[data-library-focus]').nth(1).evaluate(element=>element===document.activeElement),true);
  const focused=await page.evaluate(()=>document.activeElement.closest('[data-library-row]').dataset.libraryRow);
  const scroll=await page.evaluate(()=>scrollY);await page.keyboard.press('Space');await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByText('Synthetic opening text for library inspection.').waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Next',exact:true}).click();
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
  await page.waitForFunction(row=>document.activeElement.closest('[data-library-row]')?.dataset.libraryRow===row,focused);
  assert.equal(await page.evaluate(()=>document.activeElement.closest('[data-library-row]')?.dataset.libraryRow),focused);
  assert.equal(await page.evaluate(()=>scrollY),scroll);
  // Closing/navigating while local preview reads are pending must discard late content.
  for(let repeat=0;repeat<2;repeat++){
    let release;const pending=new Promise(resolve=>release=resolve);
    await page.route('**/api/pages/*/preview',async route=>{await pending;await route.continue().catch(()=>{});});
    await primary.focus();await page.keyboard.press('Space');await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Next',exact:true}).click();
    await page.keyboard.press('Escape');release();await page.unroute('**/api/pages/*/preview');
    await page.waitForTimeout(100);assert.equal(await page.getByRole('dialog').count(),0);
  }
  const search=root.getByRole('searchbox');await search.fill('Needle');await root.locator('.search-match-badge').waitFor();
  await setDensity('Compact spacing');
  assert.equal(await root.locator('.search-match-badge').first().isVisible(),true);
  // Explicitly enabling related matching after a row interaction restarts retrieval.
  const related=pages.list('default').find(note=>note.title==='Library note 5');let semanticRequests=0;
  await page.route('**/api/embeddings/search',route=>{semanticRequests++;return route.fulfill({json:{model:'synthetic',results:[{kind:'page',id:related.id,title:related.title,snippet:'Related synthetic evidence',score:0.9,updated_at:related.updated_at}]}});});
  await root.locator('[data-library-focus]').first().hover();
  await choose('Search matching','Text + related in this scope');
  await root.getByText('Related by meaning',{exact:true}).waitFor();assert.ok(semanticRequests>0);
  const reason=root.getByText('Related by meaning',{exact:true});
  assert.equal(await reason.evaluate(element=>{const box=element.getBoundingClientRect(),parent=element.parentElement.getBoundingClientRect();return box.left>=parent.left&&box.right<=parent.right+1;}),true);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await root.locator('.search-match-badge').first().isVisible(),true);
  await page.screenshot({path:join(artifacts,'compact-mobile.png')});
  await search.focus();await page.keyboard.press('Space');assert.equal(await page.getByRole('dialog').count(),0);
  await choose('Search matching','Text in this scope');
  assert.equal(await root.getByText('Related by meaning',{exact:true}).count(),0);
  await search.fill('');await checks.nth(0).check();await search.fill('no-visible-items');
  assert.equal(await root.locator('.organization-bulk-actions').count(),0);
  await search.fill('');assert.equal(await checks.evaluateAll(inputs=>inputs.filter(input=>input.checked).length),0);
  await page.setViewportSize({width:1440,height:1000});
  await setDensity('Regular spacing');
  assert.equal(await root.getAttribute('data-layout'),'list');
  assert.equal(await root.getAttribute('data-density'),'standard');
  assert.equal(await root.getByRole('button',{name:'Grid view',exact:true}).count(),0);
  assert.equal(await root.locator('.organization-card-cover').count(),0);
  await page.screenshot({path:join(artifacts,'list-desktop.png')});
  await page.evaluate(()=>document.documentElement.dataset.mode='dark');await page.screenshot({path:join(artifacts,'list-dark.png')});
  // Changing list density must not fetch excerpts for an unfiltered large library.
  store.transaction(()=>{for(let i=6;i<2500;i++)store.run("INSERT INTO pages (id,title,blocks,updated_at,created_at,vault_id) VALUES (?,?,?,?,?,'default')",'synthetic-'+i,`Library note ${String(i).padStart(4,'0')}`,JSON.stringify([{id:'b-'+i,type:'paragraph',checked:false,content:[{text:'Synthetic large-library excerpt.'}]}]),'2026-10-24T12:00:00Z','2026-10-24T12:00:00Z');});
  await page.reload();await root.locator('article[data-library-row]').nth(2499).waitFor({state:'attached'});
  snippetRequests.length=0;const started=Date.now();await setDensity('Compact spacing');
  await page.waitForTimeout(1800);
  const metrics={items:2500,settleMs:Date.now()-started,initialSnippetRequests:snippetRequests.length,initialSnippetIds:snippetRequests.reduce((a,b)=>a+b,0),largestBatch:Math.max(0,...snippetRequests)};
  if(process.env.LIBRARY_EXPECT_BOUNDED){assert.ok(metrics.initialSnippetIds<=60,JSON.stringify(metrics));assert.ok(metrics.largestBatch<=60);}
  await page.screenshot({path:join(artifacts,'large-compact.png')});
  await page.evaluate(()=>window.dispatchEvent(new WheelEvent('wheel')));
  await root.locator('article[data-library-row]').nth(2300).scrollIntoViewIfNeeded();
  assert.equal(snippetRequests.length,0);
  assert.ok(await page.evaluate(()=>scrollY)>10000);
  assert.ok(snippetRequests.every(count=>count<=60));
  metrics.afterScrollSnippetIds=snippetRequests.reduce((a,b)=>a+b,0);
  if(process.env.LIBRARY_EXPECT_BOUNDED)assert.ok(metrics.afterScrollSnippetIds<=120,JSON.stringify(metrics));
  const returnControl=root.locator('article[data-library-row]').nth(2300).locator('[data-library-focus]');
  await returnControl.focus();const returnRow=await returnControl.evaluate(element=>element.closest('[data-library-row]').dataset.libraryRow),returnScroll=await page.evaluate(()=>scrollY);
  await page.keyboard.press('Enter');await page.locator('#page-title').waitFor();
  await page.getByRole('button',{name:'Pages',exact:true}).first().click();
  await page.waitForFunction(row=>document.activeElement.closest('[data-library-row]')?.dataset.libraryRow===row,returnRow);
  assert.ok(Math.abs(await page.evaluate(()=>scrollY)-returnScroll)<8);

  await writeFile(join(artifacts,'metrics.json'),JSON.stringify(metrics,null,2));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:'layout identity, range selection, keyboard isolation, preview/focus/scroll, match reason, mobile, themes, list density',metrics,artifacts}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
