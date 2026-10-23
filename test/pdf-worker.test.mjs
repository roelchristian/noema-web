import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,realpathSync,mkdtempSync,writeFileSync,symlinkSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {preparePDFWorker} from '../src/server/modules/pdf-worker.ts';
test('sandbox worker moves only executable into disposable private launch directory',t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'noema-pdf-worker-fixture-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const executable=path.join(directory,'parser'),link=path.join(directory,'parser-link');
 // Copy/profile behavior does not require copying or executing the Node binary.
 const bytes=Buffer.from('#!/bin/sh\nexit 0\n');
 writeFileSync(executable,bytes,{mode:0o700});
 let linkedExecutable=link;
 // Windows directory junctions exercise realpath without privileged file symlinks.
 if(process.platform==='win32'){symlinkSync(directory,link,'junction');linkedExecutable=path.join(link,'parser');}
 else symlinkSync(executable,link);
 const original=realpathSync(executable),input='/Users/example/private-source.pdf';
 for(const candidate of [executable,linkedExecutable]){
  const profile='(version 1)(deny file-read* (subpath "/Users"))(allow process-exec (literal '+JSON.stringify(original)+'))(allow file-read* (literal '+JSON.stringify(original)+') (literal '+JSON.stringify(input)+'))';
  const prepared=preparePDFWorker('/usr/bin/sandbox-exec',['-p',profile,candidate,input]);
  try {
   assert.notEqual(prepared.args[2],original);assert.equal(prepared.args[3],input);
   assert.equal(prepared.args[1].includes(JSON.stringify(original)),false);
   assert.equal(prepared.args[1].includes(JSON.stringify(input)),true);
   assert.equal(prepared.args[1].includes(JSON.stringify(prepared.args[2])),true);
   assert.match(prepared.args[1],/deny file-read/);
   assert.deepEqual(readFileSync(prepared.args[2]),bytes);
   assert.equal(statSync(prepared.args[2]).mode&0o777,statSync(executable).mode&0o777);
  }finally{prepared.dispose();}
  assert.equal(existsSync(prepared.args[2]),false);
  assert.deepEqual(readFileSync(executable),bytes,'original executable survives disposal');
 }
});
