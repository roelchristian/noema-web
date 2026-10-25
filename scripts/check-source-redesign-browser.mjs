// Synthetic API fixtures only: no vault, provider, or model calls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,symlink,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';
import {processedSourceDocument} from '../src/server/modules/source-document.ts';
import {sourceDocumentEntries} from '../src/shared/source-document.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-source-redesign-'));
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/workspace/noema-source-redesign-evidence');await mkdir(artifacts,{recursive:true});
const text=Array.from({length:18},(_,i)=>`## Chapter ${i+1}: Printed heading ${i+1}\n\nSynthetic passage ${i+1} retains printed theorem 3.14 and the quotation “keep this exact”.\n\nA second fictional paragraph discusses shapes and contains a modem example for review.\n\n`).join('');
const file={id:'synthetic',vault_id:'default',entity_id:'source',name:'synthetic.txt',format:'pdf',status:'ready',admitted:1,text,textHash:'canonical-hash',pages:1,page_start_lines:'[1]',structural_nodes:'[]',enrichment_status:'completed',generated_name:null,language:'en',source_url:null};
file.document=processedSourceDocument(file);
const source={id:'source',name:'Synthetic Source',subtypes:[],updated_at:'2026-10-24T00:00:00Z'};
const at=text.indexOf('modem'),node=sourceDocumentEntries(file.document).filter(({node})=>node.text!==undefined&&node.range.startOffset<=at&&node.range.endOffset>at).sort((a,b)=>(a.node.range.endOffset-a.node.range.startOffset)-(b.node.range.endOffset-b.node.range.startOffset))[0].node;
let revision={id:'revision-1',fileId:file.id,createdAt:'2026-10-24T01:00:00Z',updatedAt:'2026-10-24T01:00:00Z',status:'completed',acceptanceMode:'balanced',baseHash:createHash('sha256').update(JSON.stringify({text,document:file.document})).digest('hex'),stale:false,instructions:'',original:{text,document:file.document},reprocessed:{text,document:file.document},nodeLinks:sourceDocumentEntries(file.document).map(({node})=>({originalNodeId:node.id,reprocessedNodeIds:[node.id]})),patches:[{id:'patch-1',nodeIds:[node.id],range:{...node.range,startOffset:at,endOffset:at+5,startPage:1,endPage:1},original:'modem',replacement:'modern',category:'ocr',reason:'Synthetic OCR proposal requires source evidence.',confidence:.99,decision:'pending',riskReasons:['Independent source evidence is unavailable.']}],report:{model:'fixture',reasoningEffort:'low',promptVersion:'synthetic',startedAt:null,finishedAt:null,durationMs:0,chunksTotal:1,chunksCompleted:1,charactersTotal:text.length,charactersReviewed:text.length,inputTokens:0,outputTokens:0,reasoningTokens:0,cachedInputTokens:0,diagnostics:[],error:null}};
revision.reprocessed={text:text.replace('A second fictional','An editorial fictional'),document:processedSourceDocument({...file,text:text.replace('A second fictional','An editorial fictional')})};
let vite,browser;const errors=[],requests=[];
try{
 await symlink(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
 await writeFile(join(directory,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.tsx"></script>');
 await writeFile(join(directory,'fixture.tsx'),`import React from 'react';import {createRoot} from 'react-dom/client';import {SourceReader} from '/@fs/${repo}/src/client/sources/SourceReader.tsx';import '/@fs/${repo}/src/client/styles/tokens.css';import '/@fs/${repo}/src/client/styles.css';const noop=()=>{};createRoot(document.getElementById('root')).render(<main className="source-workspace" style={{width:'100%',margin:0}}><div id="content"><SourceReader vaultId="default" source={${JSON.stringify(source)}} entities={[]} onOpenEntity={noop} onCreatePageFromSource={noop} onError={console.error} onAddPassage={noop} onAnnotate={noop} onReadingNoteCreated={noop} onOpenReadingNote={noop} onRemoveReadingNote={noop}/></div></main>);`);
 vite=await createServer({configFile:false,root:directory,publicDir:join(repo,'public'),server:{hmr:false,host:'127.0.0.1',port:0,fs:{allow:[repo,directory]}}});await vite.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const initialRevision=structuredClone(revision);for(const width of [1440,1024,390]) for(const mode of ['light','dark']) {revision=structuredClone(initialRevision);
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method();requests.push({path,method});let value;
  if(path==='/api/entities/source')value={attachments:[file]};
  else if(path==='/api/source-files/synthetic')value=file;
  else if(path.endsWith('/reading-locations'))value={resume:null,bookmarks:[]};
  else if(path.endsWith('/highlights')||path.endsWith('/reading-notes'))value=[];
  else if(path.endsWith('/reprocessing')){const {original,reprocessed,patches,nodeLinks,...summary}=revision;value=[{...summary,patchCount:patches.length,pendingCount:patches.filter(p=>p.decision==='pending').length}];}
  else if(path.endsWith('/review')){const body=req.postDataJSON();revision={...revision,updatedAt:new Date().toISOString(),patches:revision.patches.map(p=>{const d=body.decisions.find(d=>d.patchId===p.id);return d?{...p,decision:d.decision,...(d.replacement!==undefined?{userReplacement:d.replacement}:{})}:p;})};value=revision;}
  else if(path.endsWith('/revision-1'))value=revision;
  else if(path.endsWith('/evidence'))value={originalAvailable:true,rawExtraction:{pageEvidence:[{page:1,method:'native',text:'Synthetic original PDF evidence.'}]}};
  else if(path.includes('/page-image/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="white"/><text x="20" y="40">Synthetic original page</text></svg>'});
  else if(path.endsWith('/resume')&&method==='PUT')value={};
  else {errors.push(`Unexpected API: ${method} ${path}`);return route.fulfill({status:500,body:'{}'});}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
 await page.evaluate(mode=>{document.documentElement.dataset.mode=mode;},mode);await page.locator('.source-reader-passage').first().waitFor();
 await page.getByRole('button',{name:'Review changes (1)',exact:true}).waitFor();
 assert.equal(await page.locator('.reprocessing-reviews').count(),0,'Review is opt-in');
 assert.equal(await page.locator('.source-reader-document').count(),1);
 assert.match(await page.locator('.source-reader-document').innerText(),/Printed heading 1/);
 const picker=page.getByRole('combobox',{name:'Reading version',exact:true});
 await picker.selectOption('revision-1');assert.equal(await page.evaluate(()=>localStorage.getItem('noema:source-reading:default:synthetic')),null,'Viewing a revision does not set its preference');await page.getByRole('button',{name:'Set as preferred reading version',exact:true}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('noema:source-reading:default:synthetic')),'revision-1');
 await page.waitForFunction(()=>document.querySelector('.source-reader-document')?.textContent.includes('An editorial fictional'));
 assert.equal(await page.locator('[aria-label="Reading continuity"]').count(),0,'Editorial offsets never reach canonical continuity tools');
 assert.equal(await page.locator('.source-reader-document').count(),1);
 assert.equal(requests.filter(r=>r.method==='POST'&&!r.path.endsWith('/review')).length,0,'Version switching never starts processing');
 await picker.selectOption('original');
 await page.waitForFunction(()=>document.querySelector('.source-reader-document')?.textContent.includes('A second fictional'));
 await page.getByRole('button',{name:'Review changes (1)',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.classList.contains('reprocessing-reviews')).catch(async error=>{console.log(await page.evaluate(()=>({active:document.activeElement?.outerHTML,review:document.querySelector('.reprocessing-reviews')?.getBoundingClientRect().toJSON(),hostHidden:document.querySelector('.source-reader-review-host')?.hidden})));throw error;});
 const row=page.locator('.reprocessing-patch-list li>button').first();
 await row.click();await row.focus();await row.press('ArrowDown');await page.waitForTimeout(50);await row.press('ArrowDown');await page.waitForTimeout(50);
 assert.equal(await row.evaluate(element=>document.activeElement===element),true,'Canonical passage scrolling preserves review keyboard focus');
 assert.equal(await page.locator('.reprocessing-reviews').count(),1,'Locating a passage keeps review open');
 const bounds=await page.evaluate(()=>({reader:document.querySelector('.source-reader-document').getBoundingClientRect().right,drawer:document.querySelector('.reprocessing-reviews').getBoundingClientRect().left}));
 const sideBySide=await page.locator('.source-reader-content').isVisible();if(sideBySide)assert.ok(bounds.reader<=bounds.drawer,'Desktop document remains beside the review panel');else assert.equal(await page.locator('.source-reader-content').isVisible(),false,'Narrow review has a separate correction surface');
 await page.screenshot({path:join(artifacts,`review-${width}-${mode}.png`),fullPage:false});
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 await page.getByRole('textbox',{name:'Edit suggested replacement',exact:true}).fill('modernised');
 const returnControl=()=>page.locator(sideBySide?'.reprocessing-context-return button':'.source-reader-evidence-return');const correction=page.locator('.reprocessing-patch-list li>button[aria-pressed=true]');const correctionText=await correction.innerText();
 await page.getByRole('button',{name:'Show original passage',exact:true}).click();await returnControl().waitFor({state:'visible'});assert.equal(await page.locator('.source-reader-document').isVisible(),true);if(!sideBySide){await page.keyboard.press('Escape');await page.getByRole('textbox',{name:'Edit suggested replacement',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>document.activeElement?.classList.contains('reprocessing-reviews'));await page.getByRole('button',{name:'Show original passage',exact:true}).click();await returnControl().waitFor({state:'visible'});}await returnControl().click();await page.waitForFunction(()=>document.activeElement?.classList.contains('reprocessing-reviews'));await page.getByRole('textbox',{name:'Edit suggested replacement',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>document.activeElement?.classList.contains('reprocessing-reviews'));assert.equal(await correction.innerText(),correctionText);assert.equal(await page.getByRole('textbox',{name:'Edit suggested replacement',exact:true}).inputValue(),'modernised');
 await page.getByRole('button',{name:'Compare PDF page 1',exact:true}).click();await page.getByRole('img',{name:'Source PDF physical page 1',exact:true}).waitFor({state:'visible'});assert.equal(await page.getByRole('combobox',{name:'Evidence page',exact:true}).inputValue(),'1');if(sideBySide){await page.getByRole('button',{name:'Show original passage',exact:true}).click();assert.equal(await page.locator('.source-reader-document').isVisible(),true);assert.equal(await page.getByRole('img',{name:'Source PDF physical page 1',exact:true}).count(),0);}await returnControl().click();await page.waitForFunction(()=>document.activeElement?.classList.contains('reprocessing-reviews'));await page.getByRole('textbox',{name:'Edit suggested replacement',exact:true}).waitFor({state:'visible'});assert.equal(await page.getByRole('textbox',{name:'Edit suggested replacement',exact:true}).inputValue(),'modernised');
 await page.getByRole('button',{name:'Accept edited change',exact:true}).click();
 await page.getByRole('button',{name:'Review changes (0)',exact:true}).waitFor();
 assert.equal(revision.patches[0].decision,'accepted');assert.equal(revision.patches[0].userReplacement,'modernised');
 await page.locator('.reprocessing-history-filters > summary').click();await page.getByRole('button',{name:/^Applied manually/}).click();
 await page.getByRole('button',{name:'Reverse applied change',exact:true}).click();
 await page.getByRole('button',{name:/^Rejected/}).click();
 await page.getByRole('button',{name:'Return to review',exact:true}).click();
 await page.getByRole('button',{name:'Review changes (1)',exact:true}).waitFor();
 assert.equal(revision.patches[0].decision,'pending');
 assert.equal(file.text,text,'Review never mutates canonical source fixture');
 await page.getByRole('button',{name:/^Pending/}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Layout fits viewport');await page.keyboard.press('Escape');await page.locator('.reprocessing-reviews').waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'Review changes (1)',exact:true}).evaluate(el=>el===document.activeElement),true);await page.getByRole('button',{name:'Review changes (1)',exact:true}).click();await page.locator('.reprocessing-reviews').waitFor({state:'visible'});await page.close();console.log(`Source workspace passed ${width}px ${mode}`);}
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:['one document renderer','opt-in review','printed headings preserved','version switching without AI requests','pending decision count','review keyboard focus','desktop document beside drawer','edited acceptance and reversal','canonical text unchanged','six width/theme combinations','original and PDF evidence preserve drafts','explicit preferred reading action','initial and return keyboard focus','narrow evidence Escape','PDF to original continuity'],requests:requests.length,screenshots:artifacts},null,2));
}finally{await browser?.close();await vite?.close();await rm(directory,{recursive:true,force:true});}
