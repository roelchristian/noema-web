import {once} from 'node:events';
import path from 'node:path';
import {openDatabase} from '../../src/server/database.ts';
import {Store} from '../../src/server/store.ts';
import {createApp} from '../../src/server/http.ts';

/** Fresh real HTTP/database boundary; feature setup and request guards stay in each test. */
export async function httpFixture(t,{headers={}}={}) {
 const db=openDatabase(':memory:'),store=new Store(db);
 let server;
 // Register before app construction/listening, including fixture setup failures.
 t.after(async()=>{
  try {
   if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }finally{db.close();}
 });
 server=createApp(store,path.resolve('dist/client'));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port+'/api/';
 // No client/origin/vault credentials are supplied implicitly by the fixture.
 const request=(route,options={})=>fetch(base+route,{...options,headers:{...headers,...options.headers}});
 const json=(route,method='GET',body)=>request(route,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {store,request,json};
}
