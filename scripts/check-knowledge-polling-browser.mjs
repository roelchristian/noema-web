// Populated real application, disposable SQLite, synthetic stored summaries, no providers.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Domains} from '../src/server/modules/domains.ts';
import {AIEnrichments} from '../src/server/modules/ai-enrichments.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const directory=await mkdtemp(join(tmpdir(),'noema-knowledge-browser-')),artifacts=resolve('output/knowledge-browser');
await mkdir(artifacts,{recursive:true});
const db=openDatabase(join(directory,'fixture.sqlite')),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),enrichments=new AIEnrichments(store,pages);
let providerCalls=0;
const secrets={read(){return null;},write(){},remove(){}};
const intelligence=new Intelligence(secrets,async()=>{providerCalls++;throw new Error('Live providers disabled');});
const preferences={model:'gpt-5-mini',reasoningEffort:'low'};
function fixture(title,summary) {
  let note=pages.create('default',{title});
  note=pages.update('default',note.id,{...note,blocks:Array.from({length:9},(_,i)=>({id:'body-'+i,type:'paragraph',content:[{text:Array(55).fill('Synthetic research on interpretation and reliable evidence.').join(' ')}]}))});
  enrichments.save('default',note.id,'summary',{summary,baseline:{text:'PRIVATE BASELINE',vector:[1,2,3],tokenCounts:{private:1}}},note.revision,preferences);
  return note;
}
const first=fixture('Knowledge first specimen','First stored summary.'),second=fixture('Knowledge second specimen','Second stored summary.');
store.run('DELETE FROM page_enrichment_jobs');
const server=createApp(store,resolve('dist/client'),intelligence);server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;const errors=[],requests=[],checks=[];
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/\/enrichment(s|-status)(?:\?|$)/.test(request.url()))requests.push({url:request.url(),at:Date.now()});});
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/?vault=default&page=${first.id}`);await page.locator('#blocks .block-content').first().waitFor();
  await page.getByRole('button',{name:'Show page knowledge',exact:true}).click();
  await page.locator('.ai-summary').getByText('First stored summary.',{exact:true}).waitFor();
  await page.waitForTimeout(1500);store.run('DELETE FROM page_enrichment_jobs');await page.evaluate(()=>window.dispatchEvent(new Event('noema:ai-activity')));await page.waitForTimeout(400);const settled=requests.length;await page.waitForTimeout(2400);
  assert.equal(requests.length,settled,'Settled panel makes no two-second full-result or status requests');checks.push('settled cadence');
  const publicPayload=await (await page.request.get(`${base}/api/pages/${first.id}/enrichments`,{headers:{'X-Vault-Id':'default'}})).text();assert.doesNotMatch(publicPayload,/PRIVATE BASELINE|tokenCounts|vector/);checks.push('private evidence excluded');
  enrichments.save('default',first.id,'summary',{summary:'Externally refreshed summary.'},first.revision,preferences);
  await page.evaluate(()=>window.dispatchEvent(new Event('noema:ai-activity')));
  await page.locator('.ai-summary').getByText('Externally refreshed summary.',{exact:true}).waitFor();checks.push('external result refresh');
  // A durable pending job wakes frequent checks; deleting it models terminal failure/cancel.
  store.run("INSERT INTO page_enrichment_jobs(page_id,vault_id,fields,explicit,due_at,attempts,generation,updated_at) VALUES (?,?,'[\"summary\"]',0,?,0,1,?) ON CONFLICT(page_id) DO UPDATE SET fields=excluded.fields,due_at=excluded.due_at,generation=page_enrichment_jobs.generation+1",first.id,'default',Date.now()+600000,new Date().toISOString());
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(300);
  const pending=requests.filter(request=>request.url.includes('enrichment-status')).length;await page.waitForTimeout(2300);
  assert.ok(requests.filter(request=>request.url.includes('enrichment-status')).length>pending,'Pending panel checks status frequently');
  store.run('DELETE FROM page_enrichment_jobs WHERE page_id=?',first.id);await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForTimeout(400);
  const terminal=requests.length;await page.waitForTimeout(2300);assert.equal(requests.length,terminal,'Terminal job returns to settled cadence');checks.push('pending and terminal cadence');
  new Domains(store).setInferred('default',first.id,{primaryDomainId:'mathematics',secondaryDomainIds:[]},pages.get('default',first.id).conceptContentHash,first);
  store.run('DELETE FROM page_enrichment_jobs WHERE page_id=?',first.id);
  await page.evaluate(()=>window.dispatchEvent(new Event('noema:ai-activity')));
  await page.locator('.knowledge-subject-primary').getByText('Mathematics and Formal Sciences',{exact:true}).waitFor();checks.push('external settled domain refresh');
  await page.screenshot({path:join(artifacts,'desktop-settled.png')});
  await page.goto(`${base}/?vault=default&page=${second.id}`);await page.locator('#blocks .block-content').first().waitFor();
  const show=page.getByRole('button',{name:'Show page knowledge',exact:true});await page.waitForTimeout(500);if(await show.getAttribute('aria-expanded')!=='true')await show.click();
  await page.locator('.ai-summary').getByText('Second stored summary.',{exact:true}).waitFor();assert.doesNotMatch(await page.locator('#intelligence-panel').innerText(),/Externally refreshed summary/);checks.push('page switch');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(artifacts,'mobile-settled.png')});
  await page.getByRole('button',{name:'Close Knowledge panel',exact:true}).click();await page.waitForTimeout(300);const closed=requests.length;await page.waitForTimeout(2300);assert.equal(requests.length,closed,'Closing cleans up polling');checks.push('close cleanup');
  assert.deepEqual(errors,[]);assert.equal(providerCalls,0);
  const result={browser:await browser.version(),checks,errors,providerCalls,requests:requests.length};await writeFile(join(artifacts,'validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({url:await browser.contexts()[0]?.pages()[0]?.url(),panel:await browser.contexts()[0]?.pages()[0]?.locator('#intelligence-panel').allTextContents(),requests}));throw error;}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();await rm(directory,{recursive:true,force:true});}
