// Real shell, disposable database, no provider requests. Optional Chromium harness;
// same PLAYWRIGHT_MODULE / CHROMIUM_PATH setup as the editor browser regression.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-design-'));
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??join(directory,'screenshots'));await mkdir(artifacts,{recursive:true});
let db,api,vite,browser;const results=[],errors=[];
const iconTargets='.page-tool,.knowledge-icon-action,.intelligence-panel .knowledge-entity-tabs > button,.knowledge-entity-sort,.workspace-history button,.page-toolbar > .sidebar-menu-trigger';
async function hitRects(page,selector,minimum){
 const rects=await page.locator(selector).evaluateAll(elements=>elements.filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[inert]');}).map(e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const top=document.elementFromPoint(x,y);return {label:e.getAttribute('aria-label')??e.textContent?.trim(),width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,reachable:e.disabled||e.contains(top)};}));
 assert.ok(rects.length,'Expected visible controls');for(const r of rects){assert.ok(r.width>=minimum-.1&&r.height>=minimum-.1,`Undersized ${JSON.stringify(r)}`);assert.ok(r.right<=await page.evaluate(()=>innerWidth)+.1&&r.left>=-.1,`Clipped ${JSON.stringify(r)}`);assert.ok(r.reachable,`Covered target ${JSON.stringify(r)}`);}
 for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];assert.ok(Math.min(a.right,b.right)-Math.max(a.left,b.left)<.5||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<.5,`Overlapping hit areas ${a.label} / ${b.label}`);}
 return rects;
}
// One shared computed contract across actual action, block and selection menus.
async function menuContract(page,selector,minimum){
 const menu=page.locator(selector),rows=menu.locator('button');await rows.first().waitFor();
 const styles=await rows.evaluateAll(items=>items.map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {height:r.height,minHeight:s.minHeight,padding:s.padding,gap:s.gap,radius:s.borderRadius,font:s.fontSize,color:s.color};}));
 for(const row of styles)assert.ok(row.height>=minimum,JSON.stringify(row));
 for(const row of await rows.all()){await row.scrollIntoViewIfNeeded();assert.ok(await row.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'Menu row must remain reachable when scrolled into view');}
 const slot=await rows.first().evaluate(e=>{const glyph=e.firstElementChild,s=getComputedStyle(glyph);return glyph.getBoundingClientRect().width+parseFloat(s.marginLeft)+parseFloat(s.marginRight);});assert.equal(slot,20,'Shared leading icon slot');
 const focus=menu.locator('button:not(:disabled)').first();await page.keyboard.press('ArrowDown');await focus.focus();
 const ring=await focus.evaluate(e=>{const s=getComputedStyle(e);return {style:s.outlineStyle,width:s.outlineWidth,offset:s.outlineOffset,color:s.outlineColor,accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()};});
 assert.equal(ring.style,'solid');assert.equal(ring.width,'2px');assert.equal(ring.offset,'-2px');
 return {minHeight:styles[0].minHeight,padding:styles[0].padding,gap:styles[0].gap,radius:styles[0].radius,font:styles[0].font,slot,focusColor:ring.color};
}
function contrast(a,b){const luminance=hex=>{const raw=hex.trim().replace('#','');const v=(raw.length===3?raw.split('').map(c=>c+c).join(''):raw).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
try{
 await symlink(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
 await writeFile(join(directory,'markers.tsx'),`import React,{useRef,useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import {SourceReadingNoteMarkers} from '/@fs/${repo}/src/client/sources/SourceReadingNoteMarkers.tsx';const anchors=Array.from({length:6},(_,i)=>({pageId:'note'+i,startOffset:i*10,endOffset:i*10+4,title:'Synthetic note '+i,text:'Excerpt'}));function Fixture(){const article=useRef(null),[notes,setNotes]=useState([]);useEffect(()=>setNotes(anchors),[]);return <div ref={article} style={{position:'fixed',top:120,left:40,width:260,zIndex:300,background:'var(--surface-raised)'}}>{notes.map((n,i)=><div key={i} data-source-start={i*10} data-source-end={i*10+10} style={{height:20}}>Synthetic line {i}</div>)}<SourceReadingNoteMarkers article={article} notes={notes} onOpen={()=>{}} onRemove={()=>{}}/></div>}createRoot(document.querySelector('#marker-fixture')).render(<Fixture/>);`);
 db=openDatabase(join(directory,'fixture.sqlite'));api=createApp(new Store(db),join(repo,'dist/client'));api.listen(0,'127.0.0.1');await once(api,'listening');
 vite=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:0,fs:{allow:[repo,directory]},proxy:{'/api':`http://127.0.0.1:${api.address().port}`}}});await vite.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of [1440,390])for(const mode of ['light','dark'])for(const theme of ['ink','juniper','atlantic']){
  const key=`${width}-${mode}-${theme}`,context=await browser.newContext({viewport:{width,height:960},hasTouch:width===390,isMobile:width===390,reducedMotion:'reduce'});
  await context.addInitScript(({mode,theme})=>localStorage.setItem('noema.appearance.v1',JSON.stringify({mode,theme})),{mode,theme});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${process.env.NOEMA_BROWSER_PRODUCTION==='1'?api.address().port:vite.httpServer.address().port}`);await page.getByRole('button',{name:'A place for connected ideas',exact:false}).first().click();await page.locator('#page-title').waitFor();await page.evaluate(()=>document.fonts.ready);
  const minimum=width===390?44:30;const editor=await hitRects(page,iconTargets,minimum);
  const knowledge=page.getByRole('button',{name:'Knowledge',exact:true});await knowledge.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  assert.equal(await knowledge.evaluate(e=>getComputedStyle(e).outlineStyle),'solid','Keyboard focus must be visible');
  await page.screenshot({path:join(artifacts,key+'-editor.png')});
  await knowledge.click();await page.locator('.intelligence-panel').waitFor();await page.waitForFunction(()=>{const e=document.querySelector('.intelligence-panel .page-tool');return e&&e.getBoundingClientRect().width&&!e.closest('[inert]');});const panel=await hitRects(page,'.intelligence-panel '+'.page-tool,.intelligence-panel .knowledge-icon-action,.intelligence-panel .knowledge-entity-tabs > button,.intelligence-panel .knowledge-entity-sort',minimum);
  await page.screenshot({path:join(artifacts,key+'-knowledge.png')});
  await page.getByRole('button',{name:'Close Knowledge panel',exact:true}).click();
  await page.getByRole('button',{name:'More page actions',exact:true}).click();const danger=page.getByRole('menuitem',{name:'Move to Trash',exact:true});await danger.hover();
  const menu=await page.locator('.sidebar-action-menu:popover-open').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});assert.ok(menu.left>=0&&menu.right<=width&&menu.top>=0&&menu.bottom<=960);await page.screenshot({path:join(artifacts,key+'-menu.png')});
  const actionContract=await menuContract(page,'.sidebar-action-menu:popover-open',width===390?44:36);
  await danger.focus();const dangerFocus=await danger.evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}));await danger.hover();assert.deepEqual(await danger.evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor})),dangerFocus,'Destructive focus and hover must agree');
  const dangerColor=dangerFocus.color;await page.keyboard.press('Escape');
  const content=page.locator('.block-content[contenteditable=true]').first();await content.click();
  if(width===390)await page.getByRole('button',{name:'More block actions',exact:true}).click();
  else {await content.hover();await page.getByRole('button',{name:'Block options',exact:true}).first().click();}
  const blockSelector=width===390?'.mobile-block-sheet-options':'.block-action-menu';
  const blockContract=await menuContract(page,blockSelector,width===390?44:36);assert.deepEqual(blockContract,actionContract);
  await page.screenshot({path:join(artifacts,key+'-block-menu.png')});await page.keyboard.press('Escape');
  await content.evaluate(e=>{e.focus();const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(n.textContent.trim().length<8)continue;const r=document.createRange();r.setStart(n,0);r.setEnd(n,8);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));return;}throw new Error('Expected sample text');});
  await page.getByRole('button',{name:'Text actions',exact:true}).click();
  const selectionContract=await menuContract(page,'.selection-more-actions',width===390?44:36);assert.deepEqual(selectionContract,actionContract);
  await page.screenshot({path:join(artifacts,key+'-selection-menu.png')});
  await page.getByRole('menuitem',{name:'Semantic function',exact:true}).click();
  const semanticContract=await menuContract(page,'.semantic-picker',width===390?44:36);assert.deepEqual(semanticContract,actionContract);
  await page.screenshot({path:join(artifacts,key+'-semantic-menu.png')});
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'More page actions',exact:true}).click();await page.getByRole('menuitem',{name:'Rename',exact:true}).click();await page.locator('dialog[open]').waitFor();await page.screenshot({path:join(artifacts,key+'-dialog.png')});await hitRects(page,'dialog[open] .button',width===390?44:30);await page.keyboard.press('Escape');
  // Settings uses the shared select, including native light dismiss and keyboard focus.
  if(width===390)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:'Vault options',exact:true}).click();
  await page.getByRole('menuitem',{name:'Settings',exact:true}).click();
  const language=page.getByRole('combobox',{name:'Language',exact:true});
  await language.click();await page.locator('.select-menu:popover-open').waitFor();
  assert.equal(await page.locator('.select-menu:popover-open').evaluate(e=>getComputedStyle(e).fontSize),'13px');
  await language.click();await page.waitForFunction(()=>!document.querySelector('.select-menu:popover-open'));
  await page.keyboard.press('ArrowDown');await page.locator('.select-menu:popover-open').waitFor();
  await page.keyboard.press('End');await page.keyboard.press('Home');await page.keyboard.press('Enter');
  assert.ok(await language.evaluate(e=>e===document.activeElement));
  await language.click();await page.keyboard.press('Escape');
  assert.ok(await page.locator('dialog.settings-modal').evaluate(e=>e.open));
  assert.ok(await page.getByRole('combobox',{name:'Indent width',exact:true}).isDisabled());
  await page.screenshot({path:join(artifacts,key+'-settings.png')});
  await page.getByRole('button',{name:'Done',exact:true}).click();
  const tokens=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return Object.fromEntries(['surface','surface-raised',...['danger','warning','success','info'].flatMap(x=>['text','bg','border'].map(y=>`status-${x}-${y}`))].map(k=>[k,s.getPropertyValue('--'+k).trim()]));});
  const ratios={};for(const state of ['danger','warning','success','info'])for(const bg of [`status-${state}-bg`,'surface','surface-raised']){const ratio=contrast(tokens[`status-${state}-text`],tokens[bg]);assert.ok(ratio>=4.5,`${key} ${state} on ${bg}: ${ratio}`);ratios[state+' / '+bg]=Math.round(ratio*100)/100;}
  // Existing error copy and destructive labels provide non-colour state cues.
  await page.evaluate(()=>{const e=document.createElement('aside');e.id='design-state-fixture';e.style.cssText='position:fixed;inset:auto 8px 8px;z-index:200;padding:20px;background:var(--surface-raised);border:1px solid var(--line)';e.innerHTML='<p class="dialog-error" role="alert">Could not save. Retry.</p><p class="source-inspector-status-failure"><span>Source failed.</span><button class="button">Retry</button></p><p><span class="ai-activity-status interrupted">Interrupted</span> <span class="ai-activity-status completed">Completed</span> <span class="ai-activity-status running">Running</span></p><button class="button" disabled>Unavailable</button>';document.body.append(e);});
  const stateStyle=await page.locator('#design-state-fixture').evaluate(e=>({disabledOpacity:getComputedStyle(e.querySelector('button:disabled')).opacity,alert:getComputedStyle(e.querySelector('[role=alert]')).color,failureBorder:getComputedStyle(e.querySelector('.source-inspector-status-failure')).borderInlineStartWidth}));assert.ok(Number(stateStyle.disabledOpacity)<1);assert.equal(stateStyle.failureBorder,'3px');await page.screenshot({path:join(artifacts,key+'-states.png')});await page.locator('#design-state-fixture').evaluate(e=>e.remove());
  results.push({key,editor,panel,menu,actionContract,blockContract,selectionContract,semanticContract,dangerColor,ratios,stateStyle});await context.close();
 }
 // Coarse pointer at desktop width must get the same touch contract.
 const coarse=await browser.newContext({viewport:{width:1440,height:960},hasTouch:true});const page=await coarse.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);await page.getByRole('button',{name:'A place for connected ideas',exact:false}).first().click();await hitRects(page,iconTargets,44);await page.getByRole('button',{name:'Knowledge',exact:true}).click();await hitRects(page,'.intelligence-panel .page-tool',44);await page.getByRole('button',{name:'Close Knowledge panel',exact:true}).click();await page.evaluate(()=>{const mount=document.createElement('div');mount.id='marker-fixture';document.body.append(mount);});await page.addScriptTag({type:'module',url:'/@fs/'+directory+'/markers.tsx'});await page.locator('#marker-fixture .source-reading-note-marker > button').first().waitFor();const markers=await hitRects(page,'#marker-fixture .source-reading-note-marker > button',44);assert.ok(markers.length<6,'Adjacent targets should use the existing grouped-note menu');assert.equal(markers.reduce((sum,r)=>sum+Number(r.label.match(/Show (\d+) reading notes/)?.[1]??1),0),6,'Grouping must retain every reading note');await page.screenshot({path:join(artifacts,'dense-reading-note-targets.png')});await coarse.close();
 // CSS zoom exercises 200% layout reflow; native browser UI zoom is separate.
 const zoom=await browser.newContext({viewport:{width:1440,height:960}});const z=await zoom.newPage();await z.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);await z.getByRole('button',{name:'A place for connected ideas',exact:false}).first().click();await z.evaluate(()=>document.documentElement.style.zoom='2');await z.getByRole('button',{name:'Knowledge',exact:true}).click();assert.ok(await z.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% zoom causes horizontal overflow');await z.screenshot({path:join(artifacts,'200-percent-css-zoom.png')});await zoom.close();
 assert.deepEqual(errors,[]);await writeFile(join(artifacts,'validation.json'),JSON.stringify({browser:await browser.version(),results,errors,zoom:'CSS zoom at 200%; native UI zoom not exercised'},null,2));console.log(JSON.stringify({browser:await browser.version(),passed:results.length,minimumStatusTextContrast:Math.min(...results.flatMap(r=>Object.values(r.ratios))),artifacts,errors}));
}finally{if(browser)await browser.close();if(vite)await vite.close();if(api)await new Promise(resolve=>api.close(resolve));if(db)db.close();await rm(directory,{recursive:true,force:true});}
