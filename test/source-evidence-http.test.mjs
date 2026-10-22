import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourcePageImages} from '../src/server/modules/source-page-images.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {createApp} from '../src/server/http.ts';
test('evidence and page images enforce vault access and admitted PDF boundaries',{skip:process.platform!=='darwin'?'Requires macOS PDFKit, Vision, Swift and sandbox-exec':false},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-evidence-http-')),db=openDatabase(path.join(dir,'db.sqlite')),store=new Store(db),files=new SourceFiles(store),vaults=new Vaults(store);
 const server=createApp(store,path.resolve('dist/client'));
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const oldCompile=SourcePageImages.prototype.compile,oldCommand=SourcePageImages.prototype.command,oldEvidence=SourceFiles.prototype.evidence;
 try {
  const safe=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
  const file=files.add('default','ready.pdf',safe),pending=await files.admit('default','pending.pdf',safe,undefined,()=>{});
  store.run("UPDATE source_files SET status='ready',pages=1 WHERE id=?",file.id);
  const other=vaults.create({name:'Other'}),url=id=>base+'/api/source-files/'+id;
  assert.equal((await fetch(url(file.id)+'/evidence?vault='+other.id)).status,404);
  assert.equal((await fetch(url(file.id)+'/page-image/1?vault='+other.id)).status,404);
  assert.equal((await fetch(url(pending.id)+'/page-image/1')).status,409);
  assert.equal((await fetch(url(file.id)+'/page-image/0')).status,400);
  assert.equal((await fetch(url(file.id)+'/page-image/2')).status,400);
  vaults.lock('default',{passphrase:'test-lock'});
  assert.equal((await fetch(url(file.id)+'/evidence')).status,423);
  assert.equal((await fetch(url(file.id)+'/page-image/1')).status,423);
  vaults.unlock('default',{passphrase:'test-lock'});
  const evidence=await (await fetch(url(file.id)+'/evidence')).json();assert.equal(evidence.originalData,undefined);assert.equal(evidence.originalAvailable,false);
  assert.equal((await fetch(url(file.id)+'/evidence?page=0')).status,400);
  assert.equal((await fetch(url(file.id)+'/evidence?page=2')).status,400);
  SourceFiles.prototype.evidence=function(vault,id){this.require(vault,id);return {originalAvailable:true,normalization:{offsetMap:['large map']},rawExtraction:{text:'whole document',ocrPages:1,pageEvidence:[{page:1,text:'selected page'},{page:2,text:'other page'}]}};};
  const selected=await (await fetch(url(file.id)+'/evidence?page=1')).json();
  assert.equal(selected.normalization,undefined);assert.equal(selected.rawExtraction.text,undefined);assert.deepEqual(selected.rawExtraction.pageEvidence,[{page:1,text:'selected page'}]);
  SourcePageImages.prototype.compile=async()=>process.execPath;
  SourcePageImages.prototype.command=async(_program,args)=>{
   assert.equal(args[3],files.filename('default',file.id));assert.equal(args[4],'1');
   return Buffer.from([137,80,78,71,13,10,26,10]);
  };
  const response=await fetch(url(file.id)+'/page-image/1');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('cache-control'),'no-store');
 }finally{SourceFiles.prototype.evidence=oldEvidence;SourcePageImages.prototype.compile=oldCompile;SourcePageImages.prototype.command=oldCommand;await new Promise(resolve=>server.close(resolve));files.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
