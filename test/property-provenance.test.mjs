import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {setupPropertyProvenanceSchema,recordPropertyProvenance,recordEntityNameProvenance,getPropertyProvenance,getNameProvenance,proposeValue,rawSourceHash} from '../src/server/modules/property-provenance.ts';
const snapshot=db=>db.prepare('SELECT id,entity_id,name,value,target_id FROM properties ORDER BY id').all().map(row=>({...row}));
test('provenance migration is additive, conservatively unknown, idempotent and does not rewrite authored data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'noema-provenance-migrate-')),file=join(dir,'fixture.sqlite');let db=openDatabase(file);
 try{
  const store=new Store(db),knowledge=new Knowledge(store),entity=knowledge.create('default',{name:'Legacy exact',type:'person'});
  knowledge.property('default',entity.id,{name:'website',value:'  original 0012  '});
  const property=knowledge.detail('default',entity.id).properties[0];
  for(const row of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'property_provenance_%' OR name LIKE 'entity_name_provenance_%' OR name='property_source_provenance_invalidate' OR name LIKE 'property_proposals_%' OR name LIKE 'source_automation_pause_%')").all())db.exec(`DROP TRIGGER ${row.name}`);
  db.exec('DROP TABLE property_proposals; DROP TABLE property_provenance; DROP TABLE entity_name_provenance; DROP TABLE source_automation_pauses; DELETE FROM schema_migrations WHERE version=6');
  const before=snapshot(db);db.close();db=openDatabase(file);
  assert.deepEqual(snapshot(db),before);assert.equal(getPropertyProvenance(new Store(db),'default',property.id).origin,'legacy_unknown');
  recordPropertyProvenance(new Store(db),'default',property.id,{origin:'manual',details:'User supplied'});
  db.prepare('DELETE FROM schema_migrations WHERE version=6').run();setupPropertyProvenanceSchema(db);
  assert.equal(getPropertyProvenance(new Store(db),'default',property.id).origin,'manual');assert.deepEqual(snapshot(db),before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('raw edits invalidate attribution without erasing source evidence; explicit manual edits establish precedence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'noema-provenance-invalidation-')),db=openDatabase(join(dir,'fixture.sqlite')),store=new Store(db),files=new SourceFiles(store);
 try{
  const knowledge=new Knowledge(store),file=files.add('default','evidence.md',Buffer.from('Synthetic evidence.'));
  const entity=knowledge.create('default',{name:'Authored person',type:'person'}),property=knowledge.property('default',entity.id,{name:'website',value:'https://original.example'}).properties[0];
  const hash=rawSourceHash('Synthetic evidence.');recordPropertyProvenance(store,'default',property.id,{origin:'ai',source_file_id:file.id,source_hash:hash,details:'Extraction receipt'});
  recordEntityNameProvenance(store,'default',entity.id,{origin:'derived',source_file_id:file.id,source_hash:hash});
  store.run('UPDATE properties SET value=? WHERE id=?','Manual SQL content',property.id);
  let provenance=getPropertyProvenance(store,'default',property.id);assert.equal(provenance.stale,true);assert.equal(provenance.source_hash,hash);assert.equal(provenance.origin,'ai');
  store.run('UPDATE entities SET name=? WHERE id=?','Manual SQL name',entity.id);assert.equal(getNameProvenance(store,'default',entity.id).stale,true);
  recordPropertyProvenance(store,'default',property.id,{origin:'ai',source_file_id:file.id,source_hash:rawSourceHash('Different historical content')});assert.equal(getPropertyProvenance(store,'default',property.id).stale,true,'historical fingerprints never masquerade as current evidence');
  recordPropertyProvenance(store,'default',property.id,{origin:'manual'});provenance=getPropertyProvenance(store,'default',property.id);assert.equal(provenance.origin,'manual');assert.equal(provenance.stale,false);
  store.run('UPDATE source_files SET text=? WHERE id=?','Changed source',file.id);assert.equal(getNameProvenance(store,'default',entity.id).stale,true);
 }finally{files.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('content-evidence proposals retain rejected decisions and enforce owner, source and target vaults',()=>{
 const dir=mkdtempSync(join(tmpdir(),'noema-provenance-proposals-')),db=openDatabase(join(dir,'fixture.sqlite')),store=new Store(db),files=new SourceFiles(store);
 try{
  const knowledge=new Knowledge(store),entity=knowledge.create('default',{name:'Proposal owner',type:'person'}),other=new Vaults(store).create({name:'Other'}),foreign=knowledge.create(other.id,{name:'Foreign',type:'person'});
  const source=files.add('default','receipt.md',Buffer.from('Evidence'));
  const input={entity_id:entity.id,property_name:'birthplace',value:'Uncertain place',origin:'ai',source_file_id:source.id,source_hash:rawSourceHash('Evidence'),details:'Receipt'};
  const proposal=proposeValue(store,'default',input);store.run("UPDATE property_proposals SET status='rejected' WHERE id=?",proposal.id);
  const again=proposeValue(store,'default',{...input,details:'Changed explanation'});assert.equal(again.id,proposal.id);assert.equal(again.status,'rejected');
  const fresh=proposeValue(store,'default',{...input,source_hash:rawSourceHash('New evidence')});assert.notEqual(fresh.id,proposal.id);
  assert.throws(()=>proposeValue(store,'default',{...input,value:null,target_id:foreign.id}),error=>error.status===400);
  assert.throws(()=>proposeValue(store,other.id,input),error=>error.status===404);
  assert.throws(()=>store.run('UPDATE property_proposals SET vault_id=? WHERE id=?',other.id,proposal.id));
  store.run('INSERT INTO source_automation_pauses VALUES (?,?,?,?)',source.id,'default','Restored source',new Date().toISOString());
  assert.throws(()=>store.run('UPDATE entities SET vault_id=? WHERE id=?',other.id,entity.id));
  assert.throws(()=>store.run('UPDATE source_files SET vault_id=? WHERE id=?',other.id,source.id));
  store.run('UPDATE source_files SET text=? WHERE id=?','Reprocessed',source.id);assert.ok(store.get('SELECT 1 FROM source_automation_pauses WHERE file_id=?',source.id));
  assert.throws(()=>store.run('UPDATE source_automation_pauses SET vault_id=? WHERE file_id=?',other.id,source.id));
 }finally{files.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
