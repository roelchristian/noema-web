import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, utimesSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Images, imageUploadGraceMs } from '../src/server/modules/images.ts';
import { Pages, trashRetentionMs } from '../src/server/modules/pages.ts';
import { Knowledge } from '../src/server/modules/knowledge.ts';
import { Vaults } from '../src/server/modules/vaults.ts';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { parseImageCompression } from '../src/client/settings/image-settings.ts';
import { compressImage, imageDimensions } from '../src/client/editor/compress-image.ts';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
function fixture(work) {
  const dir=mkdtempSync(path.join(tmpdir(),'noema-image-cleanup-')), db=openDatabase(path.join(dir,'noema.sqlite'));
  const store=new Store(db), images=new Images(store); let time=Date.now();
  const pages=new Pages(store,new Knowledge(store),()=>new Date(time));
  const filename=(id,vault='default')=>path.join(dir,'assets',vault,'images',id);
  const attach=(id,title='Note',vault='default')=>{const page=pages.create(vault,{title}); return pages.update(vault,page.id,{...page,blocks:[{id:'image',type:'image',content:[],imageId:id}]});};
  try {work({store,images,pages,filename,attach,advance:ms=>{time+=ms;}});} finally {db.close();rmSync(dir,{recursive:true,force:true});}
}
test('cleanup protects shared images in active notes and Trash until their final reference is permanently deleted',()=>fixture(({images,pages,filename,attach})=>{
  const {id}=images.add('default',png), first=attach(id), second=attach(id);
  pages.delete('default',first.id); pages.delete('default',second.id);
  assert.equal(images.cleanup(undefined,undefined,Date.now()+2*imageUploadGraceMs),0);
  pages.permanentlyDelete('default',first.id); assert.ok(existsSync(filename(id)));
  const restored=pages.restore('default',second.id); assert.equal(restored.blocks[0].imageId,id);
  pages.delete('default',second.id); pages.permanentlyDelete('default',second.id);
  assert.ok(!existsSync(filename(id)));
}));
test('saved block removal deletes only unreferenced images; stale saves do not remove files',()=>fixture(({images,pages,filename,attach})=>{
  const {id}=images.add('default',png), first=attach(id), second=attach(id);
  pages.update('default',first.id,{...first,blocks:[]}); assert.ok(existsSync(filename(id)));
  assert.throws(()=>pages.update('default',second.id,{...second,revision:0,blocks:[]}),error=>error.status===409);
  assert.ok(existsSync(filename(id)));
  pages.update('default',second.id,{...second,blocks:[]}); assert.ok(!existsSync(filename(id)));
}));
test('expired Trash releases images, including scoped purges without touching another vault',()=>fixture(({store,images,pages,filename,attach,advance})=>{
  const vault=new Vaults(store).create({name:'Other'});
  const first=images.add('default',png), other=images.add(vault.id,png);
  const page=attach(first.id), otherPage=attach(other.id,'Other',vault.id);
  pages.delete('default',page.id); pages.delete(vault.id,otherPage.id);
  advance(trashRetentionMs+1); pages.purgeExpired('default');
  assert.ok(!existsSync(filename(first.id))); assert.ok(existsSync(filename(other.id,vault.id)));
  pages.purgeExpired(); assert.ok(!existsSync(filename(other.id,vault.id)));
}));
test('sweeps remove abandoned uploads after the grace period while retaining fresh uploads and referenced files',()=>fixture(({images,pages,filename,attach})=>{
  const abandoned=images.add('default',png), pending=images.add('default',png), used=images.add('default',png);
  const old=new Date(Date.now()-imageUploadGraceMs-1000);
  utimesSync(filename(abandoned.id),old,old); utimesSync(filename(used.id),old,old);
  const note=attach(used.id); pages.delete('default',note.id);
  writeFileSync(path.join(path.dirname(filename(used.id)),'keep.txt'),'unmanaged file');
  assert.equal(images.cleanup(),1);
  assert.ok(!existsSync(filename(abandoned.id))); assert.ok(existsSync(filename(pending.id))); assert.ok(existsSync(filename(used.id)));
  assert.ok(existsSync(path.join(path.dirname(filename(used.id)),'keep.txt')));
}));
test('compression defaults on, persists an explicit off setting, and bounds dimensions without upscaling',()=>{
  for(const raw of [null,'invalid','{}','{"autoCompress":true}']) assert.equal(parseImageCompression(raw),true);
  assert.equal(parseImageCompression('{"autoCompress":false}'),false);
  assert.deepEqual(imageDimensions(6000,4000),{width:2560,height:1707});
  assert.deepEqual(imageDimensions(1000,5000),{width:512,height:2560});
  assert.deepEqual(imageDimensions(300,200),{width:300,height:200});
});
test('compression leaves GIF and animated WebP bytes intact',async()=>{
  const gif=new File([Buffer.from('GIF89a')],'animated.gif',{type:'image/gif'});
  assert.equal(await compressImage(gif),gif);
  const header=Buffer.alloc(21); header.write('RIFF',0);header.write('WEBPVP8X',8);header[20]=2;
  const webp=new File([header],'animated.webp',{type:'image/webp'});
  assert.equal(await compressImage(webp),webp);
});
test('compression preserves APNG animation and safely falls back when decoding fails',async()=>{
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  const animation=Buffer.alloc(12); animation.write('acTL',4);
  const apng=new File([signature,animation],'animated.png',{type:'image/png'});
  assert.equal(await compressImage(apng),apng);
  const corrupt=new File([png.subarray(0,10)],'bad.png',{type:'image/png'});
  assert.equal(await compressImage(corrupt),corrupt);
});

test('static compression draws at bounded dimensions and keeps the original if output is larger or encoding fails',async()=>{
  const previousImage=globalThis.Image, previousDocument=globalThis.document;
  const calls=[]; let encoded=new Blob(['small'],{type:'image/webp'});
  globalThis.Image=class {naturalWidth=6000;naturalHeight=4000;async decode(){}};
  globalThis.document={createElement:()=>({getContext:()=>({drawImage:(_img,x,y,width,height)=>calls.push({width,height})}),toBlob:callback=>callback(encoded)})};
  try {
    const original=new File([png],'photo.png',{type:'image/png'});
    const result=await compressImage(original);
    assert.equal(result.type,'image/webp'); assert.equal(await result.text(),'small');
    assert.deepEqual(calls[0],{width:2560,height:1707});
    encoded=new Blob([Buffer.alloc(500)],{type:'image/webp'});
    assert.equal(await compressImage(original),original);
    encoded=null; assert.equal(await compressImage(original),original);
  } finally {globalThis.Image=previousImage;globalThis.document=previousDocument;}
});
