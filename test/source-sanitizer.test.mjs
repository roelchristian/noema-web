import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {scanSourcePDF} from '../src/server/modules/source-import.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
function setup(){const dir=mkdtempSync(path.join(tmpdir(),'noema-sanitizer-')),db=openDatabase(path.join(dir,'db.sqlite')),store=new Store(db);return {dir,db,store,files:new SourceFiles(store),knowledge:new Knowledge(store)};}
test('sanitized asset reuse is content/version scoped and scanner-gated; interrupted provenance rebuilds',{skip:process.platform!=='darwin'?'Requires macOS PDFKit, Vision, Swift and sandbox-exec':false},async()=>{
 const e=setup();try{
  const original=Buffer.from('%PDF-1.4\n/ObjStm\n%%EOF'),safe=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');let sanitizations=0;
  e.files.pdf=async()=>({text:'1. Introduction\nOriginal text.',pages:1,ocrPages:0,pageStartLines:[1]});
  e.files.flattenPDF=async()=>{sanitizations++;return safe;};
  async function add(){const f=await e.files.admit('default','cached.pdf',original,undefined,()=>{});e.knowledge.create('default',{name:'Cached',type:'source',attachmentIds:[f.id]});await e.files.tick();assert.equal(e.files.require('default',f.id).status,'ready');return f;}
  const first=await add(),second=await add();assert.equal(sanitizations,1);assert.equal(e.files.evidence('default',second.id).flattening.cacheHit,true);
  // A valid hash alone never authorizes unsafe cached content.
  const malicious=Buffer.from('%PDF-1.4\n/JavaScript\n%%EOF');
  for(const file of [first,second]){
   writeFileSync(e.files.filename('default',file.id),malicious);
   const manifest=e.files.evidence('default',file.id);manifest.admittedHash=sha(malicious);
   writeFileSync(path.join(e.files.root,'default','source-evidence',file.id,'manifest.json'),JSON.stringify(manifest));
  }
  const third=await add();assert.equal(sanitizations,2);assert.equal(e.files.evidence('default',third.id).flattening.cacheHit,false);
  // Simulate crash after writing new manifest but before publishing matching bytes.
  const manifest=e.files.evidence('default',third.id);manifest.admittedHash='0'.repeat(64);
  writeFileSync(path.join(e.files.root,'default','source-evidence',third.id,'manifest.json'),JSON.stringify(manifest));
  e.files.retry('default',third.id);await e.files.tick();assert.equal(sanitizations,3);assert.equal(e.files.evidence('default',third.id).admittedHash,sha(safe));
 }finally{e.files.close();e.db.close();rmSync(e.dir,{recursive:true,force:true});}
});
test('native sanitizer removes active objects and rasterizes visible annotation appearances',{skip:process.platform!=='darwin'?'Requires macOS PDFKit, Vision, Swift and sandbox-exec':process.env.NOEMA_NATIVE_TESTS!=='1'?'Set NOEMA_NATIVE_TESTS=1 for native sanitizer integration':false},async()=>{
 const e=setup();try{
  const bytes=readFileSync(new URL('./fixtures/source-sanitizer/active-with-visible-annotation.pdf',import.meta.url));
  assert.throws(()=>scanSourcePDF(bytes));
  const safe=await e.files.flattenPDF(bytes);assert.doesNotThrow(()=>scanSourcePDF(safe));
  assert.equal(e.files.lastSanitization.method,'raster');assert.match(e.files.lastSanitization.fallbackReason,/Visible PDF annotations/);
  for(const name of ['/Annots','/OpenAction','/JavaScript','/EmbeddedFiles','/Filespec','/Launch','/URI'])assert.equal(safe.includes(Buffer.from(name)),false,name);
 }finally{e.files.close();e.db.close();rmSync(e.dir,{recursive:true,force:true});}
});

