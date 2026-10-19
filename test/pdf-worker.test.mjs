import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {preparePDFWorker} from '../src/server/modules/pdf-worker.ts';
test('sandbox worker moves only executable into disposable private launch directory',()=>{
 const original=realpathSync(process.execPath),input='/Users/example/private-source.pdf';
 const profile='(version 1)(deny file-read* (subpath "/Users"))(allow process-exec (literal '+JSON.stringify(original)+'))(allow file-read* (literal '+JSON.stringify(original)+') (literal '+JSON.stringify(input)+'))';
 const prepared=preparePDFWorker('/usr/bin/sandbox-exec',['-p',profile,original,input]);
 try {
  assert.notEqual(prepared.args[2],original);assert.equal(prepared.args[3],input);
  assert.equal(prepared.args[1].includes(JSON.stringify(original)),false);
  assert.equal(prepared.args[1].includes(JSON.stringify(input)),true);
  assert.match(prepared.args[1],/deny file-read/);
  assert.deepEqual(readFileSync(prepared.args[2]),readFileSync(original));
 }finally{prepared.dispose();}
 assert.equal(existsSync(prepared.args[2]),false);
});
