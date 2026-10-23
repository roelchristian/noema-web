import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {rawSourceHash} from '../src/server/modules/property-provenance.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {PropertyDefinitionGovernance} from '../src/server/modules/property-definition-governance.ts';
import {PropertyReview} from '../src/server/modules/property-review.ts';
import {proposeValue,getNameProvenance} from '../src/server/modules/property-provenance.ts';
function fixture(work){const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),entity=knowledge.create('default',{name:'Authored name',type:'person'}),review=new PropertyReview(store);try{work({db,store,knowledge,entity,review,propose:input=>proposeValue(store,'default',{entity_id:entity.id,origin:'ai',...input})});}finally{db.close();}}
test('review previews are read-only, conflicts require explicit retain both, decisions are idempotent',()=>fixture(({db,knowledge,entity,review,propose})=>{
 knowledge.property('default',entity.id,{name:'website',value:'https://authored.example'});const original=knowledge.detail('default',entity.id).properties[0];
 const proposal=propose({property_name:'website',value:'https://suggested.example'}),before=db.prepare('SELECT total_changes() n').get().n,current=review.list('default',entity.id)[0];assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
 assert.throws(()=>review.review('default',entity.id,proposal.id,{action:'accept',fingerprint:current.fingerprint}),error=>error.status===409);
 const accepted=review.review('default',entity.id,proposal.id,{action:'retain_both',fingerprint:current.fingerprint});assert.equal(accepted.status,'accepted');
 let values=knowledge.detail('default',entity.id).properties;assert.equal(values.length,2);assert.deepEqual(values.find(value=>value.id===original.id).value,original.value);
 review.review('default',entity.id,proposal.id,{action:'retain_both',fingerprint:current.fingerprint});assert.equal(knowledge.detail('default',entity.id).properties.length,2);assert.match(accepted.details,/Accepted property:/);
}));
test('review protects fresh state and retains rejected extraction decisions',()=>fixture(({knowledge,entity,review,propose})=>{
 const input={property_name:'website',value:'https://suggested.example'},proposal=propose(input),preview=review.list('default',entity.id)[0];
 knowledge.property('default',entity.id,{name:'website',value:'https://newly-authored.example'});
 assert.throws(()=>review.review('default',entity.id,proposal.id,{action:'retain_both',fingerprint:preview.fingerprint}),error=>error.status===409);
 const fresh=review.list('default',entity.id)[0];review.review('default',entity.id,proposal.id,{action:'reject',fingerprint:fresh.fingerprint});assert.equal(propose(input).status,'rejected');assert.equal(knowledge.detail('default',entity.id).properties.length,1);
}));
test('retain both validates target types; explicit name approval records manual authority',()=>fixture(({store,knowledge,entity,review,propose})=>{
 const place=knowledge.create('default',{name:'Place',type:'place'}),person=knowledge.create('default',{name:'Person',type:'person'});
 const proposal=propose({property_name:'birthplace',value:'Unknown location'}),preview=review.list('default',entity.id)[0];
 assert.throws(()=>review.review('default',entity.id,proposal.id,{action:'retain_both',target_id:person.id,fingerprint:preview.fingerprint}),error=>error.status===400);
 const accepted=review.review('default',entity.id,proposal.id,{action:'accept',target_id:place.id,fingerprint:preview.fingerprint});assert.match(accepted.details,new RegExp(place.id));
 const name=propose({kind:'entity_name',value:'Reviewed name'}),namePreview=review.list('default',entity.id)[0];review.review('default',entity.id,name.id,{action:'accept',fingerprint:namePreview.fingerprint});assert.equal(knowledge.require('default',entity.id).name,'Reviewed name');assert.equal(getNameProvenance(store,'default',entity.id).origin,'manual');
}));

