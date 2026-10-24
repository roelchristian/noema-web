// Disposable synthetic database. Network and AI providers are blocked.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {createApp} from '../src/server/http.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const db=openDatabase(':memory:'),store=new Store(db);
const ai=new Intelligence({read:()=>null,write(){},remove(){}},async()=>{throw new Error('Real provider calls forbidden');});
const server=createApp(store,resolve('dist/client'),ai),directory=process.env.NOEMA_SCREENSHOTS??'/tmp/noema-bibliography-evidence';
let browser;const errors=[];
try {
 await mkdir(directory,{recursive:true});server.listen(0,'127.0.0.1');await once(server,'listening');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const base=`http://127.0.0.1:${server.address().port}`;
 await page.goto(base+'/?vault=default&view=entities&type=source');
 if(!await page.getByRole('button',{name:'Import bibliography',exact:true}).count())await page.getByRole('button',{name:'Sources',exact:true}).first().click();
 const open=async()=>{await page.getByRole('button',{name:'Import bibliography',exact:true}).click();await page.getByRole('textbox',{name:'BibTeX / BibLaTeX',exact:true}).fill('@book{Synthetic2026,title={Synthetic Bibliography Study},author={{Synthetic Group}},year={2026},doi={10.5555/synthetic},custom={retained}}');};
 // Cancellation before commit never creates a Source.
 await open();await page.getByRole('button',{name:'Review import',exact:true}).click();await page.getByRole('combobox',{name:'Import decision for Synthetic2026'}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(store.get('SELECT count(*) n FROM bibliographic_records').n,0);
 // Real local API import and retry produce one stable metadata-only Source.
 await open();await page.getByRole('button',{name:'Review import',exact:true}).click();await page.getByRole('button',{name:'Import reviewed entries',exact:true}).click();await page.getByRole('status').filter({hasText:'1 created'}).waitFor();
 const record=store.get('SELECT * FROM bibliographic_records');assert.ok(record);assert.equal(store.get('SELECT count(*) n FROM source_files WHERE entity_id=?',record.source_id).n,0);
 await page.getByRole('button',{name:'Review import',exact:true}).click();const decision=page.getByRole('combobox',{name:'Import decision for Synthetic2026'});await decision.waitFor();assert.equal(await decision.inputValue(),'skip');await decision.selectOption(record.source_id);await page.getByRole('button',{name:'Import reviewed entries',exact:true}).click();await page.getByRole('status').filter({hasText:'1 skipped'}).waitFor();assert.equal(store.get('SELECT count(*) n FROM bibliographic_records').n,1);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.screenshot({path:join(directory,'sources-desktop.png')});
 // Open the Source inspector directly through the app's entity route.
 await page.goto(base+'/?vault=default&source='+record.source_id+'&entity='+record.source_id);
 await page.getByRole('tab',{name:'Details',exact:true}).click();
 const editor=page.locator('.bibliography-editor').last();await editor.getByText('Verify DOI metadata',{exact:true}).waitFor();
 assert.equal(await editor.getByRole('button',{name:'Look up DOI',exact:true}).isEnabled(),false);
 let lookup=0;
 await page.route('**/api/bibliography/*/verify',async route=>{lookup++;await route.fulfill({json:{proposalId:'browser-synthetic',provider:'crossref',revision:1,fields:{title:'Remote alternative',publisher:'Synthetic Press'}}});});
 await editor.getByLabel(/Allow this lookup/).check();await editor.getByRole('button',{name:'Look up DOI',exact:true}).click();await editor.getByText('Proposed: Synthetic Press',{exact:true}).waitFor();assert.equal(lookup,1);
 assert.equal(await editor.getByRole('button',{name:'Accept selected facts',exact:true}).isEnabled(),false);await editor.getByRole('button',{name:'Dismiss proposal',exact:true}).click();
 await page.screenshot({path:join(directory,'source-details-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(directory,'source-details-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 // Insert a real file-free citation and reload its persisted locator and bibliography.
 await page.setViewportSize({width:1440,height:1000});
 const pages=new Pages(store,new Knowledge(store)),note=pages.create('default',{title:'Synthetic citation note'});
 await page.goto(base+'/?vault=default&page='+note.id);
 const content=page.locator('.block-content[contenteditable=true]').first();await content.click();await page.keyboard.type('/cite',{delay:100});await page.locator('.command-menu').waitFor();await page.keyboard.press('Enter');
 await page.getByRole('option',{name:'Synthetic Bibliography Study'}).click();await page.getByRole('combobox',{name:'Citation kind',exact:true}).selectOption('publication');
 await page.getByRole('textbox',{name:'Bibliographic locator',exact:true}).fill('12');await page.getByRole('button',{name:'Insert bibliographic citation',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-bibliographic-reference]'));
 await page.waitForFunction(()=>document.querySelector('.note-references li'));
 await page.waitForFunction(async id=>{const response=await fetch('/api/pages/'+id,{headers:{'x-vault-id':'default'}});const data=await response.json();return data.blocks.some(block=>block.content.some(segment=>segment.bibliographicReference?.locator==='12'));},note.id);
 await page.reload();await page.locator('.note-references li').waitFor();assert.ok(pages.get('default',note.id).sourceIds.includes(record.source_id));assert.equal(pages.get('default',note.id).blocks[0].content.find(segment=>segment.bibliographicReference).bibliographicReference.sourceId,record.source_id);
 await page.getByRole('combobox',{name:'Bibliography style',exact:true}).selectOption('ieee');await page.screenshot({path:join(directory,'publication-citation.png')});
 assert.deepEqual(errors,[]);await writeFile(join(directory,'validation.json'),JSON.stringify({passed:true,synthetic:true,browser:await browser.version(),checks:['cancel','idempotent retry','metadata-only','DOI consent','explicit field review','mobile','publication citation save/reload','CSL style selection'],errors},null,2));console.log(JSON.stringify({passed:true,directory}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));db.close();}
