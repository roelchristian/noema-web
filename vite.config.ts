import { defineConfig } from 'vite';
import {networkRequestError, readNetworkConfig} from './src/server/network.js';
const network=readNetworkConfig();
const apiHost=network.bindHost==='0.0.0.0'?'127.0.0.1':network.bindHost;
export default defineConfig({
  plugins:[{name:'noema-network-access',configureServer(server) {
    server.middlewares.use((req,res,next)=>{
      const error=networkRequestError(req,network);
      if(!error)return next();
      res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
      res.end(error);
    });
  }}],
  build:{outDir:'dist/client',emptyOutDir:true},
  server:{host:network.bindHost,allowedHosts:network.allowedHosts,cors:false,proxy:{'/api':{target:`http://${apiHost}:${process.env.PORT||3000}`,changeOrigin:false}}},
});