test('same-vault Source evidence supports generic facts and stale rejection; imported metadata survives text changes but not deleted evidence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'review-evidence-')),db=openDatabase(join(dir,'fixture.sqlite')),store=new Store(db),files=new SourceFiles(store),knowledge=new Knowledge(store),review=new PropertyReview(store);
 try{
  const file=files.add('default','evidence.md',Buffer.from('Synthetic evidence')),source=knowledge.create('default',{type:'source',name:'Consulted source',attachmentIds:[file.id]}),person=knowledge.create('default',{type:'person',name:'Person'});
  store.run("UPDATE source_files SET text=?,status='ready',admitted=1,source_url=? WHERE id=?",'Synthetic evidence','https://metadata.example',file.id);
  const fact=proposeValue(store,'default',{entity_id:person.id,property_name:'website',value:'https://fact.example',origin:'ai',source_file_id:file.id,source_hash:rawSourceHash('Synthetic evidence')});
  let preview=review.list('default',person.id)[0];assert.equal(preview.stale,false,'facts may cite another Source entity');
  store.run('UPDATE source_files SET text=? WHERE id=?','Revised evidence',file.id);preview=review.list('default',person.id)[0];assert.equal(preview.stale,true);assert.throws(()=>review.review('default',person.id,fact.id,{action:'accept',fingerprint:preview.fingerprint}),error=>error.status===409);review.review('default',person.id,fact.id,{action:'reject',fingerprint:preview.fingerprint});
  const metadata=proposeValue(store,'default',{entity_id:source.id,property_name:'Source URL',value:'https://metadata.example',origin:'imported',source_file_id:file.id});let meta=review.list('default',source.id).find(item=>item.id===metadata.id);assert.equal(meta.stale,false);
  store.run('UPDATE source_files SET source_url=? WHERE id=?','https://changed.example',file.id);meta=review.list('default',source.id).find(item=>item.id===metadata.id);assert.equal(meta.stale,true);
  store.run('DELETE FROM source_files WHERE id=?',file.id);meta=review.list('default',source.id).find(item=>item.id===metadata.id);assert.equal(meta.stale,true);assert.equal(meta.source_file_id,null);
 }finally{files.close();db.close();rmSync(dir,{recursive:true,force:true});}
});

test('retain both preserves custom date temporal binding and refuses custom hierarchy cycles',()=>fixture(({db,store,knowledge,entity,review,propose})=>{
 const governance=new PropertyDefinitionGovernance(store),date=governance.create('default',{name:'Observed Date',key:'observed_date',scope:{kind:'main_type',type:'person'},valueKind:'date',cardinality:'one'});
 knowledge.property('default',entity.id,{name:date.legacyName,value:'1815',definition_id:date.id});const proposal=propose({property_name:date.legacyName,value:'1816'}),preview=review.list('default',entity.id)[0];review.review('default',entity.id,proposal.id,{action:'retain_both',fingerprint:preview.fingerprint});
 const values=knowledge.detail('default',entity.id).properties.filter(item=>item.name===date.legacyName);assert.equal(values.length,2);for(const value of values){assert.equal(value.metadata.definition_id,date.id);assert.ok(store.get('SELECT date_id FROM temporal_property_values WHERE property_id=?',value.id)?.date_id);}
 const hierarchy=governance.create('default',{name:'Mentor Hierarchy',key:'mentor_hierarchy',scope:{kind:'main_type',type:'person'},valueKind:'entity_reference',cardinality:'one',allowedTargetTypes:['person'],validation:{hierarchical:true}}),other=knowledge.create('default',{name:'Other',type:'person'});
 knowledge.property('default',other.id,{name:hierarchy.legacyName,target_id:entity.id,definition_id:hierarchy.id});const cyclic=propose({property_name:hierarchy.legacyName,target_id:other.id}),fresh=review.list('default',entity.id).find(item=>item.id===cyclic.id);assert.throws(()=>review.review('default',entity.id,cyclic.id,{action:'retain_both',fingerprint:fresh.fingerprint}),error=>error.status===409);
}));
