import { defineConfig } from 'vite';
export default defineConfig({
  build:{outDir:'dist/client',emptyOutDir:true},
  server:{host:'127.0.0.1',proxy:{'/api':{target:'http://127.0.0.1:3000',changeOrigin:false}}},
});
