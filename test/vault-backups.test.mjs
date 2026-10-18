import { SourceFiles } from '../src/server/modules/source-files.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Images} from '../src/server/modules/images.ts';
import {AIEnrichments} from '../src/server/modules/ai-enrichments.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {createApp} from '../src/server/http.ts';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
function fixture() {
  const directory=mkdtempSync(path.join(tmpdir(),'noema-backup-')),filename=path.join(directory,'noema.sqlite');
  const db=openDatabase(filename),store=new Store(db),vaults=new Vaults(store),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),images=new Images(store),backups=new VaultBackups(store);
  const vault=vaults.create({name:'My portable vault'}),custom=randomUUID(),folder=randomUUID(),child=randomUUID(),collection=randomUUID();
  store.run('INSERT INTO entity_subtypes VALUES (?,?,?,?)',custom,vault.id,'person','Researcher');
  store.run('INSERT INTO entity_type_properties VALUES (?,?,?)',vault.id,'person','research area');
  const author=knowledge.create(vault.id,{name:'A writer',aliases:['Pen name'],type:'person',subtypes:['person:writer',custom]});
  const work=knowledge.create(vault.id,{name:'A novel',type:'creativework',subtypes:['creativework:book']});
  const source=knowledge.create(vault.id,{name:'Source website',type:'source',subtypes:['source:website'],attachmentIds:[new SourceFiles(store).add(vault.id,'reference.txt',Buffer.from('Primary source original')).id]});
  knowledge.property(vault.id,work.id,{name:'author',target_id:author.id});
  knowledge.relationship(vault.id,author.id,{label:'wrote',target_id:work.id});
  const image=images.add(vault.id,png);
  let page=pages.create(vault.id,{title:'Portable note'});
  page=pages.update(vault.id,page.id,{...page,sourceIds:[source.id],blocks:[
    {id:'intro',type:'paragraph',checked:false,content:[{text:'Reading ',bold:true},{entityId:work.id,mentionText:'the novel'}]},
    {id:'table',type:'table',checked:false,content:[],rows:[[[{entityId:author.id}],[{text:'Research notes',italic:true}]]]},
    {id:'picture',type:'image',checked:false,content:[],imageId:image.id,alt:'A tiny picture'},
    {id:'equation',type:'math',checked:false,content:[{text:'E=mc^2'}]},
  ]});
  let trashed=pages.create(vault.id,{title:'Retained in Trash'});
  trashed=pages.update(vault.id,trashed.id,{...trashed,blocks:[{id:'trash-picture',type:'image',checked:false,content:[],imageId:image.id,alt:'Also used here'}]});
  pages.delete(vault.id,trashed.id);
  const enrichments=new AIEnrichments(store,pages),preferences={model:'test',reasoningEffort:'low'};
  enrichments.save(vault.id,page.id,'summary',{summary:'The writer’s novel'},page.revision,preferences);
  enrichments.save(vault.id,page.id,'entity_scan',{scan:{id:randomUUID(),revision:page.revision,suggestions:[{id:randomUUID(),name:author.name,type:'person',subtypes:[custom],aliases:[],description:'',existingId:author.id,evidence:'A writer',reason:'Mentioned',status:'pending'}]}},page.revision,preferences);
  store.run('INSERT INTO collections VALUES (?,?,?)',collection,vault.id,'Reading');
  store.run('INSERT INTO folders VALUES (?,?,?,?)',folder,vault.id,'Desk',null);
  store.run('INSERT INTO folders VALUES (?,?,?,?)',child,vault.id,'Nested desk',folder);
  store.run('INSERT INTO item_locations VALUES (?,?,?,?)',vault.id,'page',page.id,child);
  store.run('INSERT INTO collection_memberships VALUES (?,?,?,?)',vault.id,'page',page.id,collection);
  store.run('INSERT INTO collection_memberships VALUES (?,?,?,?)',vault.id,'entity',author.id,collection);
  store.run('INSERT INTO favourites VALUES (?,?,?)',vault.id,'folder',child);
  store.run('INSERT INTO favourites VALUES (?,?,?)',vault.id,'entity',author.id);
  store.run('INSERT INTO embedding_settings (vault_id,automatic,min_characters) VALUES (?,?,?)',vault.id,0,40);
  store.run('INSERT INTO note_embeddings VALUES (?,?,?,?,?,?,?,?)',page.id,'test',2,'test-hash',page.revision,JSON.stringify([0.2,0.4]),12,new Date().toISOString());
  store.run('INSERT INTO metadata VALUES (?,?)','private-setting','must-not-export');
  return {directory,filename,db,store,vaults,knowledge,pages,images,backups,vault,page,author,work,source,custom,image,trashed,
    close(){db.close();rmSync(directory,{recursive:true,force:true});}};
}
function archive(bytes) {return JSON.parse(gunzipSync(bytes).toString('utf8'));}
function rewrite(bytes,change) {const value=archive(bytes);change(value);return gzipSync(JSON.stringify(value));}
function imageFiles(directory) {const root=path.join(directory,'assets');return existsSync(root)?readdirSync(root,{recursive:true}).filter(value=>/\.(png|jpg|gif|webp)$/.test(value)).sort():[];}

