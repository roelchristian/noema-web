import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {PropertyDefinitionGovernance} from '../src/server/modules/property-definition-governance.ts';
import {TemporalProperties} from '../src/server/modules/temporal-properties.ts';
import {propertyFingerprint} from '../src/server/modules/temporal-properties.ts';
test('custom date definitions use canonical temporal evidence and preserve uncertainty, calendar and backup bindings',async()=>{
 const db=openDatabase(':memory:');try{
  const store=new Store(db),knowledge=new Knowledge(store),definitions=new PropertyDefinitionGovernance(store),backups=new VaultBackups(store);
  const definition=definitions.create('default',{name:'Observed on',key:'observed_on',label:'Observed On',scope:{kind:'main_type',type:'place'},valueKind:'date',cardinality:'many'});
  const entity=knowledge.create('default',{name:'Custom temporal place',type:'place'});
  knowledge.property('default',entity.id,{name:'Observed on',value:'March 1905 (Julian)',definition_id:definition.id});
  const values=knowledge.property('default',entity.id,{name:'Observed on',value:'circa 1906',definition_id:definition.id}).properties;
  const exact=values.find(item=>item.value==='March 1905 (Julian)'),uncertain=values.find(item=>item.value==='circa 1906');
  assert.equal(exact.metadata.temporal_date_id,'julian:month:1905-03');assert.equal(exact.metadata.text_value,null);
  assert.equal(uncertain.metadata.compatibility,'unresolved');assert.equal(uncertain.metadata.temporal_date_id,null);
  assert.equal(store.get('SELECT kind FROM temporal_relations WHERE property_id=?',exact.id).kind,'discusses');
  const evidence=new TemporalProperties(store).resolve('default',exact.id,exact.metadata.temporal_date_id,propertyFingerprint('place','Observed on',exact.value));assert.equal(evidence.status,'current');
  const archive=await backups.export('default'),restored=await backups.import(archive.bytes),copy=knowledge.list(restored.id).find(item=>item.name===entity.name);
  const rows=knowledge.detail(restored.id,copy.id).properties.filter(item=>item.name==='Observed on');
  assert.deepEqual(rows.map(item=>item.value),values.map(item=>item.value));assert.equal(rows[0].metadata.definition_id,definition.id);
  assert.equal(rows.find(item=>item.value===exact.value).metadata.temporal_date_id,'julian:month:1905-03');
  assert.equal(rows.find(item=>item.value===uncertain.value).metadata.compatibility,'unresolved');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
