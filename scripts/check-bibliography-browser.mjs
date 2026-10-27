// Disposable synthetic database. Network and AI providers are blocked.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Bibliography} from '../src/server/modules/bibliography.ts';
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
let browser,page;const errors=[];
try {
 await mkdir(directory,{recursive:true});await Promise.all(['failure.json','failure.png'].map(name=>rm(join(directory,name),{force:true}))); server.listen(0,'127.0.0.1');await once(server,'listening');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const base=`http://127.0.0.1:${server.address().port}`;
 const openBibliography=async()=>{await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.locator('#entity-panel .bibliography-editor').waitFor();};
 const openBulk=async()=>{await page.getByText('More',{exact:true}).click();await page.getByRole('button',{name:'Import bibliography…',exact:true}).click();};
 await page.goto(base+'/?vault=default&view=entities&type=source');
 if(!await page.getByText('More',{exact:true}).count())await page.getByRole('button',{name:'Sources',exact:true}).first().click();
 // Keyboard activates overflow and modal Escape restores a reachable trigger.
 await page.getByText('More',{exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Import bibliography…',exact:true}).click();await page.getByRole('dialog').waitFor();assert.ok(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)));await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement===document.querySelector('.bibliography-library-more summary'));assert.equal(await page.getByText('More',{exact:true}).evaluate(element=>element===document.activeElement),true);
 const open=async()=>{await openBulk();await page.getByRole('textbox',{name:'BibTeX / BibLaTeX',exact:true}).fill('@book{Synthetic2026,title={Synthetic Bibliography Study},author={{Synthetic Group}},year={2026},doi={10.5555/synthetic},custom={retained}}');};
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
 await openBibliography();
 const editor=page.locator('#entity-panel .bibliography-editor');
 assert.equal(await editor.locator('.bibliography-fields').count(),0);
 assert.equal(await editor.getByRole('button',{name:'Export this source',exact:true}).count(),0);
 await editor.getByRole('button',{name:'Edit publication details',exact:true}).click();
 const metadata=page.getByRole('region',{name:'Source metadata',exact:true});
 await metadata.locator('.source-metadata-field').first().waitFor();
 const showAll=metadata.getByRole('button',{name:/Show all properties/});if(await showAll.count())await showAll.click();
 const publisher=metadata.locator('.source-metadata-field').filter({has:page.locator('dt',{hasText:/^Publisher$/})});
 await publisher.getByRole('button',{name:'Edit Publisher',exact:true}).click();await publisher.getByLabel('Publisher',{exact:true}).fill('Canonical Press');
 assert.equal(await publisher.getByRole('button',{name:'Save Publisher',exact:true}).isEnabled(),false);
 await publisher.getByRole('checkbox',{name:/Keep authored values/}).check();await publisher.getByRole('button',{name:'Save Publisher',exact:true}).click();
 await publisher.getByText('Canonical Press',{exact:true}).waitFor();assert.equal(store.get("SELECT value FROM properties WHERE id='browser-legacy-publisher'").value,'Preserved Press');
 await metadata.getByText('DOI verification & publication controls',{exact:true}).click();
 await metadata.getByRole('button',{name:'Look up DOI',exact:true}).waitFor();assert.equal(await metadata.getByRole('button',{name:'Look up DOI',exact:true}).isEnabled(),false);
 let lookup=0;
 await page.route('**/api/bibliography/*/verify',async route=>{lookup++;const revision=new Bibliography(store).get('default',record.source_id).revision,fields={title:'Remote alternative',publisher:'Synthetic Press',year:'2027'};store.run('INSERT OR REPLACE INTO bibliographic_proposals(id,source_id,vault_id,revision,provider,fields_json,created_at) VALUES(?,?,?,?,?,?,?)','browser-synthetic',record.source_id,'default',revision,'crossref',JSON.stringify(fields),new Date().toISOString());await route.fulfill({json:{proposalId:'browser-synthetic',provider:'crossref',revision,fields}});});
 await metadata.getByLabel(/Allow this lookup/).check();await metadata.getByRole('button',{name:'Look up DOI',exact:true}).click();await metadata.getByText('Proposed: Synthetic Press',{exact:true}).waitFor();assert.equal(lookup,1);await metadata.getByText('Proposed: 2027',{exact:true}).waitFor();assert.equal(await metadata.getByRole('checkbox',{name:'Accept DOI year',exact:true}).count(),1);
 assert.equal(await metadata.getByRole('button',{name:'Accept selected facts',exact:true}).isEnabled(),false);await metadata.getByRole('checkbox',{name:'Accept DOI year',exact:true}).check();await metadata.getByRole('button',{name:'Accept selected facts',exact:true}).click();await metadata.getByRole('status').filter({hasText:'Selected DOI facts accepted'}).waitFor();assert.equal(new Bibliography(store).get('default',record.source_id).fields.year,'2027');assert.equal(new Bibliography(store).get('default',record.source_id).fields.title,'Synthetic Bibliography Study');assert.equal(await metadata.getByRole('checkbox',{name:'Accept DOI year',exact:true}).count(),0);
 // Scoped preview cancel, explicit conflict acceptance and revision races use the selected Source only.
 await page.getByRole('tab',{name:'Metadata',exact:true}).click();if(!await editor.getByText('BibTeX & advanced',{exact:true}).evaluate(element=>element.parentElement.open))await editor.getByText('BibTeX & advanced',{exact:true}).click();
 const scoped=async()=>{await page.getByRole('tab',{name:'Metadata',exact:true}).click();await editor.getByText('BibTeX & advanced',{exact:true}).waitFor();if(!await editor.getByText('BibTeX & advanced',{exact:true}).evaluate(element=>element.parentElement.open))await editor.getByText('BibTeX & advanced',{exact:true}).click();await editor.getByRole('button',{name:'Import BibTeX into this source…',exact:true}).click();await page.getByRole('textbox',{name:'Source BibTeX',exact:true}).fill('@book{DifferentKey,title={Scoped alternative},custom={retained}}');await page.getByRole('button',{name:'Review source import',exact:true}).click();await page.getByRole('combobox',{name:'Resolve source title',exact:true}).waitFor();};
 await scoped();assert.equal(await page.getByRole('button',{name:'Apply reviewed import',exact:true}).isEnabled(),false);await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(new Bibliography(store).get('default',record.source_id).fields.title,'Synthetic Bibliography Study');
 await scoped();await page.getByRole('combobox',{name:'Resolve source title',exact:true}).selectOption('current');await page.getByRole('button',{name:'Apply reviewed import',exact:true}).click();await page.getByRole('status').filter({hasText:'Source bibliography updated'}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();if(!await editor.getByText('BibTeX & advanced',{exact:true}).evaluate(element=>element.parentElement.open))await editor.getByText('BibTeX & advanced',{exact:true}).click();assert.equal(new Bibliography(store).get('default',record.source_id).citationKey,'Synthetic2026');
 await scoped();await page.getByRole('combobox',{name:'Resolve source title',exact:true}).selectOption('incoming');const currentRecord=new Bibliography(store).get('default',record.source_id);new Bibliography(store).save('default',record.source_id,{...currentRecord,fields:{...currentRecord.fields,volume:'2'}});await page.getByRole('button',{name:'Apply reviewed import',exact:true}).click();await page.getByRole('alert').filter({hasText:/source changed/}).waitFor();assert.equal(await page.getByRole('button',{name:'Review source import',exact:true}).isEnabled(),true);await page.getByRole('button',{name:'Cancel',exact:true}).click();
 let scopedExports=0,collectionExports=0;page.on('request',request=>{if(request.url().includes('/api/bibliography/'+record.source_id+'/export'))scopedExports++;else if(request.url().includes('/api/bibliography/export'))collectionExports++;});
 if(!await editor.getByText('BibTeX & advanced',{exact:true}).evaluate(element=>element.parentElement.open))await editor.getByText('BibTeX & advanced',{exact:true}).click();const exportResponse=page.waitForResponse(response=>response.url().includes('/api/bibliography/'+record.source_id+'/export'));await editor.getByRole('button',{name:'Export this source',exact:true}).click();await (await exportResponse).finished();assert.equal(scopedExports,1);assert.equal(collectionExports,0);
 // Clipboard uses locally bundled APA/IEEE and BibTeX.
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);await editor.getByRole('button',{name:'Copy reference',exact:true}).click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Synthetic/);
 await page.getByRole('tab',{name:'Connections',exact:true}).click();await page.getByRole('region',{name:'Cited works',exact:true}).waitFor();await openBibliography();
 for(const [mode,width,height] of [['light',1440,1000],['dark',1440,1000],['light',390,844],['dark',390,844]]){await page.setViewportSize({width,height});await page.evaluate(mode=>{document.documentElement.dataset.mode=mode;},mode);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(directory,`publication-${mode}-${width}.png`)});}
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(directory,'source-details-desktop.png')});
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
 await page.getByRole('combobox',{name:'Bibliography style',exact:true}).selectOption('ieee');await page.waitForFunction(()=>document.querySelector('[data-bibliographic-reference]')?.textContent?.includes('[1'));await page.reload();await page.waitForFunction(()=>document.querySelector('[data-bibliographic-reference]')?.textContent?.includes('[1'));assert.equal(await page.getByRole('combobox',{name:'Bibliography style',exact:true}).inputValue(),'ieee');await page.getByRole('combobox',{name:'Bibliography style',exact:true}).selectOption('apa');await page.waitForFunction(()=>document.querySelector('[data-bibliographic-reference]')?.textContent?.includes('2027'));await page.screenshot({path:join(directory,'publication-citation.png')});
 // Browser fetches exercise the actual binary backup/restore endpoints without leaving the fixture.
 const restored=await page.evaluate(async()=>{const response=await fetch('/api/vaults/default/backup',{headers:{'x-noema-request':'1'}});if(!response.ok)throw new Error('backup failed '+response.status+' '+await response.text());const bytes=await response.arrayBuffer();const imported=await fetch('/api/vaults/import?name=Bibliography%20browser%20restore',{method:'POST',headers:{'x-noema-request':'1','Content-Type':'application/x-noema-backup'},body:bytes});if(!imported.ok)throw new Error('restore failed '+imported.status+' '+await imported.text());return imported.json();});
 assert.ok(restored.id);const restoredRecords=new Bibliography(store).list(restored.id,true);assert.equal(restoredRecords[0].citationKey,'Synthetic2026');assert.ok(restoredRecords[0].rawImports.some(raw=>raw.includes('DifferentKey')));assert.ok(restoredRecords[0].fields.title==='Synthetic Bibliography Study');
 // Review canonical taxonomy and synopsis through the existing property/Inbox review contract.
 const documentText='Synthetic document. This study compares examples.';
 store.run("INSERT INTO source_files(id,vault_id,entity_id,name,size,status,text,created_at,format,admitted,enrichment_status) VALUES('browser-document','default',?,'Synthetic.txt',48,'ready',?,'2026-10-24','txt',1,'completed')",record.source_id,documentText);
 const currentRevision=store.get('SELECT revision FROM bibliographic_records WHERE source_id=?',record.source_id).revision,domain=DOMAINS.find(item=>item.id==='general');
 const evidence={entity_id:record.source_id,origin:'ai',source_file_id:'browser-document',source_hash:rawSourceHash(documentText),details:scholarlyEnrichmentVersion+':'+ 'a'.repeat(64)+'\nAI interpretation from supplied document excerpts only; not an author abstract. Evidence: This study compares examples.'};
 proposeValue(store,'default',{...evidence,property_name:'scholarly discipline',value:JSON.stringify({domainId:domain.id,label:domain.label,taxonomyVersion:TAXONOMY_VERSION,bibliographicRevision:currentRevision})});
 proposeValue(store,'default',{...evidence,property_name:'ai scholarly synopsis',value:JSON.stringify({basis:'document-excerpts',text:'A synthetic comparison of examples.',method:'Comparison',conclusions:'',quote:'This study compares examples.'})});
 await page.goto(base+'/?vault=default&source='+record.source_id+'&entity='+record.source_id);await page.getByRole('tab',{name:'Metadata',exact:true}).click();await page.locator('.source-metadata-field').first().waitFor();const allProperties=page.getByRole('button',{name:/Show all properties/});if(await allProperties.count())await allProperties.click();await page.locator('.source-metadata-field').filter({hasText:/scholarly discipline/i}).getByRole('button',{name:'Accept',exact:true}).click();
 await page.waitForFunction(async id=>{const response=await fetch('/api/entities/'+id,{headers:{'x-vault-id':'default'}});return (await response.json()).domainIds.includes('general');},record.source_id);assert.equal(store.get('SELECT origin FROM entity_domains WHERE entity_id=? AND domain_id=?',record.source_id,'general').origin,'inferred');
 await page.locator('.source-metadata-field').filter({hasText:/ai scholarly synopsis/i}).getByRole('button',{name:'Accept',exact:true}).click();
 await page.getByRole('button',{name:'Show history',exact:true}).click();
 await page.locator('.source-metadata-field').filter({hasText:/ai scholarly synopsis/i}).getByText('Field history (1)',{exact:true}).waitFor();
 const bundle=await page.evaluate(async()=>await (await fetch('/api/bibliography/export',{headers:{'x-vault-id':'default'}})).json());assert.ok(bundle.annotated.includes('A synthetic comparison')); assert.ok(!bundle.bibtex.includes('A synthetic comparison'));assert.equal(JSON.parse(bundle.sidecar).records[0].scholarly.classifications[0].domainId,'general');
 await openBibliography();await page.screenshot({path:join(directory,'reviewed-classification-and-export.png')});
 // New source accepts exactly one BibTeX entry; collection export remains in overflow.
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/?vault=default&view=entities&type=source');if(!await page.getByText('More',{exact:true}).count())await page.getByRole('button',{name:'Sources',exact:true}).first().click();
 assert.equal(await page.getByRole('combobox',{name:'Bibliography export format',exact:true}).count(),0);
 await page.getByRole('button',{name:'New source',exact:true}).first().click();await page.getByRole('combobox',{name:'Add source from',exact:true}).click();await page.locator('.select-menu:popover-open [role=option]').filter({hasText:'Import from BibTeX'}).click();
 await page.getByRole('textbox',{name:'BibTeX / BibLaTeX',exact:true}).fill('@book{Single2026,title={Single-entry creation},year={2026}}\n@book{Extra2026,title={Extra entry}}');await page.getByRole('button',{name:'Review import',exact:true}).click();await page.getByRole('alert').filter({hasText:'Import exactly one BibTeX entry'}).waitFor();
 await page.getByRole('textbox',{name:'BibTeX / BibLaTeX',exact:true}).fill('@book{Single2026,title={Single-entry creation},year={2026}}');await page.getByRole('button',{name:'Review import',exact:true}).click();await page.getByRole('button',{name:'Import reviewed entries',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(store.get("SELECT count(*) n FROM bibliographic_records WHERE citation_key='Single2026'").n,1);
 // Switching Source while its scoped preview is pending discards the late response.
 const singleId=store.get("SELECT source_id FROM bibliographic_records WHERE citation_key='Single2026'").source_id;
 await page.goto(base+'/?vault=default&source='+record.source_id+'&entity='+record.source_id);await page.getByRole('tab',{name:'Metadata',exact:true}).click();await editor.getByText('BibTeX & advanced',{exact:true}).click();await editor.getByRole('button',{name:'Import BibTeX into this source…',exact:true}).click();await page.getByRole('textbox',{name:'Source BibTeX',exact:true}).fill('@book{Pending,title={Late preview must not appear}}');
 let releasePreview;const delayed=new Promise(resolve=>{releasePreview=resolve;});let receivedPreview;const received=new Promise(resolve=>{receivedPreview=resolve;});
 await page.route('**/api/bibliography/'+record.source_id+'/import-preview',async route=>{receivedPreview();await delayed;await route.fulfill({json:new Bibliography(store).sourceImportPreview('default',record.source_id,'@book{Pending,title={Late preview must not appear}}')}).catch(()=>{});},{times:1});
 await page.getByRole('button',{name:'Review source import',exact:true}).click();await received;await page.goto(base+'/?vault=default&source='+singleId+'&entity='+singleId);releasePreview();await page.locator('#entity-panel .bibliography-editor strong').filter({hasText:'Single-entry creation'}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByText('Late preview must not appear',{exact:true}).count(),0);assert.equal(new Bibliography(store).get('default',record.source_id).fields.title,'Synthetic Bibliography Study');
 await page.goto(base+'/?vault=default&view=entities&type=source');if(!await page.getByText('More',{exact:true}).count())await page.getByRole('button',{name:'Sources',exact:true}).first().click();
 await page.getByText('More',{exact:true}).click();await page.getByRole('button',{name:'Export bibliography…',exact:true}).click();await page.getByRole('combobox',{name:'Bibliography export format',exact:true}).selectOption('biblatex');await page.getByRole('button',{name:'Export bibliography',exact:true}).click();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 assert.deepEqual(errors,[]);await writeFile(join(directory,'validation.json'),JSON.stringify({passed:true,synthetic:true,browser:await browser.version(),checks:['keyboard overflow/modal focus','source switching mid-preview','browser binary backup/restore','real DOI selective acceptance','overflow import/export','single-entry creation and rejection','source scoped cancel/accept/stale revision/export','clipboard reference','cited works navigation','desktop/mobile/light/dark','DOI year alias proposal','cancel','idempotent retry','metadata-only','DOI consent','explicit field review','mobile','publication citation save/reload','live inline CSL styles and reload persistence','per-field import review','authored property reconciliation','canonical taxonomy review','reviewed scholarly annotated/sidecar export'],errors},null,2));console.log(JSON.stringify({passed:true,directory}));
}catch(error){await writeFile(join(directory,'failure.json'),JSON.stringify({error:String(error),errors,url:page?.url(),body:await page?.locator('body').innerText().catch(()=>'' )},null,2));await page?.screenshot({path:join(directory,'failure.png')}).catch(()=>{});throw error;}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));db.close();}