test('compressed backup round trips the vault, remaps all references, and supports repeated imports',async()=>{
  const state=fixture();const {db,store,vault,vaults,backups,pages,knowledge,images,page}=state;
  try {
    vaults.lock(vault.id,{passphrase:'private passphrase'});vaults.unlock(vault.id,{passphrase:'private passphrase'});
    const exported=await backups.export(vault.id),manifest=archive(exported.bytes);
    assert.match(exported.filename,/\.noemabkp$/);assert.equal(exported.bytes[0],0x1f);assert.equal(exported.bytes[1],0x8b);
    assert.equal(manifest.format,'noema-vault-backup');assert.equal(manifest.version,1);
    assert.equal(manifest.tables.pages.length,2);assert.equal(manifest.images.length,1);
    assert.doesNotMatch(JSON.stringify(manifest),/private passphrase|password_hash|private-setting|must-not-export|A place for connected ideas/);
    const restored=await backups.import(exported.bytes,'Restored copy');
    assert.equal(restored.name,'Restored copy');assert.equal(restored.locked,false);assert.equal(restored.protected,false);assert.notEqual(restored.id,vault.id);
    const entityList=knowledge.list(restored.id),author=entityList.find(entity=>entity.name==='A writer'),work=entityList.find(entity=>entity.name==='A novel'),source=entityList.find(entity=>entity.type==='source');
    assert.notEqual(author.id,state.author.id);assert.deepEqual(author.aliases,['Pen name']);
    assert.ok(author.subtypes.includes('person:writer'));const custom=author.subtypes.find(id=>id!=='person:writer');assert.notEqual(custom,state.custom);
    assert.equal(knowledge.schema(restored.id).subtypes.find(item=>item.id===custom).name,'Researcher');
    assert.ok(knowledge.schema(restored.id).properties.person.includes('research area'));
    assert.equal(knowledge.detail(restored.id,work.id).properties.find(item=>item.name==='author').target_id,author.id);
    assert.equal(knowledge.detail(restored.id,author.id).relationships[0].target_id,work.id);
    const restoredPage=pages.get(restored.id,pages.list(restored.id)[0].id);
    assert.notEqual(restoredPage.id,page.id);assert.equal(restoredPage.title,page.title);assert.equal(restoredPage.revision,page.revision);
    assert.equal(restoredPage.updated_at,page.updated_at);assert.deepEqual(restoredPage.sourceIds,[source.id]);
    assert.equal(restoredPage.blocks[0].content[0].bold,true);assert.equal(restoredPage.blocks[0].content[1].entityId,work.id);
    assert.equal(restoredPage.blocks[0].content[1].mentionText,'the novel');assert.equal(restoredPage.blocks[1].rows[0][0][0].entityId,author.id);
    assert.notEqual(restoredPage.blocks[2].imageId,state.image.id);assert.deepEqual(images.get(restored.id,restoredPage.blocks[2].imageId).bytes,png);
    assert.equal(restoredPage.blocks[3].content[0].text,'E=mc^2');assert.equal(pages.trash(restored.id)[0].title,'Retained in Trash');
    const enrichments=new AIEnrichments(store,pages).list(restored.id,restoredPage.id),summary=enrichments.find(item=>item.kind==='summary'),scan=enrichments.find(item=>item.kind==='entity_scan').data.scan;
    assert.equal(summary.data.summary,'The writer’s novel');assert.equal(summary.contentHash,restoredPage.summaryContentHash);
    assert.equal(scan.suggestions[0].existingId,author.id);assert.deepEqual(scan.suggestions[0].subtypes,[custom]);
    const folders=store.all('SELECT * FROM folders WHERE vault_id=?',restored.id),nested=folders.find(item=>item.name==='Nested desk');
    assert.equal(nested.parent_id,folders.find(item=>item.name==='Desk').id);
    assert.equal(store.get('SELECT folder_id FROM item_locations WHERE vault_id=? AND item_id=?',restored.id,restoredPage.id).folder_id,nested.id);
    const collection=store.get('SELECT id FROM collections WHERE vault_id=?',restored.id).id;
    assert.equal(store.get('SELECT count(*) AS count FROM collection_memberships WHERE vault_id=? AND collection_id=?',restored.id,collection).count,2);
    assert.equal(store.get('SELECT count(*) AS count FROM favourites WHERE vault_id=?',restored.id).count,2);
    assert.equal(store.get('SELECT automatic FROM embedding_settings WHERE vault_id=?',restored.id).automatic,0);
    assert.equal(store.get('SELECT vector FROM note_embeddings WHERE page_id=?',restoredPage.id).vector,'[0.2,0.4]');
    const again=await backups.import(exported.bytes);assert.equal(again.name,vault.name);assert.notEqual(again.id,restored.id);
    assert.equal(pages.list(again.id).length,1);assert.equal(pages.get(vault.id,page.id).blocks[0].content[1].entityId,state.work.id);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {state.close();}
});

test('damaged, unsupported, cyclic and cross-vault reference backups leave no partial vault or images',async()=>{
  const state=fixture();
  try {
    const {bytes}=await state.backups.export(state.vault.id),before=state.vaults.list().length,files=imageFiles(state.directory);
    const damaged=Buffer.from(bytes);damaged[damaged.length-6]^=0xff;
    const cases=[Buffer.from('not a backup'),damaged,
      rewrite(bytes,value=>value.version=999),
      rewrite(bytes,value=>value.tables.folders[0].parent_id=value.tables.folders[0].id),
      rewrite(bytes,value=>value.tables.page_sources[0].source_id='ursula'),
      rewrite(bytes,value=>value.tables.pages[0].blocks=JSON.stringify([{id:'bad',type:'paragraph',checked:false,content:[{entityId:'ursula'}]}])),
      rewrite(bytes,value=>value.tables.entities.push(value.tables.entities[0])),
      rewrite(bytes,value=>value.images.push(value.images[0])),
      rewrite(bytes,value=>value.tables.pages[0].blocks=JSON.stringify([{id:'bad',type:'image',checked:false,content:[],imageId:'../noema.sqlite'}])),
      rewrite(bytes,value=>delete value.tables.entities),
      rewrite(bytes,value=>value.tables.pages[0].icon='invalid-icon'),
    ];
    for(const input of cases) {
      await assert.rejects(state.backups.import(input),error=>error.status>=400&&error.status<500);
      assert.equal(state.vaults.list().length,before);assert.deepEqual(imageFiles(state.directory),files);
      assert.deepEqual(state.db.prepare('PRAGMA foreign_key_check').all(),[]);
    }
  } finally {state.close();}
});

test('backup endpoints support binary download/import and enforce access, client headers and same-origin checks',async()=>{
  const state=fixture(),server=createApp(state.store,path.resolve('dist/client'));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port+'/api/vaults',headers={'X-Noema-Request':'1'};
  try {
    let response=await fetch(base+'/'+state.vault.id+'/backup');assert.equal(response.status,403);
    response=await fetch(base+'/'+state.vault.id+'/backup',{headers:{...headers,Origin:'https://other.example'}});assert.equal(response.status,403);
    response=await fetch(base+'/'+state.vault.id+'/backup',{headers});assert.equal(response.status,200);
    assert.equal(response.headers.get('Content-Type'),'application/x-noema-backup');assert.match(response.headers.get('Content-Disposition'),/\.noemabkp/);
    const bytes=Buffer.from(await response.arrayBuffer());
    response=await fetch(base+'/import',{method:'POST',headers:{'Content-Type':'application/x-noema-backup'},body:bytes});assert.equal(response.status,403);
    response=await fetch(base+'/import',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,415);
    response=await fetch(base+'/import?name=Imported%20via%20HTTP',{method:'POST',headers:{...headers,'Content-Type':'application/x-noema-backup'},body:bytes});assert.equal(response.status,201);
    const restored=await response.json();assert.equal(restored.name,'Imported via HTTP');assert.notEqual(restored.id,state.vault.id);
    state.vaults.lock(state.vault.id,{passphrase:'test passphrase'});
    response=await fetch(base+'/'+state.vault.id+'/backup',{headers});assert.equal(response.status,423);
    await assert.rejects(state.backups.export(state.vault.id),error=>error.status===423);
    response=await fetch(base+'/missing/backup',{headers});assert.equal(response.status,404);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));state.close();}
});

test('an imported vault and its images remain available after restarting the database',async()=>{
  const state=fixture();let reopened;
  try {
    const {bytes}=await state.backups.export(state.vault.id),restored=await state.backups.import(bytes);
    state.db.close();reopened=openDatabase(state.filename);
    const store=new Store(reopened),pages=new Pages(store,new Knowledge(store)),page=pages.get(restored.id,pages.list(restored.id)[0].id);
    assert.deepEqual(new Images(store).get(restored.id,page.blocks[2].imageId).bytes,png);
    assert.equal(new AIEnrichments(store,pages).list(restored.id,page.id).find(item=>item.kind==='summary').contentHash,page.summaryContentHash);
  } finally {if(reopened)reopened.close();else state.db.close();rmSync(state.directory,{recursive:true,force:true});}
});
