// Disposable synthetic data and mocked editorial responses; no provider/settings changes.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {once} from 'node:events';
import {PDFDocument} from 'pdf-lib';
import {lifecycleFixture} from '../test/helpers/entity-lifecycle-fixture.mjs';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/opt/codex/cua_node/lib/node_modules/playwright-core/index.mjs');
const label=process.env.MEASUREMENT_LABEL??'after',out=resolve('output/navigation-loading',label);await mkdir(out,{recursive:true});
const f=await lifecycleFixture(),other=f.pages.create('default',{title:'Synthetic second navigation note'});
// Queued synthetic PDF row wakes the application progress loop without invoking ingestion.
const pdf=await PDFDocument.create();pdf.addPage().drawText('Synthetic background document');
const pending=f.files.add('default','background.pdf',Buffer.from(await pdf.save({useObjectStreams:false})));
f.knowledge.create('default',{type:'source',name:'Synthetic background processing',attachmentIds:[pending.id]});
const revision=JSON.parse(await readFile(new URL('../test/fixtures/dante-editorial-revision.json',import.meta.url),'utf8'));
revision.fileId=f.file.id;revision.id='synthetic-reading-revision';revision.patches=revision.patches.slice(0,1);revision.status='completed';revision.reprocessed=structuredClone(revision.original);
const server=createApp(f.store,resolve(process.env.CLIENT_DIST??'dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;const errors=[],external=[],requests=[],responses=[],checks=[];
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({path:new URL(r.url()).pathname+new URL(r.url()).search,method:r.method(),at:Date.now()});else if(!r.url().startsWith('http://127.0.0.1:')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))external.push(r.url());});
 page.on('response',async r=>{if(r.url().includes('/api/'))try{responses.push({path:new URL(r.url()).pathname+new URL(r.url()).search,bytes:(await r.body()).length,status:r.status()});}catch{}});
 const base=`http://127.0.0.1:${server.address().port}`;
 await page.goto(`${base}/?vault=default&page=${f.active.id}`);await page.locator('#blocks .block-content').first().waitFor();
 const startup=requests.slice();
 await page.getByRole('button',{name:'Expand Unfiled pages',exact:true}).click();
 const link=id=>page.locator(`[data-canonical-page="${id}"]`).first();
 await link(other.id).click();await page.locator('#page-title').waitFor();await link(f.active.id).click();
 await page.waitForTimeout(3300);
 const beforeReturn=requests.filter(r=>r.path===`/api/pages/${f.active.id}/editor`&&r.method==='GET').length;
 await link(other.id).click();await link(f.active.id).click();await page.waitForTimeout(250);
 const afterReturn=requests.filter(r=>r.path===`/api/pages/${f.active.id}/editor`&&r.method==='GET').length;
 const cacheReturnFetches=afterReturn-beforeReturn;checks.push('background processing navigation');
 await page.screenshot({path:join(out,'desktop-navigation.png')});
 // Hold only full detail. A bounded overview must be visible while it is pending.
 let release,started,detailStarted=false;const gate=new Promise(r=>release=r),requestedDetail=new Promise(r=>started=r);
 await page.route(`**/api/entities/${f.person.id}`,async route=>{detailStarted=true;started();await gate;await route.continue().catch(()=>{});});
 await page.goto(`${base}/?vault=default&view=entity&subject=${f.person.id}`);
 await Promise.race([requestedDetail,page.waitForTimeout(10000)]);await page.waitForTimeout(150);const previewVisible=await page.locator('.entity-home h1').isVisible();release();await page.unroute(`**/api/entities/${f.person.id}`);await page.locator('.entity-home h1').waitFor();
 checks.push('bounded overview with full detail held');
 await page.route(`**/api/source-files/${f.file.id}/reprocessing`,route=>route.fulfill({json:[{...revision,patchCount:revision.patches.length,pendingCount:1}]}));
 await page.route(`**/api/source-files/${f.file.id}/reprocessing/${revision.id}`,route=>route.fulfill({json:revision}));
 await page.goto(`${base}/?vault=default&source=${f.source.id}`);await page.getByRole('region',{name:'Source reading view'}).waitFor();await page.locator('.source-reader-content').waitFor();await page.waitForTimeout(800);
 const fullPath=`/api/source-files/${f.file.id}/reprocessing/${revision.id}`;
 const hiddenRevisionRequests=requests.filter(r=>r.path===fullPath).length;
 const review=page.getByRole('button',{name:/Review changes/}).first();let reviewLoaded=false;
 if(await review.isVisible()){await review.click();await page.waitForTimeout(500);reviewLoaded=requests.filter(r=>r.path===fullPath).length>hiddenRevisionRequests;}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'mobile-reader.png')});
 const mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 const result={label,browser:await browser.version(),synthetic:true,devicePerformanceMeasured:false,startup:{vaultRequests:startup.filter(r=>r.path==='/api/vaults').length,requests:startup},cacheReturnFetches,preview:{detailStarted,visibleBeforeFullDetail:previewVisible},hiddenRevisionRequests,reviewLoaded,mobileOverflow,errors,external,checks,requests,responses};
 await writeFile(join(out,'metrics.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,requests:requests.length,responses:responses.length}));
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 if(label!=='before'){assert.equal(cacheReturnFetches,0);assert.equal(previewVisible,true);assert.equal(hiddenRevisionRequests,0);assert.equal(reviewLoaded,true);assert.equal(mobileOverflow,false);}
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));f.close();}
