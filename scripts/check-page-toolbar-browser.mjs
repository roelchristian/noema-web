// Synthetic toolbar fixture: no vault, network services, or paid calls.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'noema-page-toolbar-'));
let server,browser;
try {
 await symlink(join(repo,'node_modules'),join(dir,'node_modules'),'dir');
 await writeFile(join(dir,'index.html'),'<!doctype html><style>body{display:block!important;margin:0}#root{width:100%;display:block!important}.fixture-shell{width:100%}.fixture-shell.panel{width:calc(100% - 320px)}@media(max-width:750px){.fixture-shell.panel{width:100%}}[aria-label=Activity]{min-width:44px;min-height:44px}</style><div id="root"></div><script type="module" src="/fixture.tsx"></script>');
 await writeFile(join(dir,'fixture.tsx'),`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import '/@fs/${repo}/src/client/styles/tokens.css';import '/@fs/${repo}/src/client/styles.css';import '/@fs/${repo}/src/client/editor/page-toolbar.css';
import {PageToolbar} from '/@fs/${repo}/src/client/editor/PageToolbar.tsx';import {useAppearance} from '/@fs/${repo}/src/client/settings/useAppearance.ts';
import {PresentationSelector} from '/@fs/${repo}/src/client/settings/PresentationSelector.tsx';
function App(){const {appearance,setAppearance,exitFocus}=useAppearance();const [panel,setPanel]=useState(false),[headings,setHeadings]=useState(true),[locked,setLocked]=useState(false),[archived,setArchived]=useState(false),[blocks,setBlocks]=useState([{id:'p',type:'paragraph',content:[{text:'**Markdown**'}]}]);
const [old,setOld]=useState(null),[redo,setRedo]=useState(null);const change=(next)=>{setOld(blocks);setBlocks(next)};
return <><button id="headings" onClick={()=>setHeadings(!headings)}>Headings</button><button id="lock" onClick={()=>setLocked(!locked)}>Lock fixture</button><button id="archive" onClick={()=>setArchived(!archived)}>Archive fixture</button><div className={'fixture-shell'+(panel?' panel':'')}><header className="topbar"><nav id="breadcrumb"><span>Very long preceding location / </span><span className="breadcrumb-label">An exceptionally long current page title that should truncate sensibly without displacing document actions</span></nav><div id="page-identity-tools"/><div className="top-actions"><PageToolbar page={{id:'synthetic',vault_id:'fixture',blocks,editLocked:locked,archived_at:archived?'today':null}} favourite={false} onOrganizationChange={()=>{}} onError={console.error} onDelete={async()=>{}} onAI={()=>setPanel(!panel)} aiOpen={panel} presentationMode={appearance.presentationMode} onPresentationModeChange={presentationMode=>setAppearance(x=>({...x,presentationMode}))} onExitFocus={exitFocus} onUndo={()=>{setRedo(blocks);setBlocks(old);setOld(null)}} onRedo={()=>{setOld(blocks);setBlocks(redo);setRedo(null)}} canUndo={!!old} canRedo={!!redo} onChangeBlocks={change} onFeaturedImageChange={()=>{}} onRevealInSidebar={()=>{}} onEditLockChange={async value=>setLocked(value)} onRestore={async()=>setArchived(false)} onArchive={async()=>setArchived(true)} tocAvailable={headings} onToggleToc={()=>{}}/><button aria-label="Activity">Bell</button></div></header></div><output id="mode">{appearance.presentationMode}</output><output id="blocks">{JSON.stringify(blocks)}</output>{appearance.presentationMode==='focus'&&<button onClick={exitFocus}>Exit Focus</button>}</>};createRoot(document.getElementById('root')).render(<App/>);`);
 server=await createServer({root:dir,server:{host:'127.0.0.1',port:0,fs:{allow:[repo,dir]}}});await server.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:'More page actions',exact:true}).waitFor();
 const more=()=>page.getByRole('button',{name:'More page actions',exact:true}).click();
 await page.getByRole('button',{name:'Subtle',exact:true}).click();await page.getByRole('button',{name:'Focus',exact:true}).click();await page.getByRole('button',{name:'Exit Focus',exact:true}).last().click();assert.equal(await page.locator('#mode').textContent(),'subtle');
 await more();assert.ok(await page.getByRole('menuitem',{name:/Find in page/}).locator('kbd').isVisible());await page.keyboard.press('Escape');
 for(const width of [1600,1120,800,390,320]){
  await page.setViewportSize({width,height:900});
  if(width===1120)await page.getByRole('button',{name:'Show page knowledge',exact:true}).click();
  const geometry=await page.locator('.topbar').evaluate(el=>{const box=el.getBoundingClientRect();return {viewport:innerWidth,ancestors:[el.parentElement,document.getElementById('root'),document.body].map(e=>({cls:e.className,width:e.getBoundingClientRect().width,display:getComputedStyle(e).display})),width:box.width,scroll:el.scrollWidth,client:el.clientWidth,buttons:[...el.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>({label:b.getAttribute('aria-label')||b.textContent,left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))}});
  assert.ok(geometry.scroll<=geometry.client+1,JSON.stringify({width,...geometry}));assert.ok(geometry.buttons.every(b=>b.left>=0&&b.right<=width+1),JSON.stringify({width,...geometry}));
  if(width<=390){assert.ok(await page.getByRole('button',{name:'View',exact:true}).isVisible());assert.ok(geometry.buttons.every(b=>b.width>=44&&b.height>=44),JSON.stringify(geometry));}
  await more();await page.keyboard.press('Escape');assert.ok(await page.getByRole('button',{name:'More page actions',exact:true}).evaluate(el=>el===document.activeElement));
 }
 const original=await page.locator('#blocks').textContent();
 await more();await page.getByRole('menuitem',{name:'Editing',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'Markdown shortcuts while typing',exact:true}).click();assert.equal(await page.locator('#blocks').textContent(),original);
 await more();await page.getByRole('menuitem',{name:'Editing',exact:true}).click();await page.getByRole('menuitem',{name:'Format existing Markdown…',exact:true}).click();await page.getByRole('menuitem',{name:'Format current page',exact:true}).click();const formatted=await page.locator('#blocks').textContent();assert.notEqual(formatted,original);
 for(const [command,expected] of [['Undo',original],['Redo',formatted]]){await more();await page.getByRole('menuitem',{name:'Editing',exact:true}).click();await page.getByRole('menuitem',{name:command,exact:true}).click();assert.equal(await page.locator('#blocks').textContent(),expected);}
 await page.locator('#headings').click();assert.equal(await page.locator('.page-toolbar-reading').count(),0);
 await page.locator('#lock').click();await more();assert.ok(await page.getByRole('menuitem',{name:/Unlock editing/,exact:false}).count());await page.keyboard.press('Escape');
 await page.locator('#archive').click();await more();await page.getByRole('menuitem',{name:'Restore page',exact:true}).click();
 assert.deepEqual(errors,[]);console.log('Page toolbar: wide/narrow available containers, open inspector, long identity, headings, lock/archive, Focus restore, shortcut and Escape checks passed.');
} finally {await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true});}
