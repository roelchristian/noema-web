// Synthetic fixture only. Run with node --import tsx; see check-editor-browser.mjs
// for PLAYWRIGHT_MODULE and CHROMIUM_PATH setup. Artifacts stay outside live vaults.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourceReading} from '../src/server/modules/source-reading.ts';
import {createApp} from '../src/server/http.ts';
const readingTrace=[];
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-reading-browser-'));
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/workspace/noema-reading-evidence');await mkdir(artifacts,{recursive:true});
let vite,browser,api,db,store,files,backendPort;
async function startBackend(){db=openDatabase(join(directory,'db.sqlite'));store=new Store(db);files=new SourceFiles(store);api=createApp(store,join(repo,'dist/client'));api.listen(backendPort??0,'127.0.0.1');await once(api,'listening');backendPort=api.address().port;}
async function stopBackend(){await new Promise(resolve=>api.close(resolve));files.close();db.close();}
try{
 await startBackend();
 const text=Array.from({length:14},(_,i)=>`## Section ${i+1}: Synthetic scholarship\n\n`+Array.from({length:4},(_,j)=>`Synthetic passage ${i+1}.${j+1} considers ${['triangles','rectangles','pentagons','hexagons'][j]} and establishes a distinct fictional argument for this local reading fixture. Its evidence uses only invented examples, never live user data. This paragraph provides enough text to exercise stable passage anchors and scrolling.\n\n`).join('')).join('');
 const file=files.add('default','synthetic-reading.md',Buffer.from(text)),source=new Knowledge(store).create('default',{name:'Synthetic Treatise on Shapes',type:'source',attachmentIds:[file.id]});await files.tick();
 const original=files.require('default',file.id).text;
 await symlink(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
 await writeFile(join(directory,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="mount" style="width:100%"></div><script type="module" src="/fixture.tsx"></script></body></html>');
 await writeFile(join(directory,'fixture.tsx'),`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SourceReader} from '/@fs/${repo}/src/client/sources/SourceReader.tsx';
import {revealCitationTarget} from '/@fs/${repo}/src/client/sources/citation-navigation.ts';
import '/@fs/${repo}/src/client/styles/fonts.css';
import '/@fs/${repo}/src/client/styles/tokens.css';
import '/@fs/${repo}/src/client/styles.css';
import {visibleReadingOffset} from '/@fs/${repo}/src/client/sources/SourceReadingContinuity.tsx';
window.fixtureOffset=()=>visibleReadingOffset(document.querySelector('.source-reader-document'));
function App(){const [open,setOpen]=useState(true);return <><header className="topbar" style={{position:'fixed',top:0,width:'100%',height:56,background:'var(--surface-raised)',zIndex:30,display:'flex',gap:20,padding:12}}><strong>Noema · Synthetic local fixture</strong><button onClick={()=>setOpen(value=>!value)}>{open?'Close source':'Reopen source'}</button><button onClick={()=>{const target=Array.from(document.querySelectorAll('.source-reader-passage')).find(el=>el.textContent.includes('Synthetic passage 11.1'));revealCitationTarget(target);}}>Open distant citation</button></header><main style={{width:'100%',maxWidth:850,margin:'0 auto',padding:'90px 40px 100px'}}>{open&&<SourceReader vaultId="default" source={${JSON.stringify(source)}} entities={[]} onOpenEntity={()=>{}} onCreatePageFromSource={()=>{}} onError={()=>{}} onAddPassage={()=>{}} onAnnotate={()=>{}} onReadingNoteCreated={()=>{}} onOpenReadingNote={()=>{}} onRemoveReadingNote={()=>{}}/>}</main></>};createRoot(document.querySelector('#mount')).render(<App/>);`);
 vite=await createServer({configFile:false,root:directory,publicDir:join(repo,'public'),server:{host:'127.0.0.1',port:0,fs:{allow:[repo,directory]},proxy:{'/api':{target:`http://127.0.0.1:${backendPort}`,changeOrigin:false}}}});await vite.listen();
 const url=`http://127.0.0.1:${vite.httpServer.address().port}`;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();const errors=[];const observe=p=>{p.on('request',r=>{if(r.url().includes('reading-locations'))readingTrace.push({at:Date.now(),method:r.method(),body:r.postData(),url:r.url().split('/api/')[1]});});p.on('pageerror',e=>errors.push(e.message));p.on('response',async r=>{if(r.url().includes('reading-locations')&&!r.ok())console.log('API ERROR',r.status(),await r.text());});};observe(page);page.setDefaultTimeout(7000);
 await page.goto(url);await page.locator('.source-reader-passage').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Reading continuity"]'));
 assert.match(await page.locator('.source-reading-navigation').innerText(),/Section 1/);assert.doesNotMatch(await page.locator('.source-reading-navigation').innerText(),/%|Page/);
 async function readPassage(number){await page.evaluate(number=>{window.dispatchEvent(new WheelEvent('wheel'));const target=Array.from(document.querySelectorAll('.source-reader-passage')).find(el=>el.textContent.includes('Synthetic passage '+number));window.scrollBy({top:target.getBoundingClientRect().top-80,behavior:'instant'});},number);await page.waitForTimeout(500);}
 await readPassage('5.2');
 await page.getByRole('button',{name:'Passage bookmarks',exact:true}).click();await page.getByRole('textbox',{name:'New bookmark label'}).fill('Proof to revisit');
 await page.route('**/reading-locations/*',route=>route.request().method()==='PUT'&&!route.request().url().endsWith('/resume')?route.fulfill({status:503,contentType:'application/json',body:'{"error":"synthetic bookmark failure"}'}):route.continue());
 await page.getByRole('button',{name:'Bookmark passage',exact:true}).click();await page.getByRole('alert').filter({hasText:'Bookmark could not be saved'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'New bookmark label'}).inputValue(),'Proof to revisit');assert.equal(new SourceReading(store).continuity('default',file.id).bookmarks.length,0);await page.unroute('**/reading-locations/*');await page.getByRole('button',{name:'Bookmark passage',exact:true}).click();await page.getByRole('button',{name:'Proof to revisit'}).waitFor();
 assert.equal(new SourceReading(store).continuity('default',file.id).bookmarks.length,1);
 await page.screenshot({path:join(artifacts,'01-named-bookmark.png')});
 await page.getByRole('textbox',{name:'Bookmark label',exact:true}).fill('Argument to revisit');await page.getByRole('button',{name:'Save label',exact:true}).click();await page.getByRole('button',{name:'Argument to revisit'}).waitFor();
 await page.getByRole('button',{name:'Close bookmarks'}).click();
 const savedBefore=new SourceReading(store).continuity('default',file.id).resume;assert.ok(savedBefore?.anchor.offset>0);
 await context.close();await stopBackend();await startBackend();
 context=await browser.newContext({viewport:{width:1280,height:900}});page=await context.newPage();observe(page);page.setDefaultTimeout(7000);await page.goto(url);await page.getByRole('button',{name:'Continue reading',exact:true}).waitFor();
 // Reopening must not overwrite the durable anchor with the initial top-of-source position.
 await page.waitForTimeout(450);assert.equal(new SourceReading(store).continuity('default',file.id).resume.anchor.offset,savedBefore.anchor.offset);
 await page.screenshot({path:join(artifacts,'02-restart-continue-reading.png')});
 await page.getByRole('button',{name:'Continue reading',exact:true}).click();await page.waitForTimeout(450);assert.match(await page.locator('.source-reading-navigation').innerText(),/Section 5/);
 await page.getByRole('button',{name:'Return to reading',exact:false}).click();await readPassage('5.2');
 const beforeJump=await page.evaluate(()=>window.scrollY),beforeOffset=await page.evaluate(()=>window.fixtureOffset());
 await page.getByRole('button',{name:'Open distant citation'}).click();await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>window.scrollY)>beforeJump+1000);
 await page.screenshot({path:join(artifacts,'03-citation-return.png')});
 await page.getByRole('button',{name:'Return to reading',exact:false}).click();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.fixtureOffset()),beforeOffset);
 // Selecting text must preserve selection and avoid writing a new location.
 await page.waitForTimeout(400);const beforeSelection=new SourceReading(store).continuity('default',file.id).resume.anchor.offset;
 await page.evaluate(()=>{const leaf=Array.from(document.querySelectorAll('[data-source-start]')).find(el=>el.getBoundingClientRect().top>100&&el.getBoundingClientRect().bottom<innerHeight),range=document.createRange();range.selectNodeContents(leaf);getSelection().removeAllRanges();getSelection().addRange(range);});
 await page.waitForTimeout(450);assert.ok(await page.evaluate(()=>getSelection().toString().length>0));assert.equal(new SourceReading(store).continuity('default',file.id).resume.anchor.offset,beforeSelection);
 await page.evaluate(()=>getSelection().removeAllRanges());
 // A full original revision repeated twice is intentionally ambiguous.
 store.run('UPDATE source_files SET text=? WHERE id=?',original+'\n'+original,file.id);await page.reload();await page.getByRole('button',{name:'Passage bookmarks',exact:true}).click();await page.locator('.source-bookmark small').filter({hasText:'Ambiguous after source changes'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Argument to revisit'}).isDisabled(),true);await page.screenshot({path:join(artifacts,'04-ambiguous-revision.png')});
 await page.getByRole('textbox',{name:'Bookmark label',exact:true}).fill('Still needs checking');await page.getByRole('button',{name:'Save label',exact:true}).click();await page.getByRole('button',{name:'Still needs checking'}).waitFor();await page.getByRole('button',{name:'Remove bookmark',exact:true}).click();await page.getByText('No bookmarks yet.').waitFor();
 store.run('UPDATE source_files SET text=? WHERE id=?',original,file.id);await page.reload();await page.getByRole('button',{name:'Continue reading',exact:true}).waitFor();
 // Force save errors; the reader and bookmark panel remain usable.
 await page.route('**/reading-locations/resume',route=>route.fulfill({status:500,contentType:'application/json',body:'{"error":"synthetic persistence failure"}'}));await readPassage('7.2');await page.getByRole('alert').filter({hasText:'Reading position could not be saved'}).waitFor();assert.ok(await page.locator('.source-reader-passage').count()>30);await page.unroute('**/reading-locations/resume');
 await readPassage('8.1');await page.waitForTimeout(350);assert.equal(await page.getByRole('alert').filter({hasText:'Reading position could not be saved'}).count(),0);
 // Reload before the debounce completes; pagehide must flush the most recent anchor.
 await page.evaluate(()=>{window.dispatchEvent(new WheelEvent('wheel'));const target=Array.from(document.querySelectorAll('.source-reader-passage')).find(el=>el.textContent.includes('Synthetic passage 9.2'));window.scrollBy({top:target.getBoundingClientRect().top-80,behavior:'instant'});});await page.waitForTimeout(50);const reloadOffset=await page.evaluate(()=>window.fixtureOffset());await page.reload();await page.getByRole('button',{name:'Continue reading',exact:true}).waitFor();assert.equal(new SourceReading(store).continuity('default',file.id).resume.anchor.offset,reloadOffset);
 // Save and reopen the end-of-source state, then inspect a narrow viewport.
 await page.evaluate(()=>{window.dispatchEvent(new WheelEvent('wheel'));window.scrollTo(0,document.body.scrollHeight);});await page.waitForTimeout(500);assert.equal(new SourceReading(store).continuity('default',file.id).resume.anchor.atEnd,true);
 await page.getByRole('button',{name:'Close source',exact:true}).click();await page.getByRole('button',{name:'Reopen source',exact:true}).click();await page.getByRole('button',{name:'Continue reading · End of source',exact:true}).waitFor();
 for(let iteration=1;iteration<Number(process.env.NOEMA_READING_REPEAT??1);iteration++) {
  await page.getByRole('button',{name:'Continue reading · End of source',exact:true}).click();
  await page.evaluate(()=>{window.dispatchEvent(new WheelEvent('wheel'));window.scrollTo(0,document.body.scrollHeight);});
  await page.waitForTimeout(500);
  assert.equal(new SourceReading(store).continuity('default',file.id).resume.anchor.atEnd,true,`End anchor before repeat ${iteration}`);
  await page.getByRole('button',{name:'Close source',exact:true}).click();await page.getByRole('button',{name:'Reopen source',exact:true}).click();
  await page.getByRole('button',{name:'Continue reading · End of source',exact:true}).waitFor();
 }
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(artifacts,'05-mobile-end-of-source.png')});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);if(process.env.NOEMA_READING_TRACE)await writeFile(join(artifacts,'reading-trace.json'),JSON.stringify(readingTrace,null,2));
 console.log(JSON.stringify({browser:await browser.version(),closeReopenCycles:Number(process.env.NOEMA_READING_REPEAT??1),passed:['actual API/database/browser-context restart persistence','initial reopening preserves anchor','bookmark create/rename/delete','revision ambiguity and disabled destination','structural section progress (no invented pages or percent)','citation jump and one-action return','ordinary selection preserved without location write','nonblocking resume/bookmark persistence errors and retry','reload flush before debounce completes','end-of-source reopen','mobile viewport'],screenshots:artifacts,errors},null,2));
}catch(error){if(process.env.NOEMA_READING_TRACE)console.error('READING TRACE',JSON.stringify(readingTrace));if(browser){const pages=browser.contexts().flatMap(c=>c.pages());if(pages[0]){await pages[0].screenshot({path:join(artifacts,'failure.png')});console.error((await pages[0].locator('body').innerText()).slice(0,1700));}}throw error;}finally{if(browser)await browser.close();if(vite)await vite.close();if(api?.listening)await stopBackend();await rm(directory,{recursive:true,force:true});}
