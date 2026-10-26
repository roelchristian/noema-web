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
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-chat-research-'));
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??join(repo,'output','chat-research-browser'));
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
  const payload=JSON.parse(options.body);requests.push(payload);assert.match(payload.instructions,/AI PERSONA:/,'Configured persona reaches the deterministic provider');
  if(transportMode==='pending')return new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>{cancellations++;reject(new DOMException('Synthetic cancellation','AbortError'));},{once:true});});
  if(transportMode==='error')return new Response('Synthetic unavailable',{status:503});
  // Filled from the actual bounded registry, never invented document coordinates.
  const registry=JSON.parse(payload.input);
  const evidence=registry.evidence??registry.registry??[];
  const requested=registry.question.includes('property focus')?`property:${nationality.id}`:registry.question.includes('relationship focus')?`relationship:${relationship.id}`:registry.question.includes('incoming focus')?`incoming:${birthplace.id}`:null;
  const first=requested?evidence.find(item=>item.factId===requested):registry.scope?.kind==='source'?(evidence.find(item=>item.kind==='source')??evidence[0]):evidence[0];
  if(requested)assert.ok(first,'Exact fact remains in bounded selected evidence');
  return completedResponse({claims:[{text:'The selected synthetic material discusses grace.',attribution:first?'supported':'unestablished',citationIds:first?[...new Set([first.id,...evidence.slice(0,3).map(item=>item.id)])]:[]}]});
 },Date.now,intelligencePreferencesFor(store));
 ai.save({apiKey:'sk-synthetic-browser-no-provider'});ai.savePreferences({...ai.selection(),personaId:'oxford_don',manualRequestsPerMinute:120});
 globalThis.fetch=(input,options)=>String(input).startsWith('https://')?Promise.reject(new Error('External requests disabled in Chat browser fixture')):originalFetch(input,options);
 server=createApp(store,join(repo,'dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
 vite=await createServer({cacheDir:join(directory,'vite-cache'),configFile:false,root:repo,server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:`http://127.0.0.1:${server.address().port}`,changeOrigin:false}}}});await vite.listen();
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
  await page.getByRole('button',{name:'Send message',exact:true}).click();
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
  const sent=[];let deleteAttempts=0;
  page.on('request',request=>{if(request.url().endsWith('/api/chat/messages'))sent.push(JSON.parse(request.postData()));});
  await page.route('**/api/chat/threads/*',async route=>{if(route.request().method()==='DELETE'){deleteAttempts++;await route.fulfill({status:200,contentType:'application/json',body:'{"deleted":true}'});}else await route.continue();});
  await page.goto(`${base}/?vault=default&page=${specimen.id}`);await page.locator('#page-title').waitFor();await openChat(page,width);
  const composer=page.getByRole('textbox',{name:'Ask something about your knowledge',exact:true});
  async function selectedThread(){if(width===390)await page.getByRole('button',{name:'Show conversations',exact:true}).click();const id=await page.locator('.chat-thread[aria-current=page]').getAttribute('data-thread-id');if(width===390)await page.getByRole('button',{name:'Close conversations',exact:true}).click();return id;}
  async function openThread(id){if(width===390)await page.getByRole('button',{name:'Show conversations',exact:true}).click();await page.locator(`[data-thread-id="${id}"]`).click();await page.locator('.chat-message').first().waitFor();await page.waitForFunction(id=>JSON.parse(sessionStorage.getItem('noema-chat-session:default')??'null')?.threadId===id&&document.querySelector('#chat-question')?.disabled===false,id);}
  async function selectScope(id){await page.getByRole('button',{name:'Search within',exact:true}).click();await page.locator(`.chat-scope-dialog [data-context-id="${id}"]`).click();}
  async function options(){await page.locator('.chat-options > summary').click();}
  async function waitRequests(count){await page.waitForFunction(()=>!!document.querySelector('.chat-progress'));for(let attempt=0;requests.length<=count&&attempt<200;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(requests.length>count);}
  assert.match(await page.locator('[data-chat-scope]').innerText(),/Entire vault/);
  await ask(page,'Synthetic first research question about grace');assert.equal(await page.locator('.chat-heading h1').isVisible(),true,'Conversation title remains visible');const avatar=page.locator('.chat-contact > .meno-avatar');if(width===390)await avatar.tap();else await avatar.press('Enter');assert.equal(await avatar.getAttribute('data-playful'),'true','Meno gesture remains available');const persona=page.getByRole('button',{name:/^Edit Meno ·/});if(width===390)await persona.tap();else await persona.click();await page.getByRole('menu',{name:'Meno personas',exact:true}).waitFor();await page.keyboard.press('ArrowDown');assert.ok(await page.getByRole('menu',{name:'Meno personas',exact:true}).evaluate(node=>node.contains(document.activeElement)));await page.keyboard.press('Escape');await screenshot(page,`${width}-${mode}-research-active-header`);const firstId=await selectedThread();
  await composer.fill('First unsent draft about grace');await page.getByRole('button',{name:'New conversation',exact:true}).click();await ask(page,'Synthetic second research question about grace');const secondId=await selectedThread();
  await composer.fill('Second unsent draft');await openThread(firstId);assert.equal(await composer.inputValue(),'First unsent draft about grace');
  await page.reload();await composer.waitFor();assert.equal(await composer.inputValue(),'First unsent draft about grace');await openThread(secondId);assert.equal(await composer.inputValue(),'Second unsent draft');
  await openThread(firstId);
  // Count opens an index; selecting a verified passage and inline citation opens precise detail.
  await page.locator('.chat-references').first().click();await page.locator('.chat-evidence-list').waitFor();assert.equal(await page.locator('.chat-evidence-detail').count(),0);assert.ok(await page.locator('.chat-evidence-group').count()>0);
  if(width===1440){const separator=page.getByRole('separator',{name:'Resize evidence panel'});const before=await page.locator('.chat-evidence').boundingBox();await separator.focus();await separator.press('ArrowLeft');const after=await page.locator('.chat-evidence').boundingBox();assert.ok(after.width>before.width,'Keyboard resize expands panel');await page.mouse.move(after.x+2,after.y+100);await page.mouse.down();await page.mouse.move(after.x-40,after.y+100);await page.mouse.up();assert.ok((await page.locator('.chat-evidence').boundingBox()).width>after.width,'Pointer resize expands panel');}
  await page.locator('.chat-evidence-list button').first().click();await page.locator('.chat-evidence-detail blockquote').waitFor();await page.keyboard.press('Escape');await page.locator('.chat-citation').first().focus();await page.keyboard.press('Enter');await page.locator('.chat-evidence-detail blockquote').waitFor();assert.equal(await page.locator('.chat-citation[aria-pressed=true]').count(),1);
  if(width===390){await page.getByRole('button',{name:'Close evidence panel',exact:true}).press('Shift+Tab');assert.ok(await page.locator('.chat-evidence').evaluate(node=>node.contains(document.activeElement)));}
  await screenshot(page,`${width}-${mode}-research-evidence`);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.classList.contains('chat-citation'));
  // Scope selection is distinct from mentions; cancelling retains the current thread and references.
  await composer.fill('@August');await composer.press('Enter');assert.equal(await page.locator('.chat-mentions [data-entity-id]').getAttribute('data-entity-id'),augustine.id);await composer.fill('What does Augustine say about grace?');
  await selectScope(specimen.id);await page.getByRole('button',{name:'Keep current scope',exact:true}).click();assert.match(await page.locator('[data-chat-scope]').innerText(),/Entire vault/);assert.equal(await composer.inputValue(),'What does Augustine say about grace?');
  await selectScope(specimen.id);await page.getByRole('button',{name:'Start new conversation',exact:true}).click();assert.match(await page.locator('[data-chat-scope]').innerText(),/Synthetic grace notebook/);assert.equal(await composer.inputValue(),'What does Augustine say about grace?');assert.equal(await page.locator('.chat-mentions [data-entity-id]').getAttribute('data-entity-id'),augustine.id);
  // Failed retry keeps immutable question/context/depth and dispatches exactly once.
  await page.getByRole('button',{name:'Search more thoroughly',exact:true}).click();transportMode='error';await page.getByRole('button',{name:'Send message',exact:true}).click();await page.getByRole('button',{name:'Try again',exact:true}).waitFor({timeout:30000}).catch(async error=>{console.error(await page.locator('.chat-workspace').innerText());console.error(JSON.stringify({sent,requests:requests.length,errors}));throw error;});const failed=sent.at(-1);const users=await page.locator('.chat-message.is-user').count();await composer.fill('A next question drafted during recovery');transportMode='answer';const retryBefore=sent.length;await page.getByRole('button',{name:'Try again',exact:true}).dblclick();await page.locator('.chat-message.is-assistant').waitFor();assert.equal(sent.length,retryBefore+1);for(const key of ['question','scope','mentions','deep'])assert.deepEqual(sent.at(-1)[key],failed[key],`Retry preserves ${key}`);assert.equal(await page.locator('.chat-message.is-user').count(),users);assert.equal(await composer.inputValue(),'A next question drafted during recovery');
  await page.getByText('Response details',{exact:true}).click();assert.match(await page.locator('.chat-usage').innerText(),/pass|Thorough|evidence/i);
  // Interrupted regeneration keeps old answer and allows the next draft.
  transportMode='pending';let before=requests.length;const previous=await page.locator('.chat-message.is-assistant').innerText();await page.getByRole('button',{name:'Regenerate answer',exact:true}).click();await waitRequests(before);await composer.fill('Draft while Meno is busy');assert.equal(await composer.isEnabled(),true);assert.equal(await page.locator('.chat-message.is-assistant').innerText(),previous);const beforeStop=sent.length;await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Send message',exact:true}).waitFor().catch(async error=>{console.error('STOP STATE',await page.locator('.chat-workspace').innerText());console.error(JSON.stringify({errors,sent,cancellations}));throw error;});assert.equal(sent.length,beforeStop,'Stop never dispatches the next draft');assert.equal(await composer.inputValue(),'Draft while Meno is busy');assert.equal(await page.locator('.chat-message.is-assistant').innerText(),previous);transportMode='answer';
  // The confirmation contract is exercised while DELETE is intercepted; no stored thread is deleted.
  await options();await page.getByRole('button',{name:'Delete conversation',exact:true}).click();await page.getByRole('dialog',{name:'Delete conversation?',exact:true}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(deleteAttempts,0);await options();await page.getByRole('button',{name:'Delete conversation',exact:true}).click();await page.getByRole('button',{name:'Confirm delete',exact:true}).click();await page.locator('.chat-message').first().waitFor({state:'hidden'});assert.equal(deleteAttempts,1);
  // Temporary drafts are absent from storage and disappear on close/reopen.
  await options();await page.getByRole('checkbox',{name:'Temporary chat',exact:true}).check();await composer.fill('Private synthetic temporary draft');assert.doesNotMatch(await page.evaluate(()=>Object.values(sessionStorage).join('')),/Private synthetic temporary draft/);await page.getByRole('button',{name:'Close Chat',exact:true}).click();await openChat(page,width);assert.equal(await composer.inputValue(),'');assert.equal(await page.locator('.chat-message').count(),0);transportMode='pending';before=requests.length;await composer.fill('Private synthetic pending temporary question about grace');await composer.press('Enter');await waitRequests(before);await page.getByRole('button',{name:'Close Chat',exact:true}).click();transportMode='answer';await openChat(page,width);assert.equal(await composer.inputValue(),'');assert.equal(await page.locator('.chat-message').count(),0);assert.equal(await page.getByRole('button',{name:'Try again',exact:true}).count(),0);
  await geometry(page,width);await screenshot(page,`${width}-${mode}-research-header`);
  checks.push({width,mode,drafts:'switch and reload',evidence:'grouped index, verified inline detail, focus return',resize:width===1440?'keyboard and pointer':'mobile sheet focus trap',scope:'cancel/confirm preserve question and mention',retry:'same question mentions scope depth; duplicate click blocked',cancellation:'old answer and next draft retained',delete:'cancel and confirm, server DELETE intercepted',temporary:'memory only, close teardown',browser:'Chromium (not native Safari)'});await context.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(join(artifacts,'validation.json'),JSON.stringify({browser:await browser.version(),checks,errors,providerRequests:requests.length,liveProvider:false,cancellations},null,2));console.log(JSON.stringify({artifacts,checks,errors}));
} finally {
 if(browser)await browser.close();if(vite)await vite.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}files?.close();db?.close();globalThis.fetch=originalFetch;await rm(directory,{recursive:true,force:true});
}
