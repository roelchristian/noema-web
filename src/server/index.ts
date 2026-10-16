import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { Store } from './store.js';
import { createApp } from './http.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
// Source and compiled entry points have the same two-level layout.
const projectRoot=path.basename(root)==='dist'?path.dirname(root):root;
const dbPath=process.env.DB_PATH || path.join(projectRoot,'data','noema.sqlite');
const db=openDatabase(dbPath),server=createApp(new Store(db),path.join(projectRoot,'dist','client'));
server.listen(Number(process.env.PORT || 3000),'127.0.0.1',()=>{
  const address=server.address();
  console.log(`Noema is running at http://localhost:${typeof address==='object'&&address?address.port:3000}\nSQLite: ${dbPath}`);
});
let stopping=false;
function shutdown(){if(stopping)return;stopping=true;server.close(()=>{db.close();process.exitCode=0;});server.closeIdleConnections();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
