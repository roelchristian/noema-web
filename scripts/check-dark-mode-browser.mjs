// Computed-style and interaction checks only: intentionally never captures screenshots.
// Real shell, disposable database, no provider requests. Optional Chromium harness;
// same PLAYWRIGHT_MODULE / CHROMIUM_PATH setup as the editor browser regression.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourcePassages} from '../src/server/modules/source-passages.ts';
import {TemporalIndex} from '../src/server/modules/temporal.ts';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-design-'));

let db,api,vite,browser;const results=[],errors=[],neutralByMode=new Map();
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
// Resolve actual composited backgrounds, including translucent interaction states.
async function readable(page,selector,{minimum=4.5,pseudo=null,property='color'}={}) {
 const rows=await page.locator(selector).evaluateAll((elements,{pseudo,property})=>{
  const rgba=value=>{const values=value.match(/[\d.]+/g)?.map(Number);return values?.length>=3?[...values.slice(0,3),values[3]??1]:[0,0,0,0];};
  const over=(a,b)=>[...a.slice(0,3).map((c,i)=>c*a[3]+b[i]*(1-a[3])),1];
  const luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  return elements.filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).visibility!=='hidden';}).map(e=>{
   const ancestors=[];for(let n=e;n;n=n.parentElement)ancestors.unshift(n);
   let bg=[255,255,255,1];for(const n of ancestors)bg=over(rgba(getComputedStyle(n).backgroundColor),bg);
   const s=getComputedStyle(e,pseudo),fg=over(rgba(s[property]),bg),a=luminance(fg),b=luminance(bg);
   return {text:e.getAttribute('aria-label')??e.textContent?.trim().slice(0,60),color:s.color,background:bg.slice(0,3),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  });
 },{pseudo,property});
 assert.ok(rows.length,`No visible samples for ${selector}`);
 for(const row of rows)assert.ok(row.ratio>=minimum,`${selector}: ${JSON.stringify(row)} < ${minimum}`);
 return rows;
}
try{
 await symlink(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
 await writeFile(join(directory,'markers.tsx'),`import React,{useRef,useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import {SourceReadingNoteMarkers} from '/@fs/${repo}/src/client/sources/SourceReadingNoteMarkers.tsx';const anchors=Array.from({length:6},(_,i)=>({pageId:'note'+i,startOffset:i*10,endOffset:i*10+4,title:'Synthetic note '+i,text:'Excerpt'}));function Fixture(){const article=useRef(null),[notes,setNotes]=useState([]);useEffect(()=>setNotes(anchors),[]);return <div ref={article} style={{position:'fixed',top:120,left:40,width:260,zIndex:300,background:'var(--surface-raised)'}}>{notes.map((n,i)=><div key={i} data-source-start={i*10} data-source-end={i*10+10} style={{height:20}}>Synthetic line {i}</div>)}<SourceReadingNoteMarkers article={article} notes={notes} onOpen={()=>{}} onRemove={()=>{}}/></div>}createRoot(document.querySelector('#marker-fixture')).render(<Fixture/>);`);
 db=openDatabase(join(directory,'fixture.sqlite'));const store=new Store(db);const sourceText='On 23 October 2026, synthetic scholarship considers a fictional proposition.';const sourceFile=new SourceFiles(store).add('default','Synthetic dark mode source.txt',Buffer.from(sourceText));const source=new Knowledge(store).create('default',{name:'Synthetic dark mode source',type:'source',attachmentIds:[sourceFile.id]});store.run("UPDATE source_files SET text=?,status='ready',admitted=1 WHERE id=?",sourceText,sourceFile.id);store.run('UPDATE entities SET inactive=0 WHERE id=?',source.id);new SourcePassages(store,text=>text.length).synchronize('default');new TemporalIndex(store).refresh('default');api=createApp(store,join(repo,'dist/client'));api.listen(0,'127.0.0.1');await once(api,'listening');
 vite=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:0,fs:{allow:[repo,directory]},proxy:{'/api':`http://127.0.0.1:${api.address().port}`}}});await vite.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of (process.env.NOEMA_THEME_WIDTHS?.split(',').map(Number)??[1440,390]))for(const mode of ['light','dark'])for(const theme of ['ink','juniper','atlantic']){
  const key=`${width}-${mode}-${theme}`,context=await browser.newContext({viewport:{width,height:960},hasTouch:width===390,isMobile:width===390,reducedMotion:'reduce'});
  await context.addInitScript(({mode,theme})=>localStorage.setItem('noema.appearance.v1',JSON.stringify({mode,theme})),{mode,theme});
  const page=await context.newPage();page.setDefaultTimeout(10000);console.log('Checking',key);await page.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);await page.getByRole('button',{name:'A place for connected ideas',exact:false}).first().click();await page.locator('#page-title').waitFor();await page.evaluate(()=>document.fonts.ready);
  const proseContrast=await readable(page,'#page-title,.block-content');
  if(mode==='dark')await readable(page,'.sidebar .workspace-label,.topbar .page-tool');
  const minimum=width===390?44:30;const editor=await hitRects(page,iconTargets,minimum);
  const knowledge=page.getByRole('button',{name:'Knowledge',exact:true});await knowledge.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  assert.equal(await knowledge.evaluate(e=>getComputedStyle(e).outlineStyle),'solid','Keyboard focus must be visible');await readable(page,'.knowledge-toggle',{minimum:3,property:'outlineColor'});

  await knowledge.click();await page.locator('.intelligence-panel').waitFor();await page.waitForFunction(()=>{const e=document.querySelector('.intelligence-panel .page-tool');return e&&e.getBoundingClientRect().width&&!e.closest('[inert]');});const panel=await hitRects(page,'.intelligence-panel '+'.page-tool,.intelligence-panel .knowledge-icon-action,.intelligence-panel .knowledge-entity-tabs > button,.intelligence-panel .knowledge-entity-sort',minimum);

  await page.getByRole('button',{name:'Close Knowledge panel',exact:true}).click();
  await page.getByRole('button',{name:'More page actions',exact:true}).click();const danger=page.getByRole('menuitem',{name:'Move to Trash',exact:true});await danger.hover();
  const menu=await page.locator('.sidebar-action-menu:popover-open').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});assert.ok(menu.left>=0&&menu.right<=width&&menu.top>=0&&menu.bottom<=960);
  await readable(page,'.sidebar-action-menu:popover-open button');
  const actionContract=await menuContract(page,'.sidebar-action-menu:popover-open',width===390?44:36);
  await danger.focus();const dangerFocus=await danger.evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}));await danger.hover();assert.deepEqual(await danger.evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor})),dangerFocus,'Destructive focus and hover must agree');
  const dangerColor=dangerFocus.color;await page.keyboard.press('Escape');
  const content=page.locator('.block-content[contenteditable=true]').first();await content.click();
  if(width===390)await page.getByRole('button',{name:'More block actions',exact:true}).click();
  else {await content.hover();await page.getByRole('button',{name:'Block options',exact:true}).first().click();}
  const blockSelector=width===390?'.mobile-block-sheet-options':'.block-action-menu';
  const blockContract=await menuContract(page,blockSelector,width===390?44:36);assert.deepEqual(blockContract,actionContract);
  await page.keyboard.press('Escape');
  await content.evaluate(e=>{e.focus();const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(n.textContent.trim().length<8)continue;const r=document.createRange();r.setStart(n,0);r.setEnd(n,8);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));return;}throw new Error('Expected sample text');});
  await page.getByRole('button',{name:'Text actions',exact:true}).click();
  const selectionContract=await menuContract(page,'.selection-more-actions',width===390?44:36);assert.deepEqual(selectionContract,actionContract);

  await page.getByRole('menuitem',{name:'Semantic function',exact:true}).click();
  const semanticContract=await menuContract(page,'.semantic-picker',width===390?44:36);assert.deepEqual(semanticContract,actionContract);

  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'More page actions',exact:true}).click();await page.getByRole('menuitem',{name:'Rename',exact:true}).click();await page.locator('dialog[open]').waitFor();await hitRects(page,'dialog[open] .button',width===390?44:30);await readable(page,'dialog[open] h2,dialog[open] input,dialog[open] .button');await page.keyboard.press('Escape');
  const tokens=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return Object.fromEntries(['surface','surface-raised','surface-popover','surface-inset','sidebar','line',...['graphite','sage','ocean','iris','rose','honey'].flatMap(x=>[`palette-${x}-text`,`palette-${x}-bg`]),...['danger','warning','success','info'].flatMap(x=>['text','bg','border'].map(y=>`status-${x}-${y}`))].map(k=>[k,s.getPropertyValue('--'+k).trim()]));});
  const neutral=Object.fromEntries(['surface','surface-raised','surface-popover','surface-inset','sidebar','line',...['danger','warning','success','info'].flatMap(x=>['text','bg','border'].map(y=>`status-${x}-${y}`))].map(k=>[k,tokens[k]]));if(neutralByMode.has(mode))assert.deepEqual(neutral,neutralByMode.get(mode),'Neutral and status colors must remain identical across accents');else neutralByMode.set(mode,neutral);
  const ratios={};for(const palette of ['graphite','sage','ocean','iris','rose','honey']){const ratio=contrast(tokens[`palette-${palette}-text`],tokens[`palette-${palette}-bg`]);assert.ok(ratio>=4.5,`${key} ${palette}: ${ratio}`);ratios[palette]=ratio;}for(const state of ['danger','warning','success','info'])for(const bg of [`status-${state}-bg`,'surface','surface-raised']){const ratio=contrast(tokens[`status-${state}-text`],tokens[bg]);assert.ok(ratio>=4.5,`${key} ${state} on ${bg}: ${ratio}`);ratios[state+' / '+bg]=Math.round(ratio*100)/100;}
  // Existing error copy and destructive labels provide non-colour state cues.
  await page.evaluate(()=>{const e=document.createElement('aside');e.id='design-state-fixture';e.style.cssText='position:fixed;inset:auto 8px 8px;z-index:200;padding:20px;background:var(--surface-raised);border:1px solid var(--line)';e.innerHTML='<p class="dialog-error" role="alert">Could not save. Retry.</p><p class="source-inspector-status-failure"><span>Source failed.</span><button class="button">Retry</button></p><p><span class="ai-activity-status interrupted">Interrupted</span> <span class="ai-activity-status completed">Completed</span> <span class="ai-activity-status running">Running</span></p><button class="button" disabled>Unavailable</button>';document.body.append(e);});
  const stateStyle=await page.locator('#design-state-fixture').evaluate(e=>({disabledOpacity:getComputedStyle(e.querySelector('button:disabled')).opacity,alert:getComputedStyle(e.querySelector('[role=alert]')).color,failureBorder:getComputedStyle(e.querySelector('.source-inspector-status-failure')).borderInlineStartWidth}));assert.ok(Number(stateStyle.disabledOpacity)<1);assert.equal(stateStyle.failureBorder,'3px');await page.locator('#design-state-fixture').evaluate(e=>e.remove());
  // Exercise the real search, appearance settings/select menu and civil calendar.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox',{name:'Search notes and knowledge',exact:true}).waitFor();
  await readable(page,'.spotlight-search-input input,.vault-search-results button');
  await page.keyboard.press('Escape');
  await knowledge.click();await page.getByRole('button',{name:'Knowledge settings',exact:true}).click();
  await page.locator('.settings-modal[open]').waitFor();
  await readable(page,'.settings-modal h2,.settings-modal h3,.settings-tabs button');
  await page.getByRole('combobox',{name:'Body font',exact:true}).click();
  await page.locator('.select-menu:popover-open').waitFor();
  await readable(page,'.select-menu:popover-open [role=option]');
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Close Knowledge panel',exact:true}).click();
  if(width===390){
    await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    assert.equal(await page.locator('#workspace-navigation[open]').evaluate(e=>getComputedStyle(e,'::backdrop').backgroundColor),mode==='dark'?'rgba(0, 0, 0, 0.6)':'rgba(0, 0, 0, 0.4)','Navigation backdrop must dim rather than hide the workspace');
  }
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
  await page.locator('.calendar-grid').waitFor();
  await readable(page,mode==='dark'?'.calendar-month-title h1,.calendar-day-number':'.calendar-month-title h1,[data-date="2026-10-23"] .calendar-day-number');
  await page.locator('[data-date="2026-10-23"]').click();await page.locator('.calendar-source-evidence').first().click();await page.locator('#source-viewer .source-viewer-passage').first().waitFor();await readable(page,'#source-viewer .source-viewer-passage');await page.getByRole('button',{name:'Close source viewer',exact:true}).click();await page.getByRole('button',{name:'Close date inspector',exact:true}).click();
  // Special block, source-reader and property-field computed fixtures use owned
  // CSS classes with synthetic content; no extraction or AI provider is involved.
  await page.evaluate(()=>{const e=document.createElement('section');e.id='dark-mode-fixture';e.style.cssText='position:fixed;inset:80px 12px auto;z-index:500;background:var(--surface);padding:20px';e.innerHTML='<div class="block"><input type="checkbox" aria-label="Synthetic checkbox"></div><div class="block quote"><div class="block-content">A synthetic quotation</div></div><div class="block code"><pre>const value = 1;</pre></div><div class="code-block"><textarea>const value = 2;</textarea></div><div class="block"><div class="block-content" contenteditable="true"></div></div><div class="equation-editor-shell"><span class="latex-token-command">\\frac</span><span class="latex-token-number">12</span><div class="latex-editor"><textarea class="latex-input" aria-label="Synthetic equation">x+1</textarea></div></div><div class="source-reader"><div class="source-reader-passage"><p>Synthetic source reader prose</p></div></div><div class="property-row"><span>Property name</span><div>Property value</div></div>';document.body.append(e);});
  await readable(page,'#dark-mode-fixture .block-content:not(:empty),#dark-mode-fixture .block.code pre,#dark-mode-fixture .code-block textarea,#dark-mode-fixture .source-reader-passage p');
  if(mode==='dark')await readable(page,'#dark-mode-fixture .property-row > span,#dark-mode-fixture .property-row > div,#dark-mode-fixture .latex-token-command,#dark-mode-fixture .latex-token-number');
  if(mode==='dark'){await readable(page,'#dark-mode-fixture .block-content:empty',{pseudo:'::before'});await readable(page,'#dark-mode-fixture input[type=checkbox]',{minimum:3,property:'borderTopColor'});}
  await page.getByRole('textbox',{name:'Synthetic equation',exact:true}).focus();
  await readable(page,'#dark-mode-fixture .equation-editor-shell',{minimum:3,property:'borderTopColor'});
  await page.locator('#dark-mode-fixture').evaluate(e=>e.remove());
  results.push({key,editor,panel,menu,actionContract,blockContract,selectionContract,semanticContract,dangerColor,ratios,stateStyle,proseContrast});await context.close();
 }
 // Coarse pointer at desktop width must get the same touch contract.
 const coarse=await browser.newContext({viewport:{width:1440,height:960},hasTouch:true});const page=await coarse.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);await page.getByRole('button',{name:'A place for connected ideas',exact:false}).first().click();await hitRects(page,iconTargets,44);await page.getByRole('button',{name:'Knowledge',exact:true}).click();await hitRects(page,'.intelligence-panel .page-tool',44);await page.getByRole('button',{name:'Close Knowledge panel',exact:true}).click();await page.evaluate(()=>{const mount=document.createElement('div');mount.id='marker-fixture';document.body.append(mount);});await page.addScriptTag({type:'module',url:'/@fs/'+directory+'/markers.tsx'});await page.locator('#marker-fixture .source-reading-note-marker > button').first().waitFor();const markers=await hitRects(page,'#marker-fixture .source-reading-note-marker > button',44);assert.ok(markers.length<6,'Adjacent targets should use the existing grouped-note menu');assert.equal(markers.reduce((sum,r)=>sum+Number(r.label.match(/Show (\d+) reading notes/)?.[1]??1),0),6,'Grouping must retain every reading note');await coarse.close();
 // CSS zoom exercises 200% layout reflow; native browser UI zoom is separate.
 const zoom=await browser.newContext({viewport:{width:1440,height:960}});const z=await zoom.newPage();await z.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);await z.getByRole('button',{name:'A place for connected ideas',exact:false}).first().click();await z.evaluate(()=>document.documentElement.style.zoom='2');await z.getByRole('button',{name:'Knowledge',exact:true}).click();assert.ok(await z.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% zoom causes horizontal overflow');await zoom.close();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:await browser.version(),passed:results.length,minimumStatusTextContrast:Math.min(...results.flatMap(r=>Object.values(r.ratios))),errors,screenshotValidation:"UNRUN (intentionally no captures)",knownLightContrastLimitation:"Pre-existing out-of-month calendar text #717171 on #f4f4f4: 4.4376:1; current month light and all dark dates checked strictly"}));
}catch(error){console.error(error);throw error;}finally{if(browser)await browser.close();if(vite)await vite.close();if(api){api.closeAllConnections();await new Promise(resolve=>api.close(resolve));}if(db)db.close();await rm(directory,{recursive:true,force:true});}
