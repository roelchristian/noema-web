import { defineConfig } from 'vite';
import path from 'node:path';
import {watchFile, unwatchFile} from 'node:fs';
import type {Socket} from 'node:net';
import {isLoopback, networkPeerAllowed, networkRequestError} from './src/server/network.js';
import {NetworkAccess, networkSettingsPath} from './src/server/network-settings.js';
const access=new NetworkAccess(networkSettingsPath(process.env.DB_PATH || path.resolve('data/noema.sqlite')));
const network=access.listener;
const apiHost=network.bindHost==='0.0.0.0'?'127.0.0.1':network.bindHost;
export default defineConfig({
  plugins:[{name:'noema-network-access',configureServer(server) {
    const sockets=new Set<Socket>(),pending=new Map<Socket,number>();
    server.httpServer?.on('connection',(socket:Socket)=>{
      if(!networkPeerAllowed(socket.remoteAddress||'',access.config(),socket.localAddress)){socket.destroy();return;}
      sockets.add(socket);socket.once('close',()=>{sockets.delete(socket);pending.delete(socket);});
    });
    const disconnect=()=>{
      if(access.enabled())return;
      for(const socket of sockets)if(!isLoopback(socket.remoteAddress||'')&&!pending.has(socket))socket.destroy();
    };
    watchFile(access.filename!,{interval:250,persistent:false},disconnect);
    server.httpServer?.once('close',()=>unwatchFile(access.filename!,disconnect));
    server.middlewares.use((req,res,next)=>{
      const socket=req.socket;
      pending.set(socket,(pending.get(socket)??0)+1);
      let finished=false;
      const finish=()=>{
        if(finished)return;finished=true;
        const count=(pending.get(socket)??1)-1;
        if(count>0)pending.set(socket,count);else pending.delete(socket);
        if(!count&&!access.enabled()&&!isLoopback(socket.remoteAddress||''))socket.end();
      };
      res.once('finish',finish);res.once('close',finish);
      const error=networkRequestError(req,access.config());
      if(!error)return next();
      res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
      res.end(error);
    });
  }}],
  build:{outDir:'dist/client',emptyOutDir:true},
  server:{host:network.bindHost,allowedHosts:network.allowedHosts,cors:false,proxy:{'/api':{target:`http://${apiHost}:${process.env.PORT||3000}`,changeOrigin:false}}},
});
