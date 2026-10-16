import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(tmpdir(),'noema-test-'));
const dbPath = path.join(dir,'test.sqlite');
let child;
async function start() {
 child = spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DB_PATH:dbPath},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',d=>stderr+=d);
 return await new Promise((resolve,reject)=>{
  child.stdout.on('data',d=>{const match=d.toString().match(/http:\/\/localhost:(\d+)/);if(match)resolve('http://127.0.0.1:'+match[1]);});
  child.on('exit',code=>reject(new Error('Server exited '+code+': '+stderr)));child.on('error',reject);
 });
}
async function stop(){const exited=once(child,'exit');child.kill();await exited;}
await test('SQLite API: pages, references, relationships, validation, and restart persistence',async()=>{
 try {
 let base=await start();
 async function request(route,method='GET',body,status=200,headers={}){
  const res=await fetch(base+'/api/'+route,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
  const result=await res.json();assert.equal(res.status,status,JSON.stringify(result));return result;
 }
 const people=await request('entities');assert.ok(people.some(e=>e.id==='ursula'));
 const page=await request('pages','POST',{title:'Test note'},201);
 const person=await request('entities','POST',{name:'Test Person',type:'person'},201);
 const sibling=await request('entities','POST',{name:'Sibling Person',type:'person'},201);
 const work=await request('entities','POST',{name:'Test Book',type:'creativework'},201);
 let book=await request('entities/'+work.id+'/properties','POST',{name:'type',value:'Book'},201);
 book=await request('entities/'+work.id+'/properties','POST',{name:'author',target_id:person.id},201);
 assert.equal(book.properties.find(p=>p.name==='author').target_id,person.id);
 const related=await request('entities/'+person.id+'/relationships','POST',{label:'sibling',target_id:sibling.id},201);
 const relation=related.relationships[0];assert.equal(relation.label,'sibling');
 const incoming=await request('entities/'+sibling.id);assert.equal(incoming.relationships[0].source_id,person.id);
 const author=await request('entities/'+person.id);assert.equal(author.incomingProperties[0].entity_id,work.id);
 const textProperty=book.properties.find(p=>p.name==='type');
 const edited=await request('entities/'+work.id+'/properties/'+textProperty.id,'PUT',{name:'format',value:'Novel'});
 assert.equal(edited.properties.find(p=>p.id===textProperty.id).value,'Novel');
 const editedRelation=await request('entities/'+person.id+'/relationships/'+relation.id,'PUT',{label:'sibling of',target_id:sibling.id});
 assert.equal(editedRelation.relationships[0].label,'sibling of');
 await request('entities/'+sibling.id+'/properties/'+textProperty.id,'PUT',{name:'format',value:'Wrong owner'},404);
 const blocks=[{id:'test',type:'paragraph',checked:false,content:[{text:'Reading '},{entityId:work.id}]}];
 await request('pages/'+page.id,'PUT',{title:'Saved note',blocks});
 await request('entities/'+person.id,'PUT',{name:'Renamed Person',type:'person',description:'Edited'});
 await request('pages/'+page.id,'PUT',{title:'Broken',blocks:[{id:'x',type:'paragraph',content:[{entityId:'missing'}]}]},400);
 await request('entities','POST',{name:'Bad',type:'invalid'},400);
 await request('entities/'+work.id+'/properties','POST',{name:'author',target_id:'missing'},400);
 await request('entities','POST',{name:'Cross origin',type:'person'},403,{Origin:'https://example.com'});
 const invalidJson=await fetch(base+'/api/pages',{method:'POST',body:'{'});assert.equal(invalidJson.status,400);
 await stop();base=await start();
 const saved=await request('pages/'+page.id);assert.equal(saved.title,'Saved note');assert.deepEqual(saved.blocks,blocks);
 assert.equal((await request('entities/'+person.id)).name,'Renamed Person');
 await request('entities/'+person.id+'/relationships/'+relation.id,'DELETE');assert.equal((await request('entities/'+sibling.id)).relationships.length,0);
 const property=book.properties.find(p=>p.name==='author');await request('entities/'+work.id+'/properties/'+property.id,'DELETE');
 assert.equal((await request('entities/'+person.id)).incomingProperties.length,0);
 await request('pages/'+page.id,'DELETE');await request('pages/'+page.id,'GET',undefined,404);
 const asset=await fetch(base+'/');assert.equal(asset.status,200);assert.match(await asset.text(),/noema/);
 } finally {if(child&&child.exitCode===null)await stop();await rm(dir,{recursive:true,force:true});}
});
