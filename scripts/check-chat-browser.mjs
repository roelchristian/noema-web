// Actual application, disposable synthetic SQLite, in-memory credentials and deterministic
// provider transport. No user database, keychain reads, or live provider calls.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourcePassages} from '../src/server/modules/source-passages.ts';
import {Intelligence,intelligencePreferencesFor} from '../src/server/modules/intelligence.ts';
import {createApp} from '../src/server/http.ts';
import {completedResponse} from '../test/helpers/providers.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-chat-browser-'));
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??join(repo,'output','chat-browser'));
await mkdir(artifacts,{recursive:true});await rm(join(artifacts,'validation.json'),{force:true});
const errors=[],checks=[],requests=[];
let browser,server,vite,db,files;
const originalFetch=globalThis.fetch;
try {
 db=openDatabase(join(directory,'synthetic.sqlite'));const store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
 const secondVault=new Vaults(store).create({name:'Other synthetic vault'});
 for(const vault of ['default',secondVault.id])store.run('INSERT INTO embedding_settings(vault_id,automatic,min_characters) VALUES (?,0,20) ON CONFLICT(vault_id) DO UPDATE SET automatic=0',vault);
 const makeNote=(vault,title,text)=>{const p=pages.create(vault,{title});return pages.update(vault,p.id,{...p,blocks:[{id:'synthetic-'+p.id,type:'paragraph',content:[{text}]}]});};
 const specimen=makeNote('default','Synthetic grace notebook','My own note: grace is indispensable, though this reading complicates the source. This is a synthetic browser test, not a historical assertion.');
 const other=makeNote(secondVault.id,'Private other vault notebook','Synthetic other-vault phrase: never disclose this passage to the default vault.');
 const augustine=knowledge.create('default',{name:'Augustine',type:'person',description:'Synthetic research entity for scoped Chat testing.'});
 const target=knowledge.create('default',{name:'Synthetic birthplace',type:'place',description:'Synthetic navigation target.'});
 const nationality=knowledge.property('default',augustine.id,{name:'nationality',value:'Synthetic nationality'}).properties.find(item=>item.name==='nationality');
 const birthplace=knowledge.property('default',augustine.id,{name:'birthplace',target_id:target.id}).properties.find(item=>item.name==='birthplace');
 const relationship=knowledge.relationship('default',augustine.id,{label:'Synthetic influence',target_id:target.id}).relationships[0];
 const sourceText='A synthetic imported source says grace is indispensable. Its author distinguishes the priority of divine initiative. This conflicts with a synthetic note in the test corpus.';
 files=new SourceFiles(store);const file=files.add('default','synthetic-grace.txt',Buffer.from(sourceText));
 const source=knowledge.create('default',{name:'Synthetic grace source',type:'source',attachmentIds:[file.id]});
 store.run("UPDATE source_files SET text=?,status='ready',admitted=1 WHERE id=?",sourceText,file.id);store.run('UPDATE entities SET inactive=0 WHERE id=?',source.id);new SourcePassages(store,text=>text.length).synchronize('default');
 const secrets={value:null,read(){return this.value;},write(value){this.value=value;},remove(){this.value=null;}};
 let transportMode='answer',cancellations=0;
 const ai=new Intelligence(secrets,async(_url,options)=>{
  const payload=JSON.parse(options.body);requests.push(payload);assert.doesNotMatch(payload.instructions,/AI PERSONA:/,'Chat remains neutral despite configured writing persona');
  if(transportMode==='pending')return new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>{cancellations++;reject(new DOMException('Synthetic cancellation','AbortError'));},{once:true});});
  if(transportMode==='error')return new Response('Synthetic unavailable',{status:503});
  // Filled from the actual bounded registry, never invented document coordinates.
  const registry=JSON.parse(payload.input);
  const evidence=registry.evidence??registry.registry??[];
  const requested=registry.question.includes('property focus')?`property:${nationality.id}`:registry.question.includes('relationship focus')?`relationship:${relationship.id}`:registry.question.includes('incoming focus')?`incoming:${birthplace.id}`:null;
  const first=requested?evidence.find(item=>item.factId===requested):registry.scope?.kind==='source'?(evidence.find(item=>item.kind==='source')??evidence[0]):evidence[0];
  if(requested)assert.ok(first,'Exact fact remains in bounded selected evidence');
  return completedResponse({claims:[{text:'The selected synthetic material discusses grace.',attribution:first?'supported':'unestablished',citationIds:first?[first.id]:[]}]});
 },Date.now,intelligencePreferencesFor(store));
 ai.save({apiKey:'sk-synthetic-browser-no-provider'});ai.savePreferences({...ai.selection(),personaId:'oxford_don',manualRequestsPerMinute:120});
 globalThis.fetch=(input,options)=>String(input).startsWith('https://')?Promise.reject(new Error('External requests disabled in Chat browser fixture')):originalFetch(input,options);
 server=createApp(store,join(repo,'dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
 vite=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:`http://127.0.0.1:${server.address().port}`,changeOrigin:false}}}});await vite.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
 async function screenshot(page,name){if(process.env.NOEMA_SKIP_SCREENSHOTS==='1')return;await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:join(artifacts,name+'.png'),animations:'disabled'});}
 // UI checks below exercise the same components and routes that ship in the app.
 // Mocked answers demonstrate transport, rendering and citation flow, not live answer quality.
 async function openChat(page,width) {
  if(width<600)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByRole('region',{name:'Chat workspace'}).waitFor();
 }
 async function ask(page,text='What does the selected material say about grace?') {
  await page.getByRole('textbox',{name:'Ask something about your knowledge',exact:true}).fill(text);
  await page.getByRole('button',{name:'Ask',exact:true}).click();
  await page.locator('.chat-message.is-assistant').last().waitFor();
 }
 async function geometry(page,width) {
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal document overflow');
  const boxes=await page.locator('.chat-workspace button,.chat-workspace select,.chat-workspace textarea').evaluateAll(nodes=>nodes.filter(node=>node.checkVisibility()).map(node=>{const r=node.getBoundingClientRect();return {name:node.getAttribute('aria-label')??node.textContent.trim().slice(0,40),x:r.x,right:r.right,width:r.width,height:r.height};}));
  for(const box of boxes){assert.ok(box.x>=-1&&box.right<=width+1,JSON.stringify(box));if(width===390)assert.ok(box.width>=43.9&&box.height>=43.9,JSON.stringify(box));}
 }
 for(const width of [1440,390])for(const mode of ['light','dark']) {
  const context=await browser.newContext({viewport:{width,height:960},isMobile:width===390,hasTouch:width===390,reducedMotion:'reduce'});
  await context.addInitScript(({mode})=>localStorage.setItem('noema.appearance.v1',JSON.stringify({mode,theme:'ink'})),{mode});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/?vault=default&page=${specimen.id}`);await page.locator('#page-title').waitFor();
  await openChat(page,width);assert.match(await page.locator('[data-chat-scope]').innerText(),/Entire vault/);
  await page.getByRole('checkbox',{name:'Temporary',exact:true}).check();
  const composer=page.getByRole('textbox',{name:'Ask something about your knowledge',exact:true});
  await composer.fill('@August');await page.locator('#chat-mention-list').getByRole('option',{name:/Augustine/}).waitFor();await composer.press('Enter');
  assert.equal(await page.locator('.chat-mentions [data-entity-id]').getAttribute('data-entity-id'),augustine.id);
  await composer.fill('What do my notes say about grace?');await composer.press('Enter');
  await page.locator('.chat-message.is-assistant').waitFor();
  assert.match(await page.locator('.chat-message.is-assistant').innerText(),/selected synthetic material/);
  await page.locator('.chat-citation').first().focus();await page.keyboard.press('Enter');
  await page.locator('.chat-evidence').waitFor();
  assert.ok(await page.getByRole('button',{name:'Close evidence panel',exact:true}).evaluate(node=>node===document.activeElement));
  assert.ok((await page.locator('.chat-evidence blockquote').innerText()).length>20);
  const priorQuote=await page.locator('.chat-evidence blockquote').innerText();const references=page.locator('.chat-evidence-list button');if(await references.count()>1){await references.nth(1).click();await page.waitForFunction(prior=>document.querySelector('.chat-evidence blockquote')?.textContent!==prior,priorQuote);}
  if(width===390){const r=await page.locator('.chat-evidence').boundingBox();assert.ok(r.x>=0&&r.width<=390&&r.y>0,'Mobile evidence is a bounded bottom sheet');await page.getByRole('button',{name:'Close evidence panel',exact:true}).press('Shift+Tab');assert.ok(await page.locator('.chat-evidence').evaluate(node=>node.contains(document.activeElement)),'Evidence sheet traps reverse tab');}
  await geometry(page,width);await screenshot(page,`${width}-${mode}-evidence`);
  await page.keyboard.press('Escape');await page.locator('.chat-evidence').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('.chat-citation')===document.activeElement);assert.ok(await page.locator('.chat-citation').first().evaluate(node=>node===document.activeElement),'Dismissal restores original citation focus after switching references');
  await screenshot(page,`${width}-${mode}-chat`);
  await page.getByRole('button',{name:'Close Chat',exact:true}).click();
  await openChat(page,width);assert.equal(await page.locator('.chat-message').count(),0,'Temporary chat disappears on close');
  // Contextual Page scope, persisted history and exact page evidence navigation.
  await page.getByRole('button',{name:'Close Chat',exact:true}).click();
  await page.getByRole('button',{name:'Ask about this',exact:true}).click();
  assert.match(await page.locator('[data-chat-scope]').innerText(),/Page · Synthetic grace notebook/);
  await ask(page);const history=page.getByRole('combobox',{name:'Conversation history',exact:true});await page.waitForFunction(()=>document.querySelector('select[aria-label="Conversation history"]')?.value);
  const threadId=await history.inputValue();assert.ok(threadId);
  await page.getByRole('button',{name:'Rename conversation',exact:true}).click();await page.getByRole('textbox',{name:'Conversation title',exact:true}).fill(`Browser ${width} ${mode}`);await page.getByRole('button',{name:'Save title',exact:true}).click();
  await page.locator('.chat-citation').first().click();await page.getByRole('button',{name:'Open in original',exact:true}).click();await page.locator('#page-title').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('page'),specimen.id,'Evidence opens original note');
  await openChat(page,width);await history.selectOption(threadId);await page.locator('.chat-message.is-assistant').waitFor();
  await page.getByRole('button',{name:'Delete conversation',exact:true}).click();await page.locator('.chat-message').first().waitFor({state:'hidden'});
  // Pending requests are stoppable and never expose partial provider prose.
  transportMode='pending';const before=requests.length;
  await composer.fill('What does grace mean here?');await page.getByRole('button',{name:'Ask',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.chat-progress'));for(let attempt=0;requests.length===before&&attempt<200;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(requests.length>before,'Pending request reached mock provider');
  await assert.doesNotReject(async()=>{await page.getByRole('button',{name:'Stop',exact:true}).click();});
  await page.getByRole('button',{name:'Ask',exact:true}).waitFor();assert.equal(await page.locator('.chat-message.is-assistant').count(),0);
  transportMode='answer';await screenshot(page,`${width}-${mode}-stopped`);
  await composer.fill('What does grace mean here?');await composer.press('Enter');await page.locator('.chat-message.is-assistant').waitFor();
  assert.ok(requests.at(-1).input.includes('previousQuestions'),'Repeat flow uses fresh provider request');
  // Provider failure stays intelligible and leaves no unfinished answer behind.
  await page.getByRole('button',{name:'New chat',exact:true}).click();transportMode='error';
  await composer.fill('What does grace mean here?');await composer.press('Enter');await page.locator('.chat-error').waitFor();assert.equal(await page.locator('.chat-message.is-assistant').count(),0);transportMode='answer';
  await page.goto(`${base}/?vault=default&source=${source.id}`);await page.getByRole('button',{name:'Ask about this',exact:true}).waitFor();await page.getByRole('button',{name:'Ask about this',exact:true}).click();
  assert.match(await page.locator('[data-chat-scope]').innerText(),/Source · Synthetic grace source/);await ask(page);
  await page.locator('.chat-citation').first().click();assert.match(await page.locator('.chat-evidence-kind').innerText(),/Imported source/);await page.getByRole('button',{name:'Open in original',exact:true}).click();await page.locator('#source-viewer').waitFor();assert.match(await page.locator('#source-viewer').innerText(),/synthetic imported source/i);await screenshot(page,`${width}-${mode}-source-origin`);
  await page.goto(`${base}/?vault=default&view=entity&subject=${augustine.id}`);await page.getByRole('button',{name:'Ask about this',exact:true}).waitFor();await page.getByRole('button',{name:'Ask about this',exact:true}).click();
  assert.match(await page.locator('[data-chat-scope]').innerText(),/Entity · Augustine/);await ask(page,'What is recorded about Augustine?');await page.locator('.chat-citation').first().click();assert.match(await page.locator('.chat-evidence-kind').innerText(),/Recorded entity fact|Entity overview/);await page.keyboard.press('Escape');
  async function exactFact(question,selector,entity=augustine) {
   await page.goto(`${base}/?vault=default&view=entity&subject=${entity.id}`);await page.getByRole('button',{name:'Ask about this',exact:true}).click();await ask(page,question);await page.locator('.chat-citation').first().click();await page.getByRole('button',{name:'Open in original',exact:true}).click();await page.waitForFunction(selector=>{const rows=[...document.querySelectorAll(selector)];return rows.some(node=>node===document.activeElement);},selector);assert.equal(new URL(page.url()).searchParams.get('subject'),augustine.id,'Exact fact opens the owning entity');
  }
  await exactFact('Show the property focus',`[data-property-id="${nationality.id}"]`);
  await exactFact('Show the relationship focus',`[data-relationship-id="${relationship.id}"]`);
  await exactFact('Show the incoming focus',`[data-property-id="${birthplace.id}"]`,target);
  await screenshot(page,`${width}-${mode}-exact-entity-fact`);
  await page.getByRole('button',{name:'Return to Chat',exact:true}).click();
  // Changing the actual vault while a request is pending aborts its result.
  transportMode='pending';const beforeSwitch=requests.length;await composer.fill('What is recorded about Augustine?');await composer.press('Enter');for(let attempt=0;requests.length===beforeSwitch&&attempt<200;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(requests.length>beforeSwitch);
  if(width===390)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.locator('#vault-select').selectOption(secondVault.id);await page.waitForURL(url=>url.searchParams.get('vault')===secondVault.id);transportMode='answer';
  await page.getByRole('region',{name:'Chat workspace'}).waitFor({state:'hidden'});if(width===390&&await page.getByRole('button',{name:'Close navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Close navigation',exact:true}).click();await openChat(page,width);assert.match(await page.locator('[data-chat-scope]').innerText(),/Other synthetic vault/);assert.equal(await page.locator('.chat-message').count(),0,'Previous vault conversation is absent');
  checks.push({width,mode,scope:'vault and contextual page bounded',resolvedMention:augustine.id,evidence:'keyboard focus, exact note navigation, saved snapshot',temporary:'close clears history',history:'rename and delete',cancellation:'no partial answer',horizontalOverflow:false,contextual:'Page, source and entity; property, relationship and incoming-owner exact focus',providerFailure:'no partial answer; retry recovers',vaultSwitch:'aborts pending answer and clears old conversation',requestsBeforeCancel:before});
  await context.close();
 }
 void other;void secondVault;void source;
 assert.deepEqual(errors,[]);
 await writeFile(join(artifacts,'validation.json'),JSON.stringify({browser:await browser.version(),checks,errors,providerRequests:requests.length,liveProvider:false,cancellations},null,2));
 console.log(JSON.stringify({artifacts,checks,errors}));
} finally {
 if(browser)await browser.close();if(vite)await vite.close();
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 files?.close();db?.close();globalThis.fetch=originalFetch;await rm(directory,{recursive:true,force:true});
}
