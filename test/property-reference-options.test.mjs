import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {createApp} from '../src/server/http.ts';
import path from 'node:path';

test('reference options paginate deterministic matches, aliases and scoped type/subtype filters',()=>{
 const db=openDatabase(':memory:');try {
  const store=new Store(db),knowledge=new Knowledge(store),vaults=new Vaults(store);
  const other=vaults.create({name:'Other'});
  const hidden=knowledge.create(other.id,{name:'Picker Secret',type:'place'});
  const archived=knowledge.create('default',{name:'Picker Archived',type:'place'});
  store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-10-23',archived.id);
  for(let i=0;i<65;i++)knowledge.create('default',{name:'Picker '+String(i).padStart(2,'0'),type:'place'});
  const person=knowledge.create('default',{name:'Picker Person',type:'person'});
  const language=knowledge.create('default',{name:'Picker Language',type:'culture',subtypes:['culture:language'],aliases:['Picker Alias']});
  const first=knowledge.referenceOptions('default',{query:'Picker',types:['place'],limit:30});
  const next=knowledge.referenceOptions('default',{query:'Picker',types:['place'],limit:30,offset:first.nextOffset});
  assert.equal(first.total,65);assert.equal(first.items.length,30);assert.equal(new Set([...first.items,...next.items].map(item=>item.id)).size,60);
  assert.ok(!first.items.some(item=>[hidden.id,archived.id,person.id].includes(item.id)));
  const selected=knowledge.referenceOptions('default',{query:'does not match',types:['person'],selected:archived.id});assert.deepEqual(selected.items.map(item=>item.id),[archived.id]);
  assert.deepEqual(knowledge.referenceOptions('default',{query:'Alias',types:['culture'],subtypes:['culture:language']}).items.map(item=>item.id),[language.id]);
  assert.equal(knowledge.referenceOptions('default',{query:'none',selected:hidden.id}).items.length,0);
  for(const options of [{limit:1000},{offset:-1},{offset:0.5},{types:['invalid']},{subtypes:['missing']}])assert.throws(()=>knowledge.referenceOptions('default',options),error=>error.status===400);
 }finally{db.close();}
});
test('reference options HTTP uses collection route and vault/origin guards',async()=>{
 const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store);let server;
 try {
  knowledge.create('default',{name:'HTTP Picker',type:'place'});
  server=createApp(store,path.resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
  const url='http://127.0.0.1:'+server.address().port+'/api/entities/reference-options?q=HTTP%20Picker&types=place&limit=1';
  const response=await fetch(url);assert.equal(response.status,200);assert.equal((await response.json()).items[0].name,'HTTP Picker');
  assert.equal((await fetch(url+'&offset=-1')).status,400);
  assert.equal((await fetch(url,{headers:{Origin:'https://elsewhere.example'}})).status,403);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}db.close();}
});
