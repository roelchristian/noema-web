import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/http.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';

test('bibliography HTTP guards disclosure, scopes writes and logs metadata requests in existing activity',async t=>{
 const db=openDatabase(':memory:'),store=new Store(db),nativeFetch=globalThis.fetch;let metadataCalls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(String(url),'https://api.crossref.org/works/10.5555%2Fsynthetic');metadataCalls++;assert.equal(options.redirect,'error');
  return Response.json({message:{DOI:'10.5555/synthetic',title:['Verified synthetic title'],publisher:'Synthetic Press'}});
 });
 const ai=new Intelligence({read:()=>null,write(){},remove(){}},async()=>{throw new Error('AI forbidden in fixture');});
 const server=createApp(store,'/tmp/noema-no-static-fixture',ai);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 const base=`http://127.0.0.1:${server.address().port}/api/`;
 const request=(path,body,headers={})=>nativeFetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-noema-request':'1','x-vault-id':'default',...headers},body:JSON.stringify(body)});
 const raw='@article{HTTP,title={Authored synthetic title},doi={10.5555/synthetic}}';
 assert.equal((await request('bibliography/import',{raw,decisions:[{index:0,action:'create'}]},{'x-noema-request':''})).status,403);
 const imported=await request('bibliography/import',{raw,decisions:[{index:0,action:'create'}]});assert.equal(imported.status,200);const id=(await imported.json()).sourceIds[0];
 assert.equal((await request(`bibliography/${id}/verify`,{})).status,400);assert.equal(metadataCalls,0);
 const verified=await request(`bibliography/${id}/verify`,{consent:true});assert.equal(verified.status,200);const proposal=await verified.json();assert.equal(metadataCalls,1);
 const activity=store.get("SELECT action,status,object_id,prompt_bytes FROM ai_activity WHERE action='bibliographic_lookup'");assert.deepEqual({...activity},{action:'bibliographic_lookup',status:'completed',object_id:id,prompt_bytes:null});
 const accepted=await request(`bibliography/${id}/accept-verification`,{...proposal,fields:{publisher:proposal.fields.publisher}});assert.equal(accepted.status,200);assert.equal((await accepted.json()).fields.title,'Authored synthetic title');
 const scopedRaw='@book{IgnoredImportKey,title={Scoped proposed title},year={2026}}';
 const scopedPreviewResponse=await request(`bibliography/${id}/import-preview`,{raw:scopedRaw});assert.equal(scopedPreviewResponse.status,200);const scopedPreview=await scopedPreviewResponse.json();
 assert.equal((await request(`bibliography/${id}/import`,{raw:scopedRaw,...scopedPreview})).status,400);
 const scopedAccepted=await request(`bibliography/${id}/import`,{raw:scopedRaw,...scopedPreview,fields:{title:'current'}});assert.equal(scopedAccepted.status,200);assert.equal((await scopedAccepted.json()).citationKey,'HTTP');
 assert.equal((await request(`bibliography/${id}/import`,{raw:scopedRaw,...scopedPreview,fields:{title:'incoming'}})).status,409);
 const scopedExport=await nativeFetch(base+`bibliography/${id}/export`,{headers:{'x-vault-id':'default'}});assert.equal(scopedExport.status,200);assert.equal(JSON.parse((await scopedExport.json()).sidecar).records[0].sourceId,id);
 assert.equal((await request(`bibliography/${id}/import-preview`,{raw:scopedRaw},{'x-vault-id':'missing'})).status,404);
 assert.equal((await request('bibliography/preview',{raw},{origin:'https://cross-origin.invalid'})).status,403);
 assert.equal((await request(`entities/${id}/scholarly`,{confirmRemote:true},{'x-noema-request':''})).status,403);
 assert.equal((await request(`entities/${id}/scholarly`,{confirmRemote:true})).status,409);
});
