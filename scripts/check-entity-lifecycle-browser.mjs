// Full application + real HTTP backend, synthetic local data only. No AI provider.
// PLAYWRIGHT_MODULE and CHROMIUM_PATH follow check-editor-browser.mjs.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {once} from 'node:events';
import {lifecycleFixture} from '../test/helpers/entity-lifecycle-fixture.mjs';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/workspace/noema-archive-evidence');await mkdir(artifacts,{recursive:true});
const f=await lifecycleFixture(),server=createApp(f.store,resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(7000);page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:')&&!request.url().startsWith('data:'))external.push(request.url());});
 const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base);await page.waitForTimeout(500);
 await page.getByText('Knowledge entities',{exact:true}).first().click();
 await page.getByRole('button',{name:/Open Person:/}).click();
 await page.getByRole('button',{name:'Manage entity: Synthetic Archivist',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Archive entity',exact:true}).waitFor();
 assert.match(await dialog.innerText(),/1 active pages · 1 pages in Trash · 4 block references/);
 await page.screenshot({path:resolve(artifacts,'01-entity-impact.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(artifacts,'09-mobile-impact.png'),fullPage:true});await page.setViewportSize({width:1440,height:1100});
 await dialog.getByRole('button',{name:'Archive entity',exact:true}).click();await dialog.waitFor({state:'hidden'}).catch(async error=>{console.log(await dialog.innerText());await page.screenshot({path:resolve(artifacts,'failure.png'),fullPage:true});throw error;});
 assert.equal(await page.getByRole('button',{name:'Manage entity: Synthetic Archivist',exact:true}).count(),0);
 async function choose(label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
 await choose('Entity status','Archived entities');await page.getByRole('button',{name:'Manage entity: Synthetic Archivist',exact:true}).waitFor();
 await page.screenshot({path:resolve(artifacts,'02-entity-archived.png'),fullPage:true});
 // Explicit discovery: default global search hides the archived identity.
 await page.keyboard.press('Control+k');
 await dialog.getByRole('combobox',{name:'Search notes and knowledge'}).fill('Synthetic Archivist');
 await page.waitForTimeout(800);assert.equal(await dialog.getByRole('option').filter({has:page.locator('strong',{hasText:'Synthetic Archivist'})}).count(),0);
 await dialog.getByRole('checkbox',{name:'Include archived entities and sources'}).check();
 await dialog.getByRole('option').filter({has:page.locator('strong',{hasText:'Synthetic Archivist'})}).waitFor();
 await page.screenshot({path:resolve(artifacts,'03-include-archived-search.png'),fullPage:true});
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Manage entity: Synthetic Archivist',exact:true}).click();
 await dialog.getByRole('button',{name:'Restore entity',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await choose('Entity status','Active entities');await page.getByRole('button',{name:'Manage entity: Synthetic Archivist',exact:true}).waitFor();
 // A stale preview is rejected and refreshed while the identity stays active.
 await page.getByRole('button',{name:'Manage entity: Synthetic Archivist',exact:true}).click();await dialog.getByRole('button',{name:'Archive entity',exact:true}).waitFor();
 f.store.run('UPDATE pages SET title=?,revision=revision+1 WHERE id=?','Synthetic concurrent edit',f.active.id);
 await dialog.getByRole('button',{name:'Archive entity',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'changed'}).waitFor();
 assert.equal(f.knowledge.require('default',f.person.id).archived_at,null);
 await page.screenshot({path:resolve(artifacts,'04-stale-preview.png'),fullPage:true});
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 // A failed network mutation is recoverable and does not change server state.
 await page.getByRole('button',{name:'Manage entity: Synthetic Archivist',exact:true}).click();await dialog.getByRole('button',{name:'Archive entity',exact:true}).waitFor();
 await page.route('**/api/entities/*/lifecycle',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic service unavailable'})}):route.continue());
 await dialog.getByRole('button',{name:'Archive entity',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'Synthetic service unavailable'}).waitFor();
 assert.equal(f.knowledge.require('default',f.person.id).archived_at,null);await page.unroute('**/api/entities/*/lifecycle');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByText('Sources',{exact:true}).first().click();await page.getByRole('button',{name:'Manage source: Synthetic evidence',exact:true}).click();
 await dialog.getByRole('button',{name:'Archive source',exact:true}).waitFor();assert.match(await dialog.innerText(),/2 active pages · 1 pages in Trash/);
 await page.screenshot({path:resolve(artifacts,'05-source-impact.png'),fullPage:true});
 await dialog.getByRole('button',{name:'Archive source',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(await page.getByRole('button',{name:'Manage source: Synthetic evidence',exact:true}).count(),0);
 await choose('Source status','Archived sources');await page.getByRole('button',{name:'Manage source: Synthetic evidence',exact:true}).waitFor();
 await page.getByRole('button',{name:'Open Synthetic evidence',exact:true}).click();await page.getByRole('region',{name:'Source reading view'}).waitFor();
 await page.getByRole('button',{name:/^Bookmarks/}).click();await page.getByRole('button',{name:/Synthetic bookmark/}).waitFor();
 await page.screenshot({path:resolve(artifacts,'06-archived-source-bookmark.png'),fullPage:true});
 assert.equal(f.reading.list('default',f.file.id)[0].excerpt,f.highlight.excerpt);
 // Restore directly from source details, then archive it again for historical-link checks.
 await page.getByRole('button',{name:'Restore / manage',exact:true}).click();await dialog.getByRole('button',{name:'Restore source',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(f.knowledge.require('default',f.source.id).archived_at,null);
 await page.getByRole('button',{name:'Archive / manage',exact:true}).click();await dialog.getByRole('button',{name:'Archive source',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.getByText('Pages',{exact:true}).first().click();await page.locator('[data-library-row="page:'+f.active.id+'"] .organization-item-name').click();
 await page.locator('#note-citation-'+f.ref.id).click();
 // Default reference style opens the source viewer directly. Footnote style first reveals the reference list.
 if(!await page.locator('#source-viewer').isVisible())await page.locator('#note-reference-1 [data-source-reference]').click();
 await page.locator('#source-viewer .source-viewer-passages').waitFor();assert.match(await page.locator('#source-viewer').innerText(),/fictional triangle/);
 await page.screenshot({path:resolve(artifacts,'07-archived-source-citation.png'),fullPage:true});
 await page.getByRole('button',{name:'Close source viewer',exact:true}).click();
 // Archive the person through the existing mention details entry point.
 await page.locator('.page [data-entity="'+f.person.id+'"]').first().click();await page.getByRole('button',{name:'Open entity details',exact:true}).click();await page.getByRole('button',{name:'Archive / manage',exact:true}).click();
 await dialog.getByRole('button',{name:'Archive entity',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Vault options',exact:true}).click();await page.getByRole('menuitem',{name:'Trash',exact:true}).click();
 await page.getByRole('button',{name:'Restore Synthetic trashed references',exact:true}).click();
 await page.locator('.page [data-entity="'+f.person.id+'"]').first().waitFor();
 await page.locator('.page [data-entity="'+f.person.id+'"]').first().click();await page.getByRole('button',{name:'Open entity details',exact:true}).click();await page.getByRole('button',{name:'Restore / manage',exact:true}).waitFor();
 await page.screenshot({path:resolve(artifacts,'08-restored-trash-archived-link.png'),fullPage:true});
 // Browser-originated requests exercise ownership, locking and repeated action semantics.
 const access=await page.evaluate(async({id,version,other})=>{
  const call=async(vault,body)=>{const response=await fetch('/api/entities/'+id+'/lifecycle',{method:'POST',headers:{'Content-Type':'application/json','X-Noema-Request':'1','X-Vault-Id':vault},body:JSON.stringify(body)});return response.status;};
  return [await call('default',{action:'archive',version}),await call(other,{action:'restore',version})];
 },{id:f.person.id,version:'idempotent-original-token',other:f.vaults.create({name:'Synthetic foreign browser vault'}).id});assert.deepEqual(access,[200,404]);
 f.vaults.lock('default',{passphrase:'synthetic-only'});
 assert.equal(await page.evaluate(async id=>(await fetch('/api/entities/'+id+'/lifecycle',{headers:{'X-Vault-Id':'default'}})).status,f.source.id),423);f.vaults.unlock('default',{passphrase:'synthetic-only'});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(resolve(artifacts,'browser-result.json'),JSON.stringify({browser:await browser.version(),errors,external,passed:['entity impact and archival','archived filter','include archived search','entity restore','stale preview','failed request','linked source archive','source bookmark and highlight readability','source restore from details','archived citation viewer','restored Trash page archived mention','repeated action and wrong/locked vault from browser','mobile impact preview']},null,2));

}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));f.close();}
