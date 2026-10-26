import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {captureDocumentProviderRejection} from '../src/server/modules/document-provider-diagnostics.ts';

test('explicit private one-shot provider debug retains error details and redacts credentials',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'noema-provider-debug-test-')),configPath=path.join(directory,'capture.json');
 const config=expiresAt=>writeFileSync(configPath,JSON.stringify({directory,expiresAt}),{mode:0o600});
 const secret='private-secret-never-logged',url='https://example.com/v1/interactions?key='+secret;
 const input={status:400,phase:'generation',url,headers:{'x-goog-api-key':secret},body:{error:{code:'invalid_request',message:`Unsupported schema response_format.schema: ${secret}; https://example.com/files/private-handle`}}};
 try{
  assert.equal(captureDocumentProviderRejection(input,configPath),undefined);
  config('invalid date');assert.equal(captureDocumentProviderRejection(input,configPath),undefined);
  config(new Date(Date.now()-1000).toISOString());assert.equal(captureDocumentProviderRejection(input,configPath),undefined);
  config(new Date(Date.now()+600000).toISOString());
  const filename=captureDocumentProviderRejection(input,configPath);assert.ok(filename);assert.equal(existsSync(configPath),false);
  assert.equal(statSync(filename).mode&0o077,0);
  const text=readFileSync(filename,'utf8'),captured=JSON.parse(text);
  assert.equal(text.includes(secret),false);assert.equal(text.includes('private-handle'),false);assert.equal(text.includes('https:'),false);
  assert.equal(captured.httpStatus,400);assert.equal(captured.phase,'generation');
  assert.match(captured.response.error.message,/Unsupported schema response_format\.schema/);
  assert.equal(captured.response.error.code,'invalid_request');
  assert.deepEqual(Object.keys(captured).sort(),['capturedAt','httpStatus','phase','response']);
  assert.equal(captureDocumentProviderRejection(input,configPath),undefined);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
