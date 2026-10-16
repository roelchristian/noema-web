import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { createApp } from '../src/server/http.ts';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
test('images persist in vault folders, survive restart, and respect scope and vault locks', async () => {
  const dir=mkdtempSync(path.join(tmpdir(),'noema-images-'));
  let db, server, base;
  async function start() {
    db=openDatabase(path.join(dir,'noema.sqlite'));
    server=createApp(new Store(db),path.resolve('dist/client'));
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    base='http://127.0.0.1:'+server.address().port;
  }
  async function stop() { await new Promise(resolve=>server.close(resolve)); db.close(); server=undefined; }
  async function json(route, method='GET', body, vault='default', status=200) {
    const response=await fetch(base+'/api/'+route,{method,headers:{'X-Vault-Id':vault,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await response.json(); assert.equal(response.status,status,JSON.stringify(result)); return result;
  }
  async function upload(bytes, vault='default', status=201) {
    const response=await fetch(base+'/api/images',{method:'POST',headers:{'X-Noema-Request':'1','X-Vault-Id':vault},body:bytes});
    const result=await response.json(); assert.equal(response.status,status,JSON.stringify(result)); return result;
  }
  try {
    await start();
    const client=await fetch(base+'/');
    assert.match(client.headers.get('content-security-policy'),/img-src 'self' data: blob:/,'local image previews allow compression decoding');
    const {id}=await upload(png);
    assert.match(id,/^[0-9a-f-]{36}\.png$/);
    assert.deepEqual(readFileSync(path.join(dir,'assets','default','images',id)),png);
    const url='/api/images/'+id+'?vault=default';
    let response=await fetch(base+url);
    assert.equal(response.headers.get('content-type'),'image/png');
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
    await upload(Buffer.from('<svg onload="alert(1)"></svg>'),'default',415);
    await upload(Buffer.alloc(0),'default',400);
    await upload(Buffer.alloc(20*1024*1024+1),'default',413);
    response=await fetch(base+'/api/images',{method:'POST',body:png}); assert.equal(response.status,403);
    response=await fetch(base+'/api/images',{method:'POST',headers:{'X-Noema-Request':'1',Origin:'https://evil.example'},body:png}); assert.equal(response.status,403);
    const vault=await json('vaults','POST',{name:'Other'},'default',201);
    response=await fetch(base+'/api/images/'+id+'?vault='+vault.id); assert.equal(response.status,404);
    const page=await json('pages','POST',{title:'Image note'},'default',201);
    const blocks=[{id:'image',type:'image',checked:false,content:[],imageId:id,alt:'A test image'}];
    await json('pages/'+page.id,'PUT',{...page,blocks});
    const otherPage=await json('pages','POST',{title:'Other note'},vault.id,201);
    await json('pages/'+otherPage.id,'PUT',{...otherPage,blocks},vault.id,404);
    await json('pages/'+page.id,'PUT',{title:'Bad path',blocks:[{...blocks[0],imageId:'../noema.sqlite'}]},'default',400);
    await json('vaults/default/lock','POST',{passphrase:'test passphrase'});
    response=await fetch(base+url); assert.equal(response.status,423);
    await upload(png,'default',423);
    const abandoned=await upload(png,vault.id);
    const abandonedPath=path.join(dir,'assets',vault.id,'images',abandoned.id);
    const old=new Date(Date.now()-25*60*60*1000); utimesSync(abandonedPath,old,old);
    await stop(); await start();
    assert.ok(!existsSync(abandonedPath),'startup cleans old abandoned uploads');
    response=await fetch(base+url); assert.equal(response.status,423);
    await json('vaults/default/unlock','POST',{passphrase:'test passphrase'});
    assert.deepEqual((await json('pages/'+page.id)).blocks,blocks);
    response=await fetch(base+url); assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
    await json('pages/'+page.id,'DELETE');
    await json('trash/'+page.id+'/restore','POST',{});
    assert.deepEqual((await json('pages/'+page.id)).blocks,blocks);
  } finally {if(server) await stop(); rmSync(dir,{recursive:true,force:true});}
});
