// Disposable synthetic database. Network and AI providers are blocked.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {proposeValue,rawSourceHash} from '../src/server/modules/property-provenance.ts';
import {DOMAINS,TAXONOMY_VERSION} from '../src/shared/domains.ts';
import {scholarlyEnrichmentVersion} from '../src/shared/source-scholarly.ts';
import {createApp} from '../src/server/http.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const db=openDatabase(':memory:'),store=new Store(db);
const ai=new Intelligence({read:()=>null,write(){},remove(){}},async()=>{throw new Error('Real provider calls forbidden');});
const server=createApp(store,resolve('dist/client'),ai),directory=process.env.NOEMA_SCREENSHOTS??'/tmp/noema-bibliography-evidence';
let browser;const errors=[];
try {
 await mkdir(directory,{recursive:true});server.listen(0,'127.0.0.1');await once(server,'listening');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const base=`http://127.0.0.1:${server.address().port}`;
 const openDetails=async()=>{await page.getByRole('tab',{name:'Overview',exact:true}).click();const disclosure=page.locator('#entity-panel details.entity-context-details').filter({has:page.locator('summary',{hasText:/^Identity and property details$/})});if(!await disclosure.evaluate(element=>element.open))await disclosure.locator(':scope > summary').click();};
 await page.goto(base+'/?vault=default&view=entities&type=source');
 if(!await page.getByRole('button',{name:'Import bibliography',exact:true}).count())await page.getByRole('button',{name:'Sources',exact:true}).first().click();
 const open=async()=>{await page.getByRole('button',{name:'Import bibliography',exact:true}).click();await page.getByRole('textbox',{name:'BibTeX / BibLaTeX',exact:true}).fill('@book{Synthetic2026,title={Synthetic Bibliography Study},author={{Synthetic Group}},year={2026},doi={10.5555/synthetic},custom={retained}}');};
 // Cancellation before commit never creates a Source.
 await open();await page.getByRole('button',{name:'Review import',exact:true}).click();await page.getByRole('combobox',{name:'Import decision for Synthetic2026'}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(store.get('SELECT count(*) n FROM bibliographic_records').n,0);
 // Real local API import and retry produce one stable metadata-only Source.
 await open();await page.getByRole('button',{name:'Review import',exact:true}).click();await page.getByRole('button',{name:'Import reviewed entries',exact:true}).click();await page.getByRole('status').filter({hasText:'1 created'}).waitFor();
 const record=store.get('SELECT * FROM bibliographic_records');assert.ok(record);assert.equal(store.get('SELECT count(*) n FROM source_files WHERE entity_id=?',record.source_id).n,0);
 await page.getByRole('button',{name:'Review import',exact:true}).click();const decision=page.getByRole('combobox',{name:'Import decision for Synthetic2026'});await decision.waitFor();assert.equal(await decision.inputValue(),'skip');await decision.selectOption(record.source_id);await page.getByRole('button',{name:'Import reviewed entries',exact:true}).click();await page.getByRole('status').filter({hasText:'1 skipped'}).waitFor();assert.equal(store.get('SELECT count(*) n FROM bibliographic_records').n,1);
 // A conflicting import requires a field decision; keeping current preserves authored facts.
 await page.getByRole('textbox',{name:'BibTeX / BibLaTeX',exact:true}).fill('@book{Synthetic2026,title={Imported alternative},author={{Synthetic Group}},year={2026},doi={10.5555/synthetic},custom={retained}}');
 await page.getByRole('button',{name:'Review import',exact:true}).click();await page.getByRole('combobox',{name:'Import decision for Synthetic2026'}).selectOption(record.source_id);
 assert.equal(await page.getByRole('button',{name:'Import reviewed entries',exact:true}).isEnabled(),false);
 await page.getByRole('combobox',{name:'Resolve title for Synthetic2026'}).selectOption('current');await page.getByRole('button',{name:'Import reviewed entries',exact:true}).click();await page.getByRole('status').filter({hasText:'1 updated'}).waitFor();
 assert.equal(JSON.parse(store.get('SELECT fields_json FROM bibliographic_records').fields_json).title,'Synthetic Bibliography Study');
 store.run("INSERT INTO properties(id,entity_id,name,value) VALUES('browser-legacy-publisher',?,'publisher','Preserved Press')",record.source_id);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.screenshot({path:join(directory,'sources-desktop.png')});
 // Open the Source inspector directly through the app's entity route.
 await page.goto(base+'/?vault=default&source='+record.source_id+'&entity='+record.source_id);
 await openDetails();
 const editor=page.locator('.bibliography-editor').last();await editor.getByText('Verify DOI metadata',{exact:true}).waitFor();
 assert.equal(await editor.getByRole('button',{name:'Look up DOI',exact:true}).isEnabled(),false);
 // Canonical editor reconciles conflicting legacy properties without overwriting them.
 await editor.getByLabel('publisher',{exact:true}).fill('Canonical Press');await editor.getByRole('button',{name:'Save bibliographic facts',exact:true}).click();
 await editor.getByRole('heading',{name:'Review preserved authored properties',exact:true}).waitFor();assert.equal(await editor.getByRole('button',{name:'Save reviewed facts',exact:true}).isEnabled(),false);
 await editor.locator('[aria-label="Authored property reconciliation"] input').check();await editor.getByRole('button',{name:'Save reviewed facts',exact:true}).click();await editor.getByRole('status').filter({hasText:'Bibliographic record saved'}).waitFor();assert.equal(store.get("SELECT value FROM properties WHERE id='browser-legacy-publisher'").value,'Preserved Press');
 let lookup=0;
 await page.route('**/api/bibliography/*/verify',async route=>{lookup++;await route.fulfill({json:{proposalId:'browser-synthetic',provider:'crossref',revision:1,fields:{title:'Remote alternative',publisher:'Synthetic Press'}}});});
 await editor.getByLabel(/Allow this lookup/).check();await editor.getByRole('button',{name:'Look up DOI',exact:true}).click();await editor.getByText('Proposed: Synthetic Press',{exact:true}).waitFor();assert.equal(lookup,1);
 assert.equal(await editor.getByRole('button',{name:'Accept selected facts',exact:true}).isEnabled(),false);await editor.getByRole('button',{name:'Dismiss proposal',exact:true}).click();
 await page.screenshot({path:join(directory,'source-details-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(directory,'source-details-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 // Insert a real file-free citation and reload its persisted locator and bibliography.
 await page.setViewportSize({width:1440,height:1000});
 const pages=new Pages(store,new Knowledge(store)),note=pages.create('default',{title:'Synthetic citation note'});
 await page.goto(base+'/?vault=default&page='+note.id);
 const content=page.locator('.block-content[contenteditable=true]').first();await content.click();await page.keyboard.type('/cite',{delay:100});await page.locator('.command-menu').waitFor();await page.keyboard.press('Enter');
 await page.getByRole('option',{name:'Synthetic Bibliography Study'}).click();await page.getByRole('combobox',{name:'Citation kind',exact:true}).selectOption('publication');
 await page.getByRole('textbox',{name:'Bibliographic locator',exact:true}).fill('12');await page.getByRole('button',{name:'Insert bibliographic citation',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-bibliographic-reference]'));
 await page.waitForFunction(()=>document.querySelector('.note-references li'));
 await page.waitForFunction(async id=>{const response=await fetch('/api/pages/'+id,{headers:{'x-vault-id':'default'}});const data=await response.json();return data.blocks.some(block=>block.content.some(segment=>segment.bibliographicReference?.locator==='12'));},note.id);
 await page.reload();await page.locator('.note-references li').waitFor();assert.ok(pages.get('default',note.id).sourceIds.includes(record.source_id));assert.equal(pages.get('default',note.id).blocks[0].content.find(segment=>segment.bibliographicReference).bibliographicReference.sourceId,record.source_id);
 await page.getByRole('combobox',{name:'Bibliography style',exact:true}).selectOption('ieee');await page.waitForFunction(()=>document.querySelector('[data-bibliographic-reference]')?.textContent?.includes('[1'));await page.reload();await page.waitForFunction(()=>document.querySelector('[data-bibliographic-reference]')?.textContent?.includes('[1'));assert.equal(await page.getByRole('combobox',{name:'Bibliography style',exact:true}).inputValue(),'ieee');await page.getByRole('combobox',{name:'Bibliography style',exact:true}).selectOption('apa');await page.waitForFunction(()=>document.querySelector('[data-bibliographic-reference]')?.textContent?.includes('2026'));await page.screenshot({path:join(directory,'publication-citation.png')});
 // Review canonical taxonomy and synopsis through the existing property/Inbox review contract.
 const documentText='Synthetic document. This study compares examples.';
 store.run("INSERT INTO source_files(id,vault_id,entity_id,name,size,status,text,created_at,format,admitted,enrichment_status) VALUES('browser-document','default',?,'Synthetic.txt',48,'ready',?,'2026-10-24','txt',1,'completed')",record.source_id,documentText);
 const currentRevision=store.get('SELECT revision FROM bibliographic_records WHERE source_id=?',record.source_id).revision,domain=DOMAINS.find(item=>item.id==='general');
 const evidence={entity_id:record.source_id,origin:'ai',source_file_id:'browser-document',source_hash:rawSourceHash(documentText),details:scholarlyEnrichmentVersion+':'+ 'a'.repeat(64)+'\nAI interpretation from supplied document excerpts only; not an author abstract. Evidence: This study compares examples.'};
 proposeValue(store,'default',{...evidence,property_name:'scholarly discipline',value:JSON.stringify({domainId:domain.id,label:domain.label,taxonomyVersion:TAXONOMY_VERSION,bibliographicRevision:currentRevision})});
 proposeValue(store,'default',{...evidence,property_name:'ai scholarly synopsis',value:JSON.stringify({basis:'document-excerpts',text:'A synthetic comparison of examples.',method:'Comparison',conclusions:'',quote:'This study compares examples.'})});
 await page.goto(base+'/?vault=default&source='+record.source_id+'&entity='+record.source_id);await page.getByRole('tab',{name:'Metadata',exact:true}).click();await page.getByRole('button',{name:/Show all properties/}).click();await page.locator('.source-metadata-field').filter({hasText:/scholarly discipline/i}).getByRole('button',{name:'Accept',exact:true}).click();
 await page.waitForFunction(async id=>{const response=await fetch('/api/entities/'+id,{headers:{'x-vault-id':'default'}});return (await response.json()).domainIds.includes('general');},record.source_id);assert.equal(store.get('SELECT origin FROM entity_domains WHERE entity_id=? AND domain_id=?',record.source_id,'general').origin,'inferred');
 await page.locator('.source-metadata-field').filter({hasText:/ai scholarly synopsis/i}).getByRole('button',{name:'Accept',exact:true}).click();
 await page.getByRole('button',{name:'Show history',exact:true}).click();
 await page.locator('.source-metadata-field').filter({hasText:/ai scholarly synopsis/i}).getByText('Field history (1)',{exact:true}).waitFor();
 const bundle=await page.evaluate(async()=>await (await fetch('/api/bibliography/export',{headers:{'x-vault-id':'default'}})).json());assert.ok(bundle.annotated.includes('A synthetic comparison')); assert.ok(!bundle.bibtex.includes('A synthetic comparison'));assert.equal(JSON.parse(bundle.sidecar).records[0].scholarly.classifications[0].domainId,'general');
 await openDetails();await page.getByRole('heading',{name:'Disciplinary classification',exact:true}).waitFor();await page.screenshot({path:join(directory,'reviewed-classification-and-export.png')});
 assert.deepEqual(errors,[]);await writeFile(join(directory,'validation.json'),JSON.stringify({passed:true,synthetic:true,browser:await browser.version(),checks:['cancel','idempotent retry','metadata-only','DOI consent','explicit field review','mobile','publication citation save/reload','live inline CSL styles and reload persistence','per-field import review','authored property reconciliation','canonical taxonomy review','reviewed scholarly annotated/sidecar export'],errors},null,2));console.log(JSON.stringify({passed:true,directory}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));db.close();}
