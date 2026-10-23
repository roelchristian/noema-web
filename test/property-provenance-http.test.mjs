import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {httpFixture} from './helpers/http.mjs';
import {proposeValue,getNameProvenance} from '../src/server/modules/property-provenance.ts';
test('old property API retains authored values, records manual provenance and scopes explicit review',async t=>{
 const {store,json:call}=await httpFixture(t,{headers:{'X-Vault-Id':'default'}}),knowledge=new Knowledge(store);
  const entity=knowledge.create('default',{name:'Authored',type:'person'}),prefix='entities/'+entity.id;
  assert.equal(getNameProvenance(store,'default',entity.id).origin,'manual');
  const raw='  uncertain URL from a legacy client  ';
  let response=await call(prefix+'/properties','POST',{name:'website',value:raw});assert.equal(response.status,201);let detail=await response.json();const property=detail.properties[0];assert.equal(property.value,raw);assert.equal(property.provenance.origin,'manual');
  const proposal=proposeValue(store,'default',{entity_id:entity.id,origin:'ai',property_name:'website',value:'https://suggested.example'});
  response=await call(prefix+'/property-proposals');assert.equal(response.status,200);const [preview]=await response.json();assert.equal(preview.id,proposal.id);
  response=await call(prefix+'/property-proposals/'+encodeURIComponent(proposal.id)+'/review','POST',{action:'reject',fingerprint:preview.fingerprint});assert.equal(response.status,200);assert.equal((await response.json()).status,'rejected');
  detail=await (await call(prefix)).json();assert.equal(detail.properties[0].id,property.id);assert.equal(detail.properties[0].value,raw);assert.equal(detail.propertyProposalCount,1);
  const other=knowledge.create('default',{name:'Other',type:'person'});assert.equal((await call('entities/'+other.id+'/property-proposals/'+encodeURIComponent(proposal.id)+'/review','POST',{action:'reject',fingerprint:preview.fingerprint})).status,404);
});
