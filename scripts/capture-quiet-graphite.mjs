// Matched, offline visual evidence. Uses only a disposable synthetic vault.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourcePassages} from '../src/server/modules/source-passages.ts';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),temp=await mkdtemp(join(tmpdir(),'noema-graphite-'));
const out=resolve(process.env.NOEMA_SCREENSHOTS??'output/quiet-graphite');await mkdir(out,{recursive:true});
let db,api,vite,browser;const captures=[],errors=[];
try {
 db=openDatabase(join(temp,'fixture.sqlite'));const store=new Store(db),knowledge=new Knowledge(store);
 const concept=knowledge.create('default',{name:'Philosophy of attention',type:'concept'});
 knowledge.create('default',{name:'Mira Vale',type:'person'});
 const text='On attention\n\nA quiet place for connected ideas. Knowledge grows through reading, reflection and the relationships between ideas.\n\nReading slowly gives each observation room to become a question.';
 const file=new SourceFiles(store).add('default','Synthetic reading.txt',Buffer.from(text));
 const source=knowledge.create('default',{name:'On attention — synthetic reading',type:'source',attachmentIds:[file.id]});
 store.run("UPDATE source_files SET text=?,status='ready',admitted=1 WHERE id=?",text,file.id);store.run('UPDATE entities SET inactive=0 WHERE id=?',source.id);new SourcePassages(store,t=>t.length).synchronize('default');
 api=createApp(store,join(repo,'dist/client'));api.listen(0,'127.0.0.1');await once(api,'listening');
 vite=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:0,proxy:{'/api':`http://127.0.0.1:${api.address().port}`}}});await vite.listen();
 const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of (process.env.NOEMA_THEME_WIDTHS?.split(',').map(Number)??[1440,390]))for(const mode of ['light','dark'])for(const theme of ['ink','juniper','atlantic'])for(const presentationMode of (process.env.NOEMA_PRESENTATIONS?.split(',')??['standard','subtle','focus'])) {
  const key=`${width}-${mode}-${theme}-${presentationMode}`,context=await browser.newContext({viewport:{width,height:960},isMobile:width===390,hasTouch:width===390,reducedMotion:'reduce'});
  await context.addInitScript(p=>localStorage.setItem('noema.appearance.v1',JSON.stringify(p)),{mode,theme,presentationMode});
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push({key,message:e.message}));
  await page.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  async function shot(screen){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(out,`${key}-${screen}.png`)});captures.push({key,screen,effectivePresentation:await page.evaluate(()=>({focusedReading:document.documentElement.dataset.focusedReading,focusWorkspace:document.documentElement.dataset.focusWorkspace}))});}
  async function nav(name){if(width===390)await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name,exact:true}).first().click();}
  await page.goto(base);await page.getByRole('button',{name:'A place for connected ideas',exact:false}).first().click();await page.locator('#page-title').waitFor();await shot('editor');
  // Escape Focus through its real UI before visiting navigation and overlays.
  if(presentationMode==='focus')await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Knowledge',exact:true}).click();await page.locator('.intelligence-panel').waitFor();await page.getByText('Finding related notes…',{exact:true}).waitFor({state:'hidden'});await page.getByText('Finding suggested sources…',{exact:true}).waitFor({state:'hidden'});await shot('knowledge-panel');await page.getByRole('button',{name:'Close Knowledge panel',exact:true}).click();
  await page.getByRole('button',{name:'More page actions',exact:true}).click();await page.getByRole('menuitem',{name:'Move to Trash',exact:true}).hover();await shot('menu');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'More page actions',exact:true}).click();await page.getByRole('menuitem',{name:'Rename',exact:true}).click();await page.locator('dialog[open]').waitFor();await shot('dialog');await page.keyboard.press('Escape');
  await nav('Knowledge entities');await page.locator('.library-heading-row').first().waitFor();await shot('knowledge');
  await page.goto(`${base}/?vault=default&view=entity&subject=${concept.id}`);await page.locator('.entity-home').first().waitFor();await shot('entity-home');
  await nav('Sources');await page.locator('.library-heading-row').first().waitFor();await shot('sources');
  await page.goto(`${base}/?vault=default&source=${source.id}`);await page.locator('.source-reader-passage').first().waitFor();await shot('source-reader');if(presentationMode==='focus')await page.keyboard.press('Escape');
  await nav('Pages');await page.locator('.library-heading-row').first().waitFor();await shot('library');
  await nav('Calendar');await page.locator('.calendar-grid').waitFor();await shot('calendar');
  if(width===390)await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:'Vault options',exact:true}).click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();await page.locator('.settings-modal[open]').waitFor();await shot('settings');
  await context.close();console.log(key);
 }
 assert.deepEqual(errors,[]);await writeFile(join(out,'manifest.json'),JSON.stringify({browser:await browser.version(),captures,errors,note:'Focus editor captured before exiting through UI; other screens use the resulting Subtle preference. No provider calls or real vault.'},null,2));
}finally{if(browser)await browser.close();if(vite)await vite.close();if(api){api.closeAllConnections();await new Promise(r=>api.close(r));}if(db)db.close();await rm(temp,{recursive:true,force:true});}
