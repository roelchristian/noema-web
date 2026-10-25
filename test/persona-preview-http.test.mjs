import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/http.ts';
import {Intelligence,intelligencePreferencesFor} from '../src/server/modules/intelligence.ts';
import {completedResponse} from './helpers/providers.ts';

test('preview HTTP endpoint uses explicit model snapshot, protects route, records provider usage and never writes pages/defaults',async t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'noema-preview-http-')),db=openDatabase(path.join(directory,'db.sqlite')),store=new Store(db),calls=[];
 const secrets={read:()=>({key:'sk-synthetic-preview-only',generation:'synthetic',expiresAt:'2099-01-01T00:00:00.000Z'}),write(){throw Error('Unexpected credential write');},remove(){throw Error('Unexpected credential removal');}};
 const ai=new Intelligence(secrets,async(_url,options)=>{calls.push(JSON.parse(options.body));return completedResponse('Synthetic provider preview.');},Date.now,intelligencePreferencesFor(store));
 const server=createApp(store,path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();rmSync(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,body={input:'A group has an identity.',personaId:'tutor',personaExpression:'immersive',modelSettings:{model:'gpt-6-luna',reasoningEffort:'none'}},headers={'Content-Type':'application/json','X-Noema-Request':'1'};
 const before=JSON.stringify(ai.selection()),pagesBefore=store.get('SELECT count(*) AS n FROM pages').n;
 const denied=await fetch(base+'/api/intelligence/persona-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(denied.status,403);assert.equal(calls.length,0);
 const invalid=await fetch(base+'/api/intelligence/persona-preview',{method:'POST',headers,body:JSON.stringify({...body,personaId:'custom'})});assert.equal(invalid.status,400);assert.equal(calls.length,0);
 const response=await fetch(base+'/api/intelligence/persona-preview',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200);const value=await response.json();assert.equal(value.text,'Synthetic provider preview.');assert.deepEqual(value.modelSettings,body.modelSettings);assert.deepEqual(value.persona,{id:'tutor',version:2,origin:'builtin',expression:'immersive'});
 assert.equal(calls.length,1);assert.equal(calls[0].model,'gpt-6-luna');assert.equal(calls[0].reasoning.effort,'none');assert.equal(calls[0].input,body.input);assert.match(calls[0].instructions,/AI PERSONA: The Tutor \(v2\)/);assert.match(calls[0].instructions,/immersive/i);assert.equal(JSON.stringify(ai.selection()),before);assert.equal(store.get('SELECT count(*) AS n FROM pages').n,pagesBefore);
 const activity=store.get("SELECT action,status,model,reasoning_effort,prompt_bytes FROM ai_activity WHERE action='persona_preview'");assert.equal(activity.status,'completed');assert.equal(activity.model,'gpt-6-luna');assert.ok(activity.prompt_bytes>0);
});
