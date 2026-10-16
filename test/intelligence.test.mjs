import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Intelligence } from '../src/server/modules/intelligence.ts';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { createApp } from '../src/server/http.ts';
const key='sk-test-secret-never-return-this-value';
class Secrets {
  value=null;
  read(){return this.value;}
  write(value){this.value=structuredClone(value);}
  remove(){this.value=null;}
}
const completed=text=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]});
const rejected=(work,status)=>assert.rejects(work,error=>error.status===status);
test('credentials: write-only status, expiry, replacement, removal, persistence and bounds',async()=>{
  const secrets=new Secrets();let time=Date.now(),calls=0;
  let ai=new Intelligence(secrets,async()=>{calls++;return completed('OK');},()=>time);
  assert.deepEqual(ai.status(),{configured:false,expiresAt:null,model:'gpt-5-mini'});
  for(const days of [0,366,1.5,'30',null])assert.throws(()=>ai.save({apiKey:key,days}),e=>e.status===400);
  assert.throws(()=>ai.save({apiKey:'bad'}),e=>e.status===400);
  const status=ai.save({apiKey:key});assert.equal(status.expiresAt,new Date(time+30*86400000).toISOString());
  assert.ok(!JSON.stringify(status).includes(key));
  ai=new Intelligence(secrets,async()=>{calls++;return completed('OK');},()=>time);
  assert.equal(ai.status().configured,true);
  time+=30*86400000;assert.equal(ai.status().configured,false);assert.equal(secrets.value,null);
  await rejected(()=>ai.generate('page'),409);assert.equal(calls,0);
  ai.save({apiKey:key,days:1});ai.remove();assert.equal(secrets.value,null);
});
test('provider calls restrict destination, credentials, storage, output, errors, and request rate',async()=>{
  const secrets=new Secrets();let request;
  const ai=new Intelligence(secrets,async(url,options)=>{request={url,...options};return completed('Summary '+key);});
  ai.save({apiKey:key});assert.equal(await ai.generate('Only this page'),'Summary [redacted]');
  assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(request.redirect,'error');
  assert.equal(request.headers.Authorization,'Bearer '+key);
  const body=JSON.parse(request.body);assert.equal(body.store,false);assert.equal(body.input,'Only this page');assert.equal(body.tools,undefined);assert.ok(!request.body.includes(key));
  for(let i=0;i<4;i++)await ai.generate('',true);
  await rejected(()=>ai.generate('blocked'),429);
  const bad=new Intelligence(secrets,async()=>new Response(key,{status:401}));
  await assert.rejects(()=>bad.generate('page'),error=>error.status===502&&!error.message.includes(key));
  const broken=new Intelligence(secrets,async()=>{throw new Error(key);});
  await assert.rejects(()=>broken.generate('page'),error=>!error.message.includes(key));
  const huge=new Intelligence(secrets,async()=>completed('a'.repeat(140000)));
  await rejected(()=>huge.generate('page'),502);
});
test('in-flight requests reject concurrent use and discard results after key removal',async()=>{
  const secrets=new Secrets();let finish;
  const ai=new Intelligence(secrets,()=>new Promise(resolve=>{finish=resolve;}));
  ai.save({apiKey:key});const pending=ai.generate('page');
  await rejected(()=>ai.generate('second'),429);
  ai.remove();finish(completed('private summary'));await rejected(()=>pending,409);
});
test('AI HTTP routes enforce CSRF, vault scope, revisions, lock state and private responses',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-ai-')),db=openDatabase(path.join(dir,'test.sqlite'));
  const secrets=new Secrets();let providerCalls=0,lastInput='',finish;
  const ai=new Intelligence(secrets,async(url,options)=>{providerCalls++;lastInput=JSON.parse(options.body).input;if(finish===true)return new Promise(resolve=>{finish=resolve;});return completed('A safe summary');});
  const server=createApp(new Store(db),path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  async function call(route,method='GET',body,expected=200,headers={}) {
    const response=await fetch(base+'/api/'+route,{method,headers:{'X-Noema-Request':'1','Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));assert.ok(!JSON.stringify(value).includes(key));assert.equal(response.headers.get('cache-control'),'no-store');return value;
  }
  try {
    await call('intelligence','GET',undefined,403,{'X-Noema-Request':''});
    await call('intelligence','PUT',{apiKey:key},403,{Origin:'https://evil.example'});
    await call('intelligence','PUT',{apiKey:key},403,{'Content-Type':'text/plain'});
    const hostStatus=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/intelligence',{headers:{Host:'evil.example','X-Noema-Request':'1'}},response=>{response.resume();resolve(response.statusCode);});req.on('error',reject);});
    assert.equal(hostStatus,403);
    await call('intelligence','PUT',{apiKey:key});await call('intelligence/validate','POST',{});
    assert.equal(lastInput,'Connection test.');
    const page=await call('pages','POST',{title:'My page'},201);
    const saved=await call('pages/'+page.id,'PUT',{...page,blocks:[{id:'a',type:'paragraph',content:[{text:'My private page text'}]}]});
    await call('pages/'+page.id+'/summary','POST',{},409);
    await call('pages/'+page.id+'/summary','POST',{revision:saved.revision},403,{'X-Noema-Request':''});
    const vault=await call('vaults','POST',{name:'Other'},201);
    await call('pages/'+page.id+'/summary','POST',{revision:saved.revision},404,{'X-Vault-Id':vault.id});
    const result=await call('pages/'+page.id+'/summary','POST',{revision:saved.revision});assert.equal(result.summary,'A safe summary');assert.equal(lastInput,'My page\nMy private page text\n');
    assert.equal(providerCalls,2);
    finish=true;
    const pending=call('pages/'+page.id+'/summary','POST',{revision:saved.revision},423);
    while(typeof finish!=='function')await new Promise(resolve=>setTimeout(resolve,5));
    await call('vaults/default/lock','POST',{passphrase:'test-lock'});finish(completed('do not disclose'));await pending;
    await call('pages/'+page.id+'/summary','POST',{revision:saved.revision},423);
    await call('intelligence','DELETE');assert.equal(secrets.value,null);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM metadata').all()).includes(key));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Keychain adapter keeps credentials off argv and rejects storage failures',async t=>{
  if(process.platform!=='darwin')return t.skip('macOS adapter');
  const {MacKeychain}=await import('../src/server/modules/intelligence.ts');
  let stored=null;const invocations=[];
  const execute=(file,args,options)=>{
    invocations.push({file,args});
    if(args[0]==='-i') {stored=options.input.trim().split(' ').at(-1);return {status:0,stdout:'',stderr:''};}
    if(args[0]==='find-generic-password')return {status:stored?0:44,stdout:stored||'',stderr:''};
    stored=null;return {status:0,stdout:'',stderr:''};
  };
  const account='00000000-0000-0000-0000-000000000000';
  const secrets=new MacKeychain(account,execute),ai=new Intelligence(secrets);
  const status=ai.save({apiKey:key});assert.equal(status.configured,true);
  assert.ok(!JSON.stringify(invocations).includes(key));assert.ok(!JSON.stringify(invocations).includes(Buffer.from(JSON.stringify(secrets.read())).toString('base64')));
  ai.remove();assert.equal(stored,null);
  const denied=new MacKeychain(account,()=>({status:36,stdout:key,stderr:key}));
  assert.throws(()=>denied.read(),error=>error.status===503&&!error.message.includes(key));
});
