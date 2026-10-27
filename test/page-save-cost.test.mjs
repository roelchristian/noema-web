import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Images} from '../src/server/modules/images.ts';
import {PageHistory} from '../src/server/modules/page-history.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'noema-save-cost-')),db=openDatabase(path.join(dir,'db.sqlite')),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),images=new Images(store);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});return {dir,store,knowledge,pages,images};
}
test('text, image reorder and duplicate removal saves skip image maintenance; actual removal retains history and shared references',t=>{
 const {dir,store,pages,images}=fixture(t),image=images.add('default',png),second=images.add('default',png);
 const block=id=>({id,type:'image',content:[],imageId:image.id});
 let page=pages.create('default',{title:'Synthetic images'});
 page=pages.update('default',page.id,{...page,featuredImageId:image.id,blocks:[block('one'),block('duplicate'),{id:'two',type:'image',content:[],imageId:second.id}]});
 const originalCleanup=Images.prototype.cleanup;
 const cleanup=t.mock.method(Images.prototype,'cleanup',function(...args){return originalCleanup.apply(this,args);});
 page=pages.update('default',page.id,{...page,title:'Text edit',blocks:[page.blocks[2],{...block('one'),alt:'new caption'}]});
 assert.equal(cleanup.mock.callCount(),0);
 const originalAll=store.all;
 const bodyScans=t.mock.method(store,'all',function(sql,...params){assert.ok(!sql.startsWith('SELECT blocks,featured_image_id FROM pages'),'routine save must not scan every note body');return originalAll.call(this,sql,...params);});
 page=pages.update('default',page.id,{...page,title:'Another text edit'});
 assert.equal(cleanup.mock.callCount(),0);bodyScans.mock.restore();
 const before=store.get('SELECT count(*) AS n FROM page_versions WHERE page_id=?',page.id).n;
 assert.throws(()=>pages.update('default',page.id,{...page,revision:0,blocks:[]}),error=>error.status===409);
 assert.equal(cleanup.mock.callCount(),0);assert.equal(store.get('SELECT count(*) AS n FROM page_versions WHERE page_id=?',page.id).n,before);
 page=pages.update('default',page.id,{...page,blocks:[],featuredImageId:null});
 assert.equal(cleanup.mock.callCount(),1);assert.deepEqual(new Set(cleanup.mock.calls[0].arguments[1]),new Set([image.id,second.id]));
 assert.ok(existsSync(path.join(dir,'assets/default/images',image.id)));
 const historical=new PageHistory(store).list('default',page.id).find(version=>new PageHistory(store).get('default',page.id,version.id).snapshot.blocks.some(block=>block.imageId===image.id));
 page=new PageHistory(store).restore('default',page.id,historical.id,{revision:page.revision},pages);
 assert.ok(page.blocks.some(block=>block.imageId===image.id));
});
test('save resolves each distinct entity once across repeated mentions and rejects cross-vault references',t=>{
 const {store,pages,knowledge}=fixture(t),entity=knowledge.create('default',{name:'Synthetic entity',type:'concept'});
 let page=pages.create('default',{title:'Repeated references'});
 const originalGet=store.get,lookups=[];const get=t.mock.method(store,'get',function(sql,...params){if(sql.includes('FROM entities WHERE vault_id=? AND id=?'))lookups.push(params);return originalGet.call(this,sql,...params);});
 page=pages.update('default',page.id,{...page,blocks:Array.from({length:200},(_,i)=>({id:String(i),type:'paragraph',content:Array.from({length:20},()=>({entityId:entity.id}))}))});
 assert.equal(lookups.filter(params=>params[1]===entity.id).length,1);
 assert.equal(page.blocks.length,200);get.mock.restore();
 const other=new Vaults(store).create({name:'Other'}),foreign=knowledge.create(other.id,{name:'Foreign entity',type:'concept'});
 assert.throws(()=>pages.update('default',page.id,{...page,blocks:[{id:'foreign',type:'paragraph',content:[{entityId:foreign.id}]}]}),error=>error.status===400);
 assert.equal(pages.get('default',page.id).revision,page.revision);
});
test('cached source offsets use displayed Unicode names and exact UTF-16 lengths',async()=>{
 const {syncSourceReferences}=await import('../src/server/modules/source-references.ts');
 for(const suppliedResolver of [false,true]){
  let nameReads=0;const inserted=[];
  const store={get(sql){if(sql.includes('FROM entities')){nameReads++;return {name:'İ😀',mentionCase:'lowercase'};}return undefined;},all(){return [];},run(sql,...params){if(sql.includes('INSERT INTO note_source_references'))inserted.push(params);}};
  const reference={id:'anchor',sourceId:'source',fileId:'file',startLine:1,endLine:1,sourceHash:'0'.repeat(64),excerpt:'Synthetic source'};
  const blocks=[{id:'block',type:'paragraph',content:[{entityId:'entity'},{entityId:'entity'},{text:'[ref]',sourceReference:reference}]}];
  syncSourceReferences(store,'page',blocks,suppliedResolver?()=>{nameReads++;return 'İ😀'.toLowerCase();}:undefined);
  assert.equal(nameReads,1);assert.equal(inserted[0][7],2*'İ😀'.toLowerCase().length);assert.equal(inserted[0][8],2*'İ😀'.toLowerCase().length+5);
 }
});
