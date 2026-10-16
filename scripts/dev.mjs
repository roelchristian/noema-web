import { spawn } from 'node:child_process';
import path from 'node:path';
const bin=name=>path.resolve('node_modules/.bin',name);
const children=[spawn(bin('tsx'),['watch','src/server/index.ts'],{stdio:'inherit'}),spawn(bin('vite'),[],{stdio:'inherit'})];
let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');}
for(const child of children){child.on('error',error=>{console.error(error);process.exitCode=1;stop();});child.on('exit',code=>{if(!stopping){process.exitCode=code || 0;stop();}});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
