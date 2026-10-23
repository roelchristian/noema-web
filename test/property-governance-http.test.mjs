import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {createApp} from '../src/server/http.ts';
test('governance HTTP previews confirm compatibility, scope definitions and guard legacy hierarchy writes',async()=>{
 const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store);let server;
 try{
  server=createApp(store,path.resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port+'/api/';
  const call=(path,method='GET',body)=>fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Vault-Id':'default'},...(body?{body:JSON.stringify(body)}:{})});
  let response=await call('entity-schema/definitions','POST',{name:'Historical note',key:'historical_note',scope:{kind:'main_type',type:'person'},valueKind:'short_text'});assert.equal(response.status,201);const definition=await response.json();
  const person=knowledge.create('default',{name:'HTTP Historic Person',type:'person'});
  knowledge.property('default',person.id,{name:definition.legacyName,value:'one'});knowledge.property('default',person.id,{name:definition.legacyName,value:'two'});
  const route='entity-schema/definitions/'+encodeURIComponent(definition.id),patch={cardinality:'one'};
  response=await call(route+'/impact','POST',patch);assert.equal(response.status,200);const impact=await response.json();assert.equal(impact.incompatible.length,2);
  assert.equal((await call(route,'PUT',patch)).status,409);
  assert.equal((await call(route,'PUT',{...patch,impactFingerprint:impact.fingerprint,confirmCompatibility:true})).status,200);
  response=await call('entities/'+person.id+'/classification-impact','POST',{type:'place',subtypes:[]});const classification=await response.json();assert.equal(response.status,200);assert.equal(classification.requiresConfirmation,true);
  assert.equal((await call('entities/'+person.id,'PUT',{name:person.name,type:'place',subtypes:[]})).status,400);
  response=await call('entities/'+person.id,'PUT',{name:person.name,type:'place',subtypes:[],classification_mode:'retain_legacy',impact_fingerprint:classification.fingerprint});assert.equal(response.status,200);const changed=await response.json();assert.equal(changed.properties.length,2);assert.ok(changed.properties.every(property=>property.metadata.definition_id===definition.id));
  assert.equal((await call('entity-schema/definitions/'+encodeURIComponent('builtin:person:birth_date'),'PUT',{label:'Changed'})).status,403);
  const first=knowledge.create('default',{name:'First hierarchy place',type:'place'}),second=knowledge.create('default',{name:'Second hierarchy place',type:'place'});
  assert.equal((await call('entities/'+first.id+'/properties','POST',{name:'parent place',target_id:second.id})).status,201);
  assert.equal((await call('entities/'+second.id+'/properties','POST',{name:'parent place',target_id:first.id})).status,409);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}db.close();}
});
