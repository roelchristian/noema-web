import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { Store } from './store.js';
import { createApp } from './http.js';
import {readNetworkConfig} from './network.js';
import {NetworkAccess, networkSettingsPath} from './network-settings.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
// Source and compiled entry points have the same two-level layout.
const projectRoot=path.basename(root)==='dist'?path.dirname(root):root;
const dbPath=process.env.DB_PATH || path.join(projectRoot,'data','noema.sqlite');
const access=new NetworkAccess(networkSettingsPath(dbPath));
const network=access.listener;
const db=openDatabase(dbPath),server=createApp(new Store(db),path.join(projectRoot,'dist','client'),undefined,readNetworkConfig(),access);
server.listen(Number(process.env.PORT || 3000),network.bindHost,()=>{
  const address=server.address();
  const port=typeof address==='object'&&address?address.port:3000;
  const localHost=network.bindHost==='0.0.0.0'||network.bindHost==='127.0.0.1'?'localhost':network.bindHost;
  console.log(`Noema is running at http://${localHost}:${port}\nSQLite: ${dbPath}`);
  if(access.enabled()) {
    for(const host of network.allowedHosts.filter(host=>!['localhost','127.0.0.1'].includes(host)))console.log(`LAN: http://${host}:${port}`);
    console.log('LAN mode is enabled. Devices on this network can access unlocked vaults.');
  }
});
let stopping=false;
function shutdown(){if(stopping)return;stopping=true;server.close(()=>{db.close();process.exitCode=0;});server.closeIdleConnections();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
