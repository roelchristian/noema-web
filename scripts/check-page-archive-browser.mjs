// Synthetic, in-memory end-to-end archive checks. No provider credentials or calls.
// Install playwright-core externally and pass PLAYWRIGHT_MODULE if needed.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/http.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const db=openDatabase(':memory:');
const ai=new Intelligence({read:()=>null,write(){},remove(){}},async()=>{throw new Error('Provider calls forbidden in archive browser fixture');});
const server=createApp(new Store(db),resolve('dist/client'),ai);
let browser;
try {
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 async function api(path,method='GET',body){const response=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json','X-Noema-Request':'1','X-Vault-Id':'default'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;}
 const created=await api('pages','POST',{title:'Synthetic archive browser note'});
 const pageData=await api('pages/'+created.id,'PUT',{...created,blocks:[{id:'synthetic-body',type:'paragraph',checked:false,content:[{text:'Synthetic historical evidence to preserve.'}]}]});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/?vault=default&page='+created.id);
 await page.getByRole('textbox',{name:'Page title',exact:true}).waitFor();
 // Archive waits for the pending title autosave before the lifecycle transition.
 await page.getByRole('textbox',{name:'Page title',exact:true}).fill('Synthetic archived title after autosave');
 await page.getByRole('button',{name:'More page actions',exact:true}).click();
 await page.getByRole('menuitem',{name:'Archive',exact:true}).click();
 await page.getByRole('button',{name:'Undo',exact:true}).waitFor();
 let archived=await api('pages/'+created.id);assert.ok(archived.archived_at);assert.equal(archived.title,'Synthetic archived title after autosave');
 assert.deepEqual(archived.blocks,pageData.blocks);assert.ok(!(await api('pages')).some(note=>note.id===created.id));
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('[role="status"]')?.textContent?.includes('Page archived.'));
 assert.equal((await api('pages/'+created.id)).archived_at,null);
 // Explicit scope searches archived text; default search stays active-only.
 const current=await api('pages/'+created.id);archived=await api('pages/'+created.id+'/archive','PUT',{revision:current.revision});
 await page.goto(base+'/?vault=default&page='+created.id);
 await page.getByText('Archived · Read-only',{exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Page title',exact:true}).getAttribute('readonly'),'');
 assert.equal(await page.locator('[contenteditable="true"]').count(),0);
 assert.equal((await api('search/text','POST',{query:'historical'})).results.some(note=>note.id===created.id),false);
 assert.equal((await api('search/text','POST',{query:'historical',scope:{all:true,includeArchived:true}})).results.some(note=>note.id===created.id),true);
 await page.goto(base+'/?vault=default&view=archive');
 await page.getByRole('heading',{name:'Archive',exact:true}).waitFor();
 await page.getByRole('button',{name:'Synthetic archived title after autosave',exact:true}).waitFor();
 for(const mode of ['Compact','Grid','List']){await page.getByRole('button',{name:mode+' view',exact:true}).click();assert.equal(await page.locator('[data-library-destination="archive"]').getAttribute('data-layout'),mode.toLowerCase());}
 await page.getByRole('searchbox',{name:'Filter archived pages'}).fill('no synthetic match');
 await page.getByText('No archived pages match these filters.').waitFor();
 await page.getByRole('searchbox',{name:'Filter archived pages'}).fill('');
 await page.getByRole('checkbox',{name:'Select all archived pages'}).check();
 await page.getByRole('button',{name:'Restore selected (1)'}).click();
 await page.getByText('No archived pages.',{exact:true}).waitFor();
 assert.equal((await api('pages/'+created.id)).archived_at,null);
 assert.deepEqual(errors,[]);
 console.log('Archive browser checks passed: autosave, archive/undo, direct links, read-only, search scopes, layouts, filtering and batch restore.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
