import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {setupBibliographySchema} from '../src/server/modules/bibliography.ts';
import {BibliographicMetadata} from '../src/server/modules/bibliographic-metadata.ts';
import {SourceMetadata} from '../src/server/modules/source-metadata.ts';
import {applySourceMetadataBibliographicFields} from '../src/shared/source-metadata.ts';
function fixture(fetcher) {const db=openDatabase(':memory:');setupBibliographySchema(db);const store=new Store(db);return {db,store,service:new BibliographicMetadata(store,fetcher)};}
const raw='@article{Test, title={Synthetic study}, author={Doe, Jane}, doi={10.1234/synthetic}, year={2020}, custom={retained}}';
function imported(service) {return service.import('default',{raw,decisions:[{index:0,action:'create'}]}).sourceIds[0];}
test('metadata-only import is atomic, idempotent, scoped and preserves authored fields',()=>{const {db,store,service}=fixture();try {const id=imported(service);assert.equal(store.get('SELECT count(*) AS n FROM source_files').n,0);assert.equal(service.preview('default',raw).entries[0].matches[0].sourceId,id);assert.throws(()=>imported(service),/already exists/);const same=service.import('default',{raw,decisions:[{index:0,action:'merge',sourceId:id,revision:1}]});assert.equal(same.skipped,1);assert.equal(service.get('default',id).revision,1);assert.throws(()=>service.save('default',id,{revision:1,citationKey:'Test',entryType:'article',fields:{title:'bad } @book{injected'}}),/braces/);assert.equal(service.get('default',id).revision,1);service.save('default',id,{revision:1,citationKey:'Test',entryType:'article',fields:{title:'Authored',doi:'10.1234/synthetic'}});assert.throws(()=>service.save('default',id,{revision:1,citationKey:'Test',entryType:'article',fields:{}}),/changed/);service.import('default',{raw,decisions:[{index:0,action:'merge',sourceId:id,revision:2,fields:{title:'current'}}]});assert.equal(service.get('default',id).fields.title,'Authored');assert.ok(service.get('default',id).rawImports.includes(raw));assert.throws(()=>service.get('missing',id));store.run("UPDATE vaults SET locked=1 WHERE id='default'");assert.throws(()=>service.list('default'));}finally{db.close();}});
test('DOI lookup requires consent, exact DOI, explicit acceptance and rejects stale proposals',async()=>{let calls=0;const {db,service}=fixture(async(url)=>{calls++;assert.equal(url,'https://api.crossref.org/works/10.1234%2Fsynthetic');return new Response(JSON.stringify({message:{DOI:'10.1234/synthetic',title:['Verified title'],published:{'date-parts':[[2022]]}}}),{status:200});});try{const id=imported(service);await assert.rejects(service.verify('default',id,{}),/Consent/);assert.equal(calls,0);const proposal=await service.verify('default',id,{consent:true});assert.equal(service.get('default',id).fields.title,'Synthetic study');assert.throws(()=>service.acceptVerification('default',id,{proposalId:proposal.proposalId,revision:1,fields:{title:'Invented'}}),/offered/);service.acceptVerification('default',id,{proposalId:proposal.proposalId,revision:1,fields:{title:'Verified title'}});assert.equal(service.get('default',id).fields.title,'Verified title');assert.throws(()=>service.acceptVerification('default',id,{proposalId:proposal.proposalId,revision:1,fields:{}}),/changed/);await service.verify('default',id,{consent:true});assert.equal(calls,1);}finally{db.close();}});
test('DOI cancellation, mismatches and transient failures do not change records',async()=>{for(const kind of ['abort','mismatch','rate']){const {db,service}=fixture(async()=>kind==='rate'?new Response('',{status:429}):new Response(JSON.stringify({message:{DOI:'10.1234/wrong'}})));try{const id=imported(service),controller=new AbortController();if(kind==='abort')controller.abort();await assert.rejects(service.verify('default',id,{consent:true},controller.signal));assert.equal(service.get('default',id).revision,1);}finally{db.close();}}});
test('shared raw import batch is stored once and preview/sidecar remain bounded',()=>{const {db,store,service}=fixture();try{const batch=Array.from({length:1000},(_,index)=>`@book{book${index}, title={Unique synthetic title ${index}}, year={2020}}`).join('\n');const preview=service.preview('default',batch);assert.ok(JSON.stringify(preview).length<batch.length*10);service.import('default',{raw:batch,decisions:preview.entries.map(entry=>({index:entry.index,action:'create'}))});assert.equal(store.get('SELECT count(*) AS n FROM bibliographic_import_batches').n,1);assert.equal(store.get('SELECT sum(length(raw_imports_json)) AS n FROM bibliographic_records').n,68000);const sidecar=JSON.parse(service.export('default').sidecar);assert.equal(sidecar.importBatches.length,1);assert.equal(sidecar.records.length,1000);}finally{db.close();}});
test('matching authored Source identifiers and conflicting canonical saves require review',()=>{const {db,store,service}=fixture();try{store.run("INSERT INTO entities(id,vault_id,name,type,updated_at) VALUES('legacy','default','An authored source','source','2020-01-01')");store.run("INSERT INTO properties(id,entity_id,name,value) VALUES('doi-property','legacy','DOI','10.1234/synthetic')");const preview=service.preview('default',raw);assert.equal(preview.entries[0].matches[0].sourceId,'legacy');assert.throws(()=>imported(service),/already exists/);service.import('default',{raw,decisions:[{index:0,action:'merge',sourceId:'legacy',revision:0}]});assert.throws(()=>service.save('default','legacy',{revision:1,citationKey:'Test',entryType:'article',fields:{doi:'10.1234/different'}}),/authored Source properties/);assert.equal(service.get('default','legacy').fields.doi,'10.1234/synthetic');}finally{db.close();}});
test('PDF matching uses admitted documents and attachment retry is idempotent',()=>{const {db,store,service}=fixture();try{const id=imported(service);store.run("INSERT INTO source_files(id,vault_id,entity_id,name,size,status,text,created_at,format,admitted) VALUES('synthetic.pdf','default',NULL,'Synthetic.pdf',1,'ready','DOI 10.1234/synthetic','2020-01-01','pdf',1)");assert.equal(service.pdfCandidates('default',id).length,1);service.attach('default',id,{revision:1,fileId:'synthetic.pdf'});service.attach('default',id,{revision:1,fileId:'synthetic.pdf'});assert.equal(store.get("SELECT entity_id FROM source_files WHERE id='synthetic.pdf'").entity_id,id);assert.equal(service.pdfCandidates('default',id).length,1);}finally{db.close();}});
test('Crossref missing DOI falls back to DataCite and preserves organizational authors and object publishers',async()=>{
 const calls=[];const {db,service}=fixture(async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');return calls.length===1?new Response('',{status:404}):Response.json({data:{attributes:{doi:'10.1234/synthetic',titles:[{title:'Registered synthetic dataset'}],publisher:{name:'Synthetic Repository'},publicationYear:2026,creators:[{name:'Synthetic Consortium',nameType:'Organizational'}]}}});});
 try {const id=imported(service),proposal=await service.verify('default',id,{consent:true});assert.deepEqual(calls,['https://api.crossref.org/works/10.1234%2Fsynthetic','https://api.datacite.org/dois/10.1234%2Fsynthetic']);assert.equal(proposal.provider,'datacite');assert.equal(proposal.fields.publisher,'Synthetic Repository');assert.equal(proposal.fields.author,'{Synthetic Consortium}');assert.equal(service.get('default',id).fields.title,'Synthetic study');}finally{db.close();}
});
test('import conflicts require field decisions and retain prior authored facts in provenance history',()=>{
 const {db,service,store}=fixture();try {
  const id=imported(service),original=service.get('default',id);service.save('default',id,{...original,fields:{...original.fields,title:'Authored alternative'}});
  const preview=service.preview('default',raw),match=preview.entries[0].matches[0];assert.deepEqual(match.conflicts,[{field:'title',current:'Authored alternative',incoming:'Synthetic study',currentOrigin:'manual'}]);
  const merge={raw,decisions:[{index:0,action:'merge',sourceId:id,revision:2}]};assert.throws(()=>service.import('default',merge),/each conflicting field/);assert.equal(service.get('default',id).revision,2);
  assert.throws(()=>service.import('default',{...merge,decisions:[{...merge.decisions[0],fields:{unknown:'incoming'}}]}),/each conflicting field/);
  service.import('default',{...merge,decisions:[{...merge.decisions[0],fields:{title:'incoming'}}]});const saved=service.get('default',id);assert.equal(saved.fields.title,'Synthetic study');assert.equal(saved.provenance.title.origin,'bibtex');assert.ok(saved.provenance.title.history.some(item=>item.value==='Authored alternative'&&item.origin==='manual'));
  assert.equal(service.import('default',{raw,decisions:[{index:0,action:'merge',sourceId:id,revision:3}]}).skipped,1);assert.equal(store.get('SELECT count(*) n FROM bibliographic_import_batches').n,1);
 }finally{db.close();}
});
test('scoped import explicitly targets a Source, reviews conflicts and retains stable identity and evidence',()=>{
 const {db,service,store}=fixture();try {
  const id=imported(service),original=service.get('default',id);
  service.save('default',id,{...original,fields:{...original.fields,title:'Authored publication'}});
  const incoming='@book{DifferentKey,title={Imported publication},publisher={Synthetic Press}}';
  const preview=service.sourceImportPreview('default',id,incoming);
  assert.equal(preview.sourceId,id);assert.equal(preview.revision,2);assert.equal(preview.conflicts[0].currentOrigin,'manual');
  assert.throws(()=>service.sourceImport('default',id,{raw:incoming,...preview}),/each conflicting field/);
  assert.throws(()=>service.sourceImport('default',id,{raw:raw,...preview,fields:{title:'current'}}),/import changed/);
  assert.equal(service.get('default',id).revision,2); // Cancel/failed review never writes.
  const kept=service.sourceImport('default',id,{raw:incoming,...preview,fields:{title:'current'}});
  assert.equal(kept.fields.title,'Authored publication');assert.equal(kept.fields.publisher,'Synthetic Press');
  assert.equal(kept.citationKey,'Test');assert.equal(kept.entryType,'article');assert.deepEqual(kept.rawImports,[raw,incoming]);
  assert.equal(store.get("SELECT count(*) n FROM entities WHERE type='source'").n,1);
  assert.throws(()=>service.sourceImport('default',id,{raw:incoming,...preview,fields:{title:'incoming'}}),/source changed/);
  const fresh=service.sourceImportPreview('default',id,incoming),accepted=service.sourceImport('default',id,{raw:incoming,...fresh,fields:{title:'incoming'}});
  const repeated=service.sourceImport('default',id,{raw:incoming,...service.sourceImportPreview('default',id,incoming)});assert.equal(repeated.revision,accepted.revision);
  assert.equal(accepted.fields.title,'Imported publication');assert.ok(accepted.provenance.title.history.some(fact=>fact.value==='Authored publication'&&fact.origin==='manual'));
  assert.throws(()=>service.sourceImportPreview('default',id,raw+'\n'+incoming),/exactly one/);
  assert.throws(()=>service.sourceImport('default',id,{raw:raw+'\n'+incoming,...fresh}),/exactly one/);
 }finally{db.close();}
});
test('scoped import preserves legacy reconciliation, vault and archived Source protections',()=>{
 const {db,service,store}=fixture();try {
  store.run("INSERT INTO entities(id,vault_id,name,type,updated_at) VALUES('explicit','default','Selected source','source','2020-01-01')");
  store.run("INSERT INTO properties(id,entity_id,name,value) VALUES('authored-title','explicit','title','Protected legacy title')");
  const preview=service.sourceImportPreview('default','explicit',raw);assert.equal(preview.revision,0);assert.equal(preview.propertyConflicts.length,1);
  assert.throws(()=>service.sourceImport('default','explicit',{raw,...preview}),/authored Source properties/);
  assert.equal(service.get('default','explicit'),null);
  const record=service.sourceImport('default','explicit',{raw,...preview,reviewedProperties:preview.propertyConflicts.map(conflict=>({propertyId:conflict.property.id,fingerprint:conflict.fingerprint}))});
  assert.equal(record.sourceId,'explicit');assert.equal(store.get("SELECT value FROM properties WHERE id='authored-title'").value,'Protected legacy title');
  assert.throws(()=>service.sourceImportPreview('missing','explicit',raw));assert.throws(()=>service.sourceExport('missing','explicit'));
  store.run("UPDATE entities SET archived_at='2026-01-01' WHERE id='explicit'");assert.throws(()=>service.sourceImportPreview('default','explicit',raw),/not found/);assert.throws(()=>service.sourceExport('default','explicit'),/not found/);
  store.run("UPDATE vaults SET locked=1 WHERE id='default'");assert.throws(()=>service.sourceImport('default','explicit',{raw,...preview}));
 }finally{db.close();}
});
test('scoped export reads only selected publication and its original evidence, without listing the vault',()=>{
 const {db,service,store}=fixture();try {
  const id=imported(service);const other='@book{Other,title={Unrelated private publication}}';service.import('default',{raw:other,decisions:[{index:0,action:'create'}]});
  service.list=()=>{throw new Error('Scoped export must never list the vault');};
  const queries=[],all=store.all.bind(store);store.all=(sql,...args)=>{queries.push(sql);return all(sql,...args);};
  const exported=service.sourceExport('default',id),sidecar=JSON.parse(exported.sidecar);
  assert.ok(exported.bibtex.includes('Synthetic study'));assert.ok(!exported.bibtex.includes('Unrelated'));
  assert.equal(sidecar.records.length,1);assert.equal(sidecar.records[0].sourceId,id);assert.deepEqual(sidecar.importBatches.map(batch=>batch.raw),[raw]);
  assert.ok(!queries.some(sql=>sql.includes('FROM bibliographic_records')));
 }finally{db.close();}
});

test('single-Source exports never disclose sibling entries in shared original import batches',()=>{
 const {db,service}=fixture();try {
  const batch='@book{Selected,title={Selected publication}}\n@book{Sibling,title={Private sibling publication}}';
  const [id]=service.import('default',{raw:batch,decisions:[{index:0,action:'create'},{index:1,action:'create'}]}).sourceIds;
  const exported=service.sourceExport('default',id),sidecar=JSON.parse(exported.sidecar);
  assert.ok(!JSON.stringify(exported).includes('Private sibling'));assert.ok(!JSON.stringify(exported).includes('Sibling'));
  assert.equal(sidecar.records.length,1);assert.equal(sidecar.importBatches.length,0);assert.deepEqual(sidecar.records[0].rawImportIds,[]);assert.equal(sidecar.omittedOriginalBatchIds.length,1);
  assert.deepEqual(service.get('default',id).rawImports,[batch]);assert.equal(JSON.parse(service.export('default').sidecar).importBatches[0].raw,batch);
 }finally{db.close();}
});
test('scoped imports review aliased publication facts against their existing canonical owner',()=>{
 const {db,service}=fixture();try {
  const id=imported(service),original=service.get('default',id),authored={...original.fields,date:'2024-05-01',journaltitle:'Authored journal',issue:'2'};delete authored.year;
  service.save('default',id,{...original,fields:authored});
  const incoming='@article{NewAliasKey,year={2025},journal={Imported journal},number={3}}';
  const preview=service.sourceImportPreview('default',id,incoming);
  assert.deepEqual(preview.conflicts.map(item=>item.field).sort(),['date','issue','journaltitle']);assert.ok(preview.conflicts.every(item=>item.currentOrigin==='manual'));
  assert.throws(()=>service.sourceImport('default',id,{raw:incoming,...preview}),/each conflicting field/);
  const kept=service.sourceImport('default',id,{raw:incoming,...preview,fields:{date:'current',issue:'current',journaltitle:'current'}});
  assert.equal(kept.fields.date,'2024-05-01');assert.equal(kept.fields.journaltitle,'Authored journal');assert.equal(kept.fields.issue,'2');
  const accepted=service.sourceImport('default',id,{raw:incoming,...service.sourceImportPreview('default',id,incoming),fields:{date:'incoming',issue:'incoming',journaltitle:'incoming'}});
  assert.equal(accepted.fields.date,'2025');assert.equal(accepted.fields.journaltitle,'Imported journal');assert.equal(accepted.fields.issue,'3');
  for(const key of ['year','journal','number'])assert.ok(!Object.hasOwn(accepted.fields,key));assert.equal(accepted.citationKey,'Test');assert.ok(accepted.rawImports.includes(incoming));
  assert.ok(accepted.provenance.date.history.some(fact=>fact.value==='2024-05-01'&&fact.origin==='manual'));
  assert.throws(()=>service.sourceImportPreview('default',id,'@article{Divergent,date={2024},year={2025}}'),/Conflicting publication aliases/);
  assert.throws(()=>service.sourceImport('default',id,{...service.sourceImportPreview('default',id,incoming),raw:'@article{Divergent,date={2024},year={2025}}'}),/import changed/);
 }finally{db.close();}
});
test('selected DOI alias facts update the Metadata canonical owner and retain authored-value history',async()=>{
 const {db,service,store}=fixture(async()=>Response.json({message:{DOI:'10.1234/synthetic',title:['Unselected provider title'],'container-title':['DOI journal'],issue:'7',published:{'date-parts':[[2025]]}}}));try {
  const id=imported(service),original=service.get('default',id),authored={...original.fields,date:'2024-05-01',journaltitle:'Authored journal',issue:'2'};delete authored.year;
  service.save('default',id,{...original,fields:authored});const proposal=await service.verify('default',id,{consent:true});
  assert.equal(proposal.fields.year,'2025');assert.equal(proposal.fields.number,'7');
  store.run("INSERT INTO properties(id,entity_id,name,value) VALUES('legacy-date',?,'publication date','2024-05-01')",id);
  const chosen={year:proposal.fields.year,journal:proposal.fields.journal,number:proposal.fields.number};
  assert.throws(()=>service.acceptVerification('default',id,{...proposal,fields:chosen}),/authored Source properties/);
  const review=service.reconcilePreview('default',id,{revision:proposal.revision,fields:applySourceMetadataBibliographicFields(authored,chosen)}).conflicts;assert.equal(review[0].field,'date');
  const saved=service.acceptVerification('default',id,{...proposal,fields:chosen,reviewedProperties:review.map(conflict=>({propertyId:conflict.property.id,fingerprint:conflict.fingerprint}))});
  assert.equal(new SourceMetadata(store).snapshot('default',id).fields.find(field=>field.key==='bibliography:date').value,'2025');
  assert.equal(saved.fields.title,'Synthetic study');assert.equal(saved.fields.date,'2025');assert.equal(saved.fields.journaltitle,'DOI journal');assert.equal(saved.fields.issue,'7');
  for(const key of ['year','journal','number'])assert.ok(!Object.hasOwn(saved.fields,key));assert.equal(saved.provenance.date.origin,'crossref');assert.ok(saved.provenance.date.history.some(fact=>fact.value==='2024-05-01'&&fact.origin==='manual'));
 }finally{db.close();}
});
