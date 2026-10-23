import http from 'node:http';
import type {Socket} from 'node:net';
import {Store} from './store.js';
import {Intelligence,keychainFor,intelligencePreferencesFor} from './modules/intelligence.js';
import {readNetworkConfig,type NetworkConfig} from './network.js';
import {NetworkAccess} from './network-settings.js';
import {createRuntime} from './runtime.js';
import {createTransportHandler,trackConnections} from './transport.js';

export function createApp(store: Store, clientRoot: string, intelligence=new Intelligence(keychainFor(store),fetch,()=>Date.now(),intelligencePreferencesFor(store),undefined,undefined,keychainFor(store,'gemini')), network: NetworkConfig=readNetworkConfig(), access?: NetworkAccess) {
  const runtime=createRuntime(store,intelligence,network,access);
  const sockets=new Set<Socket>();
  const server=http.createServer(createTransportHandler(runtime,clientRoot,sockets));
  trackConnections(server,runtime.networkAccess,sockets);
  server.on('listening',()=>runtime.start());
  server.on('close',()=>runtime.close());
  return server;
}
