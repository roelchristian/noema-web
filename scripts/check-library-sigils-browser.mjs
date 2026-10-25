// Render the real Library and application styles; no server or provider calls.
// Run with node --import tsx; uses the same optional browser setup as other checks.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {OrganizationLibrary} from '../src/client/organization/OrganizationLibrary.tsx';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/tmp/noema-library-sigils');
await mkdir(artifacts,{recursive:true});
const noop=()=>{},labels=['AI-generated content','AI writing edits accepted','Contains AI explanations','Edited after generation'];
const base={updated_at:'2026-10-17'},pages=[
 {...base,id:'combined',title:'Combined AI contributions',aiStatus:'ai_generated_edited',aiReviewAccepted:true,containsAIExplanations:true},
 {...base,id:'manual',title:'Manually created note',creationMethod:'manual_creation',aiStatus:'regular'},
 {...base,id:'unknown',title:'Historical note with no recorded contributions'},
 {...base,id:'generated',title:'Generated note',aiStatus:'ai_generated'},
 {...base,id:'accepted',title:'Accepted writing edits',aiStatus:'ai_assisted',aiReviewAccepted:true},
 {...base,id:'explanations',title:'Note containing explanations',containsAIExplanations:true},
];
const html=renderToStaticMarkup(React.createElement(OrganizationLibrary,{
 data:{collections:[],folders:[],locations:[],memberships:[],favourites:[]},vaultId:'sigils',pages,entities:[],favouritesOnly:false,context:{collection:'',folder:''},
 onContextChange:noop,onChanged:noop,onOpenPage:noop,onOpenEntity:noop,onOpenFolder:noop,onRenamePage:noop,onDeletePage:noop,onNewNote:noop,onError:noop,
}));
let vite,browser;const results=[],errors=[];
try{
 vite=await createServer({configFile:false,server:{host:'127.0.0.1',port:0}});await vite.listen();
 const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of [1440,390])for(const mode of ['light','dark'])for(const density of ['standard','comfortable','compact']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.route(origin+'/sigil-fixture',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html data-mode="${mode}" data-theme="ink" style="color-scheme:${mode}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${['styles/fonts.css','styles/tokens.css','styles.css'].map(file=>`<link rel="stylesheet" href="${origin}/src/client/${file}">`).join('')}</head><body><main style="padding:24px;width:100%">${html}</main></body></html>`}));
  await page.goto(origin+'/sigil-fixture');
  await page.locator('.organization-library').evaluate((element,density)=>element.dataset.density=density,density);
  await page.evaluate(()=>document.fonts.ready);
  for(const id of ['manual','unknown'])assert.equal(await page.locator(`[data-library-row="page:${id}"] .page-ai-library-status`).count(),0);
  for(const id of ['generated','accepted','explanations'])assert.equal(await page.locator(`[data-library-row="page:${id}"] .page-ai-history-icon`).count(),1);
  const icons=page.locator('[data-library-row="page:combined"] .page-ai-history-icon');assert.equal(await icons.count(),4);
  assert.deepEqual(await icons.evaluateAll(elements=>elements.map(e=>({role:e.getAttribute('role'),label:e.getAttribute('aria-label'),title:e.title,hidden:e.firstElementChild.getAttribute('aria-hidden')}))),labels.map(label=>({role:'img',label,title:label,hidden:'true'})));
  const metrics=await page.locator('.page-ai-library-status').evaluateAll(groups=>groups.map(group=>{
   const style=getComputedStyle(group),r=group.getBoundingClientRect(),probe=document.createElement('span');probe.style.color='var(--text-muted)';group.append(probe);const muted=getComputedStyle(probe).color;probe.remove();
   return {gap:style.gap,color:style.color,muted,background:style.backgroundColor,left:r.left,right:r.right,icons:[...group.querySelectorAll('svg')].map(e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return {width:b.width,height:b.height,center:b.y+b.height/2,stroke:s.stroke,background:s.backgroundColor};})};
  }));
  const size=density==='compact'?14:16;
  for(const group of metrics){
   assert.equal(group.gap,'4px');assert.equal(group.color,group.muted);assert.notEqual(group.color,'rgb(0, 0, 0)','Application theme tokens must be loaded');assert.equal(group.background,'rgba(0, 0, 0, 0)');assert.ok(group.left>=0&&group.right<=width,'Sigils must fit the viewport');
   for(const icon of group.icons){assert.equal(icon.width,size);assert.equal(icon.height,size);assert.equal(icon.stroke,group.color);assert.equal(icon.background,'rgba(0, 0, 0, 0)');assert.ok(Math.abs(icon.center-group.icons[0].center)<.1,'Sigils must share a centerline');}
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  await icons.first().hover();assert.equal(await icons.first().getAttribute('title'),labels[0]);
  const key=`${width}-${mode}-${density}`;await page.screenshot({path:resolve(artifacts,key+'.png')});results.push({key,size,metrics});await page.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(resolve(artifacts,'validation.json'),JSON.stringify({browser:await browser.version(),results,errors},null,2));
 console.log(JSON.stringify({browser:await browser.version(),passed:results.length,artifacts,errors}));
}finally{if(browser)await browser.close();if(vite)await vite.close();}
