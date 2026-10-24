import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {blockPageLinks,pageLinks,resolvePageLink,stablePageLink} from '../src/shared/page-links.ts';
const blocks=text=>[{id:'synthetic',type:'paragraph',checked:false,content:[{text}]}];
test('stable page IDs survive renames; ambiguous legacy titles never establish backlinks',()=>{
 const db=openDatabase(':memory:');try {
  const store=new Store(db),pages=new Pages(store,new Knowledge(store));
  let target=pages.create('default',{title:'Synthetic same'}),duplicate=pages.create('default',{title:'Synthetic same'}),source=pages.create('default',{title:'Synthetic source'});
  source=pages.update('default',source.id,{...source,blocks:blocks('[[Synthetic same]]')});
  assert.deepEqual(pages.backlinks('default',target.id),[]);assert.deepEqual(pages.backlinks('default',duplicate.id),[]);
  source=pages.update('default',source.id,{...source,blocks:blocks(stablePageLink(target.id,'Original visible label'))});
  target=pages.update('default',target.id,{...target,title:'Synthetic renamed'});
  assert.equal(pages.backlinks('default',target.id)[0].id,source.id);assert.deepEqual(pages.backlinks('default',duplicate.id),[]);
  const link=blockPageLinks(source.blocks)[0];assert.equal(link.label,'Original visible label');assert.equal(resolvePageLink(link,[target,duplicate])[0].id,target.id);
  assert.equal(blockPageLinks([{...source.blocks[0],type:'code'}]).length,0);
 }finally{db.close();}
});
test('page associations retain independent text links, reject cross-vault targets, and backup remaps associations and links',async()=>{
 const db=openDatabase(':memory:');try {
  const store=new Store(db),pages=new Pages(store,new Knowledge(store)),backups=new VaultBackups(store);
  let source=pages.create('default',{title:'Synthetic source'}),target=pages.create('default',{title:'Synthetic target'});
  const literal=stablePageLink(target.id,'Literal code');
  source=pages.update('default',source.id,{...source,blocks:[...blocks(stablePageLink(target.id,'Label')),{id:'literal-code',type:'code',checked:false,content:[{text:literal}]}]});
  pages.associate('default',source.id,target.id,{pinned:true,annotation:'Deliberate'});pages.associate('default',target.id,source.id,{});
  assert.equal(store.get('SELECT COUNT(*) AS n FROM page_page_associations').n,1);
  pages.associate('default',source.id,target.id,{pinned:false});assert.equal(pages.associations('default',source.id)[0].annotation,'Deliberate');
  const foreign=new Vaults(store).create({name:'Synthetic other'});const other=pages.create(foreign.id,{title:'Foreign'});
  assert.throws(()=>pages.associate('default',source.id,other.id,{}),e=>e.status===404);
  assert.throws(()=>pages.associate('default',source.id,source.id,{}),e=>e.status===400);
  const exported=await backups.export('default'),restored=await backups.import(exported.bytes,'Synthetic restored');
  const catalog=pages.list(restored.id),rs=catalog.find(p=>p.title===source.title),rt=catalog.find(p=>p.title===target.title);
  assert.equal(pages.associations(restored.id,rs.id)[0].id,rt.id);
  assert.equal(pageLinks(pages.get(restored.id,rs.id).blocks[0].content[0].text)[0].pageId,rt.id);
  assert.equal(pages.backlinks(restored.id,rt.id)[0].id,rs.id);
  assert.equal(pages.get(restored.id,rs.id).blocks[1].content[0].text,literal);
  const versions=store.all('SELECT snapshot_json FROM page_versions WHERE page_id=?',rs.id).map(row=>JSON.parse(row.snapshot_json));
  assert.ok(versions.some(version=>version.blocks.some(block=>block.type==='code'&&block.content[0].text===literal)));
  assert.ok(versions.some(version=>version.blocks.some(block=>block.content.some(segment=>segment.text?.includes('[[page:'+rt.id+'|Label]]')))));
  pages.removeAssociation('default',source.id,target.id);pages.removeAssociation('default',source.id,target.id);
  assert.deepEqual(pages.associations('default',source.id),[]);assert.equal(pages.backlinks('default',target.id)[0].id,source.id);
 }finally{db.close();}
});
