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
  pages.update('default',page.id,{...page,blocks:[{id:'body-'+i,type:'paragraph',checked:false,content:[{text:i===0?'Needle evidence in opening text.':'Synthetic opening text for library inspection.'}]}]});
}
const ai=new Intelligence({read:()=>null,write(){},remove(){}},async()=>{throw new Error('Provider calls forbidden in library browser fixture');});
const server=createApp(store,resolve('dist/client'),ai);
let browser;
const artifacts=process.env.NOEMA_SCREENSHOTS??'/tmp/noema-library-evidence';await mkdir(artifacts,{recursive:true});
try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
  const errors=[],snippetRequests=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().endsWith('/search/snippets'))snippetRequests.push(JSON.parse(request.postData()).pageIds.length);});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const root=page.locator('.organization-browser:not(.knowledge-library)');
  const choose=async(name,option)=>{await page.getByRole('combobox',{name,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();};
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
  const search=root.getByRole('searchbox');await search.fill('Needle');await root.locator('.search-match-badge').waitFor();
  await root.getByRole('button',{name:'Compact view',exact:true}).click();
  assert.equal(await root.locator('.search-match-badge').first().isVisible(),true);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await root.locator('.search-match-badge').first().isVisible(),true);
  await page.screenshot({path:join(artifacts,'compact-mobile.png')});
  await search.focus();await page.keyboard.press('Space');assert.equal(await page.getByRole('dialog').count(),0);
  await search.fill('');await page.setViewportSize({width:1440,height:1000});
  await root.getByRole('button',{name:'Grid view',exact:true}).click();
  assert.equal(await root.locator('.organization-card-cover').count(),0);
  await page.screenshot({path:join(artifacts,'grid-desktop.png')});
  await page.evaluate(()=>document.documentElement.dataset.mode='dark');await page.screenshot({path:join(artifacts,'grid-dark.png')});
  await root.getByRole('button',{name:'List view',exact:true}).click();
  await page.screenshot({path:join(artifacts,'list-desktop.png')});
  // Measure actual excerpt fan-out for a large library, without body/AI reads.
  store.transaction(()=>{for(let i=6;i<2500;i++)store.run("INSERT INTO pages (id,title,blocks,updated_at,created_at,vault_id) VALUES (?,?,?,?,?,'default')",'synthetic-'+i,`Library note ${String(i).padStart(4,'0')}`,JSON.stringify([{id:'b-'+i,type:'paragraph',checked:false,content:[{text:'Synthetic large-library excerpt.'}]}]),'2026-10-24T12:00:00Z','2026-10-24T12:00:00Z');});
  await page.reload();await root.locator('article[data-library-row]').nth(2499).waitFor({state:'attached'});
  snippetRequests.length=0;const started=Date.now();await root.getByRole('button',{name:'Grid view',exact:true}).click();
  await page.waitForTimeout(1800);
  const metrics={items:2500,settleMs:Date.now()-started,initialSnippetRequests:snippetRequests.length,initialSnippetIds:snippetRequests.reduce((a,b)=>a+b,0),largestBatch:Math.max(0,...snippetRequests)};
  if(process.env.LIBRARY_EXPECT_BOUNDED){assert.ok(metrics.initialSnippetIds<=60,JSON.stringify(metrics));assert.ok(metrics.largestBatch<=60);}
  await page.screenshot({path:join(artifacts,'large-grid.png')});
  await writeFile(join(artifacts,'metrics.json'),JSON.stringify(metrics,null,2));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:'layout identity, range selection, keyboard isolation, preview/focus/scroll, match reason, mobile, themes, cover treatment',metrics,artifacts}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
