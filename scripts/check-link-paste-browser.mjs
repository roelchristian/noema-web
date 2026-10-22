// Actual app with a disposable database and synthetic website clipboard data.
// Run after build with node --import tsx; see check-editor-browser for Playwright setup.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-links-'));
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/workspace/noema-link-evidence');await mkdir(artifacts,{recursive:true});
let db,api,vite,browser;const errors=[],results=[];
try {
 db=openDatabase(join(directory,'fixture.sqlite'));api=createApp(new Store(db),join(repo,'dist/client'));api.listen(0,'127.0.0.1');await once(api,'listening');
 vite=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:`http://127.0.0.1:${api.address().port}`,changeOrigin:false}}}});await vite.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const initialBlocks=db.prepare("SELECT blocks FROM pages WHERE id='welcome'").get().blocks;
 for(const width of [1440,390]) {
  db.prepare("UPDATE pages SET blocks=?,revision=revision+1 WHERE id='welcome'").run(initialBlocks);
  const context=await browser.newContext({viewport:{width,height:960},hasTouch:width===390,permissions:['clipboard-read','clipboard-write']});
  context.setDefaultTimeout(5000);
  const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);await page.getByRole('button',{name:'A place for connected ideas',exact:false}).first().click();
  const host=page.locator('.block-content[contenteditable=true]').first();await host.waitFor();
  await host.evaluate(e=>{e.focus();const r=document.createRange();r.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(r);});
  const href='https://example.test/article?q=%26&lang=en#section%202';
  const html=`<p>Read <a href="${href.replace('&','&amp;')}" onclick="alert(1)"><strong>linked</strong> <em>phrase $price$</em></a> and <a href="https://second.test/">another source</a>. <a href="mailto:writer@example.test">Email</a> <a href="javascript:alert(1)">unsafe</a></p>`;
  await page.evaluate(async html=>navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob(['Fallback label'],{type:'text/plain'})})]),html);
  await page.keyboard.press('Control+v');await host.locator('a').first().waitFor();
  assert.equal(await host.innerText(),'Read linked phrase $price$ and another source. Email unsafe');
  assert.equal(await host.locator('.external-link-indicator').count(),2);
  assert.equal(await host.locator('a').first().getAttribute('href'),href);
  assert.equal(await host.locator('a[onclick],a[href^="javascript:"]').count(),0);
  assert.equal(await host.locator('a[href^="mailto:"] .external-link-indicator').count(),0);
  await page.keyboard.press('Control+z');await page.waitForFunction(()=>!document.querySelector('.block-content[contenteditable=true] a[href^="https://example.test"]'));
  await page.keyboard.press('Control+Shift+z');await host.locator('a[href^="https://example.test"]').first().waitFor();
  // Normal clicks edit; a noncollapsed selection never navigates.
  const initialURL=page.url();await host.locator('a').first().click();assert.equal(page.url(),initialURL);
  const popupPromise=context.waitForEvent('page');
  await host.locator('a').first().click({modifiers:['Control']});
  const popup=await popupPromise;await popup.close();
  const keyboardPopup=context.waitForEvent('page');await host.locator('a').first().focus();await page.keyboard.press('Enter');await(await keyboardPopup).close();
  assert.equal(await page.locator('.mention .external-link-indicator,[data-source-reference] .external-link-indicator').count(),0);
  // Empty decoration must not consume an extra arrow step at the end of a link.
  const boundary=await host.evaluate(e=>{e.focus();const n=e.querySelectorAll('a')[3].firstChild,r=document.createRange();r.setStart(n,n.length-1);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);const prefix=r.cloneRange();prefix.selectNodeContents(e);prefix.setEnd(r.startContainer,r.startOffset);return prefix.toString().length;});
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  const afterBoundary=await host.evaluate(e=>{const r=getSelection().getRangeAt(0).cloneRange();r.setStart(e,0);return r.toString().length;});assert.equal(afterBoundary,boundary+2);
  // Copy the actual DOM selection and check both native clipboard formats.
  await host.evaluate(e=>{e.focus();const r=document.createRange();r.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(r);});
  await page.keyboard.press('Control+c');
  const copied=await page.evaluate(async()=>{const item=(await navigator.clipboard.read())[0];return {text:await(await item.getType('text/plain')).text(),html:await(await item.getType('text/html')).text()};});
  assert.equal(copied.text,'Read linked phrase $price$ and another source. Email unsafe');assert.ok(!copied.html.includes('external-link-indicator'));assert.ok(copied.html.includes('https://example.test'));
  await page.keyboard.press('Control+x');assert.equal(await host.textContent(),'');
  await page.keyboard.press('Control+z');await host.locator('a[href^="https://example.test"]').first().waitFor();
  assert.equal(await host.locator('.external-link-indicator').count(),2);
  // Save through the normal page shortcut, then reload the persisted page.
  await host.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Control+s');
  await page.waitForTimeout(1200);await page.reload();await host.waitFor();await host.locator('a[href^="https://example.test"]').first().waitFor();assert.equal(await host.locator('.external-link-indicator').count(),2);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(artifacts,`links-${width}.png`),fullPage:true});
  // Arrow navigation, typing, and IME retain link formatting and text offsets.
  await host.evaluate(e=>{e.focus();const n=e.querySelector('a strong').firstChild,r=document.createRange();r.setStart(n,2);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);});
  await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>getSelection().anchorOffset),3);
  await page.keyboard.type('X');assert.ok((await host.textContent()).includes('linXked'));
  const cdp=await context.newCDPSession(page);await cdp.send('Input.imeSetComposition',{text:'語',selectionStart:1,selectionEnd:1});await cdp.send('Input.insertText',{text:'語'});
  assert.ok((await host.textContent()).includes('linX語ked'));
  assert.equal(await host.locator('.external-link-indicator').count(),2);
  const beforeFormatting=await host.textContent();
  await host.evaluate(e=>{e.focus();const n=e.querySelector('a strong').firstChild,r=document.createRange();r.setStart(n,0);r.setEnd(n,2);getSelection().removeAllRanges();getSelection().addRange(r);});
  await page.keyboard.press('Control+b');assert.equal(await host.textContent(),beforeFormatting);
  assert.equal(await host.locator('.external-link-indicator').count(),2);assert.equal(await host.locator('a').first().getAttribute('href'),href);
  await page.keyboard.press('Control+s');await page.keyboard.press('ArrowRight');await page.evaluate(()=>getSelection().removeAllRanges());
  // Plain text still pastes literally without inventing a destination.
  await host.evaluate(e=>{e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);});
  await page.evaluate(()=>navigator.clipboard.writeText(' plain fallback'));await page.keyboard.press('Control+v');assert.ok((await host.textContent()).endsWith(' plain fallback'));
  results.push({width,icons:2,passed:['rich native paste','formatting/literal labels','safe destinations','undo/redo','edit click','copy/cut text and HTML','modified click and focused-link Enter','icon boundary arrows','save/reload','arrows/typing/IME/formatting','plain paste']});
  await context.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:await browser.version(),results,screenshots:artifacts,errors},null,2));
} finally {if(browser)await browser.close();if(vite)await vite.close();if(api){api.closeAllConnections();await new Promise(r=>api.close(r));}db?.close();await rm(directory,{recursive:true,force:true});}