test('provider admission uses isolated macOS reconstruction for object streams and retains original evidence',{skip:process.platform!=='darwin'?'Requires macOS provider admission route':false},async t=>{
 const e=setup();t.after(()=>{e.files.close();e.db.close();rmSync(e.dir,{recursive:true,force:true});});
 const original=Buffer.from('%PDF-1.4\n1 0 obj << /Type /ObjStm >> stream\nopaque\nendstream endobj\n%%EOF');
 const safe=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
 const file=e.files.add('default','compressed.pdf',original,undefined,undefined,false,true);
 let flattened=0,counted=0;
 e.files.flattenPDF=async bytes=>{flattened++;assert.deepEqual(bytes,original);e.files.lastSanitization={method:'passive-rebuild'};return safe;};
 const platform={admit:async()=>{assert.fail('Darwin reconstruction must use isolated native flattener');},count:async bytes=>{counted++;assert.deepEqual(bytes,safe);return 3;}};
 const admitted=await e.files.prepareProviderPDF('default',file.id,platform);
 assert.deepEqual(admitted.bytes,safe);assert.equal(admitted.pageCount,3);
 assert.equal(admitted.originalHash,sha(original));assert.equal(admitted.admittedHash,sha(safe));
 const manifest=e.files.evidence('default',file.id);
 assert.equal(manifest.originalHash,sha(original));assert.equal(manifest.admittedHash,sha(safe));assert.equal(manifest.admissionMethod,'native-passive-rebuild');
 assert.deepEqual(readFileSync(path.join(e.files.root,'default','source-evidence',file.id,'original')),original);
 assert.equal(e.files.require('default',file.id).pdf_flattened,1);assert.equal(e.files.require('default',file.id).admitted,1);
 await e.files.prepareProviderPDF('default',file.id,platform);
 assert.equal(flattened,1,'resuming reuses admitted bytes');assert.equal(counted,2);
});

test('provider native reconstruction cannot publish unsafe output or output after cancellation',{skip:process.platform!=='darwin'?'Requires macOS provider admission route':false},async t=>{
 const e=setup();t.after(()=>{e.files.close();e.db.close();rmSync(e.dir,{recursive:true,force:true});});
 const original=Buffer.from('%PDF-1.4\n/ObjStm\n%%EOF');
 const file=e.files.add('default','compressed.pdf',original,undefined,undefined,false,true);
 let count=0;const platform={admit:async()=>assert.fail('Unexpected portable admission'),count:async()=>{count++;return 3;}};
 e.files.flattenPDF=async()=>Buffer.from('%PDF-1.4\n/JavaScript\n%%EOF');
 await assert.rejects(()=>e.files.prepareProviderPDF('default',file.id,platform),/safety screening/);
 assert.equal(count,0);assert.equal(e.files.require('default',file.id).admitted,0);
 const controller=new AbortController();
 e.files.flattenPDF=async()=>{controller.abort();return Buffer.from('%PDF-1.4\n%%EOF');};
 await assert.rejects(()=>e.files.prepareProviderPDF('default',file.id,platform,controller.signal),/stopped/);
 assert.equal(count,0);assert.equal(e.files.require('default',file.id).admitted,0);
 assert.deepEqual(readFileSync(e.files.assetFilename('default',file.id)),original);
});

test('clean provider PDF keeps portable admission and does not reconstruct',async t=>{
 const e=setup();t.after(()=>{e.files.close();e.db.close();rmSync(e.dir,{recursive:true,force:true});});
 const original=Buffer.from('%PDF-1.4\n%%EOF'),file=e.files.add('default','clean.pdf',original,undefined,undefined,false,true);
 e.files.flattenPDF=async()=>assert.fail('Clean bytes must not be reconstructed');
 let calls=0;
 const platform={admit:async bytes=>{calls++;assert.deepEqual(bytes,original);return {bytes,pages:3,flattened:false,method:'screened-original'};},count:async()=>assert.fail('Initial admission counts through portable platform')};
 await e.files.prepareProviderPDF('default',file.id,platform);
 assert.equal(calls,1);assert.equal(e.files.require('default',file.id).pdf_flattened,0);
 assert.equal(e.files.evidence('default',file.id).admissionMethod,'screened-original');
});
