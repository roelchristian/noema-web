// Synthetic local HTTP workload. Does not call document or model providers.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/http.ts';
const db=openDatabase(':memory:'),store=new Store(db),ids=Array.from({length:50},(_,i)=>'synthetic-bulk-'+i);
for(const id of ids)store.run("INSERT INTO pages(id,title,blocks,updated_at,vault_id) VALUES (?,?,?,'2026-10-27','default')",id,id,'[]');
const server=createApp(store,'/tmp/noema-no-client');server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port,headers={'X-Noema-Request':'1','X-Vault-Id':'default','Content-Type':'application/json'};
async function command(route,body){const response=await fetch(base+'/api/organization/'+route,{method:'PUT',headers,body:JSON.stringify(body)}),text=await response.text();assert.equal(response.status,200,text);return {bytes:Buffer.byteLength(text),data:JSON.parse(text)};}
try {
 let start=performance.now(),beforeBytes=0;for(const id of ids){const result=await command('favourites',{kind:'page',item_id:id,favourite:true});beforeBytes+=result.bytes;}
 const beforeMs=performance.now()-start;
 await command('bulk',{operation:'favourites',kind:'page',item_ids:ids,favourite:false});
 start=performance.now();const after=await command('bulk',{operation:'favourites',kind:'page',item_ids:ids,favourite:true}),afterMs=performance.now()-start;
 assert.equal(after.data.favourites.filter(row=>ids.includes(row.item_id)).length,50);
 console.log(JSON.stringify({kind:'synthetic real local HTTP fifty-page favourite update',runtime:process.version,before:{requests:50,responseBytes:beforeBytes,elapsedMs:beforeMs},after:{requests:1,responseBytes:after.bytes,elapsedMs:afterMs},limits:'Cloud loopback HTTP only; does not measure representative device rendering or network performance.'},null,2));
} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
