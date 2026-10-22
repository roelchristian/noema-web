import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {createApp} from '../src/server/http.ts';

test('entity evidence HTTP returns precise saved occurrences and source passages with vault and origin guards',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-entity-evidence-http-'));
 const db=openDatabase(path.join(dir,'db.sqlite')),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),files=new SourceFiles(store),vaults=new Vaults(store);
 let server;
 try {
  const entity=knowledge.create('default',{name:'Lumen theory',type:'concept'});
  const file=files.add('default','Research extract.md',Buffer.from('# Research\n\nLumen theory concerns conservation and symmetry.'));
  const source=knowledge.create('default',{name:'Collected Research',type:'source',attachmentIds:[file.id]});
  await files.tick();
  const page=pages.create('default',{title:'Working notes'});
  pages.update('default',page.id,{...page,blocks:[{id:'body',type:'paragraph',checked:false,content:[{text:'Study '},{entityId:entity.id},{text:' alongside '},{entityId:entity.id}]}]});
  server=createApp(store,path.resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const get=(suffix='',headers={})=>fetch(base+'/api/entities/'+entity.id+suffix,{headers:{'X-Vault-Id':'default',...headers}});
  const detail=await (await get()).json(),contexts=detail.pageMentions[0].contexts;
  assert.equal(detail.pageMentions[0].mentionCount,2);
  assert.equal(contexts[0].occurrences.length,2);
  assert.notEqual(contexts[0].occurrences[0].reference.startOffset,contexts[0].occurrences[1].reference.startOffset);
  const response=await get('/evidence');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const evidence=await response.json();assert.equal(evidence.groups[0].sourceId,source.id);assert.match(evidence.groups[0].passages[0].reference.excerpt,/Lumen theory/);
  assert.equal(evidence.groups[0].passages[0].reason,'source-mention');
  assert.equal((await get('/evidence?offset=-1')).status,400);assert.equal((await get('/evidence?offset=1.5')).status,400);
  assert.equal((await get('/evidence',{Origin:'https://unrelated.example'})).status,403);
  const other=vaults.create({name:'Other'});assert.equal((await get('/evidence',{'X-Vault-Id':other.id})).status,404);
  vaults.lock('default',{passphrase:'test-only'});assert.equal((await get('/evidence')).status,423);
 } finally {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  files.close();db.close();rmSync(dir,{recursive:true,force:true});
 }
});
