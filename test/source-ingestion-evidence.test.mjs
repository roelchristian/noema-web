import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function setup(){const dir=mkdtempSync(path.join(tmpdir(),'noema-evidence-'));const db=openDatabase(path.join(dir,'db.sqlite'));const store=new Store(db);return {dir,db,store,files:new SourceFiles(store),knowledge:new Knowledge(store)};}
test('immutable source evidence survives normalization, retry and backup; hash tampering is rejected',async()=>{
 const env=setup();const {files,knowledge,store}=env;
 try {
  const original=Buffer.from('# Introduction\nA line of text.\nAnother line.');
  const file=files.add('default','sample.md',original);
  knowledge.create('default',{name:'Sample',type:'source',attachmentIds:[file.id]});
  await files.tick();assert.equal(files.require('default',file.id).status,'ready');
  let evidence=files.evidence('default',file.id);
  assert.equal(evidence.originalHash,sha(original));assert.equal(evidence.admittedHash,sha(original));
  assert.equal(evidence.rawExtraction.text,original.toString());assert.equal(evidence.originalData,undefined);
  files.retry('default',file.id);await files.tick();assert.equal(files.evidence('default',file.id).originalHash,evidence.originalHash);
  const backups=new VaultBackups(store),archive=await backups.export('default'),restored=await backups.import(archive.bytes,'Evidence restored');
  const restoredFile=store.get('SELECT id FROM source_files WHERE vault_id=?',restored.id);
  assert.equal(files.evidence(restored.id,restoredFile.id).originalHash,sha(original));
  assert.deepEqual(Buffer.from(files.exportEvidence(restored.id,restoredFile.id).originalData,'base64'),original);
  assert.throws(()=>files.restoreEvidence(restored.id,restoredFile.id,{...evidence,originalData:Buffer.from('tampered').toString('base64')}),/checksum/);
  const evidencePath=path.join(files.root,restored.id,'source-evidence',restoredFile.id);
  files.removeAssets(restored.id,restoredFile.id);assert.equal(existsSync(evidencePath),false);
 }finally{files.close();env.db.close();rmSync(env.dir,{recursive:true,force:true});}
});
test('native extraction precedes flattening and cached retries retain original evidence', {skip:process.platform!=='darwin'},async()=>{
 const env=setup();const {files,knowledge}=env;
 try {
  const original=Buffer.from('%PDF-1.4\n/ObjStm\n%%EOF'),safe=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
  const file=await files.admit('default','native.pdf',original,undefined,()=>{});
  knowledge.create('default',{name:'Native sample',type:'source',attachmentIds:[file.id]});
  let calls=0;
  files.pdf=async filename=>{calls++;assert.deepEqual(readFileSync(filename),original);return {text:'1. Introduction\nDante as well. Regan Arts. p. 109).',pages:1,ocrPages:0,pageStartLines:[1],structuralNodes:[{text:'1. Introduction',startLine:1,level:1}],pageEvidence:[{page:1,method:'native',text:'Dante as well.'}]};};
  files.flattenPDF=async bytes=>{assert.equal(calls,1);assert.deepEqual(bytes,original);return safe;};
  await files.tick();assert.equal(files.require('default',file.id).status,'ready',files.require('default',file.id).error);
  assert.deepEqual(readFileSync(files.filename('default',file.id)),safe);
  assert.equal(files.evidence('default',file.id).originalHash,sha(original));
  assert.equal(files.evidence('default',file.id).admittedHash,sha(safe));
  files.retry('default',file.id);await files.tick();assert.equal(calls,1);assert.equal(files.require('default',file.id).ocr_pages,0);
 }finally{files.close();env.db.close();rmSync(env.dir,{recursive:true,force:true});}
});
test('legacy flattened imports do not mislabel sanitized bytes as original evidence',async()=>{
 const env=setup();const {files,knowledge}=env;
 try {
  const safe=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
  const file=files.add('default','legacy.pdf',safe,undefined,undefined,true);
  knowledge.create('default',{name:'Legacy',type:'source',attachmentIds:[file.id]});
  files.pdf=async()=>({text:'Legacy OCR',pages:1,ocrPages:1,pageStartLines:[1]});
  await files.tick();const evidence=files.evidence('default',file.id);
  assert.equal(evidence.originalAvailable,false);assert.equal(evidence.originalHash,undefined);
  assert.equal(files.exportEvidence('default',file.id).originalData,undefined);
  assert.equal(evidence.admittedHash,sha(safe));assert.match(evidence.findings[0],/Re-upload/);
 }finally{files.close();env.db.close();rmSync(env.dir,{recursive:true,force:true});}
});
