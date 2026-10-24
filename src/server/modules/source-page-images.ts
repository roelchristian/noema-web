import {preparePDFWorker} from './pdf-worker.js';
import {spawn,type ChildProcess} from 'node:child_process';
import {existsSync,statSync,mkdirSync,renameSync,rmSync,realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {SourceFiles} from './source-files.js';
import {HttpError} from '../validation.js';

/** Only render admitted viewing assets. Original quarantine bytes never enter this endpoint. */
export class SourcePageImages {
 private compiler?:Promise<string>;private children=new Set<ChildProcess>();private closed=false;
 private pending=new Map<string,Promise<Buffer>>();private cache=new Map<string,Buffer>();
 constructor(private files:SourceFiles){}
 async get(vault:string,id:string,page:number){
  const file=this.files.require(vault,id);
  if(file.admitted!==1||file.status!=='ready'||file.format!=='pdf')throw new HttpError(409,'Page images are available for processed PDFs only.');
  if(!Number.isSafeInteger(page)||page<1||page>(file.pages??0))throw new HttpError(400,'Choose a valid source page.');
  if(process.platform!=='darwin')throw new HttpError(501,'PDF page images currently require macOS.');
  if(this.closed)throw new HttpError(503,'Page rendering is shutting down.');
  const filename=this.files.filename(vault,id),stat=statSync(filename),key=`${filename}:${stat.mtimeMs}:${stat.size}:${page}`;
  const cached=this.cache.get(key);if(cached)return cached;
  const pending=this.pending.get(key);if(pending)return pending;
  if(this.pending.size>=2)throw new HttpError(429,'Page rendering is busy. Try again shortly.');
  const work=(async()=>{
   const executable=await (this.compiler??=this.compile().catch(error=>{this.compiler=undefined;throw error;}));
   const profile='(version 1)(allow default)(deny network*)(deny file-write*)(deny process-fork)(deny process-exec)(allow process-exec (literal '+JSON.stringify(realpathSync(executable))+'))(deny file-read* (subpath "/Users"))(allow file-read* (literal '+JSON.stringify(realpathSync(filename))+') (literal '+JSON.stringify(realpathSync(executable))+'))';
   const bytes=await this.command('/usr/bin/sandbox-exec',['-p',profile,executable,filename,String(page)],30000);
   if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new HttpError(502,'The page renderer returned an invalid image.');
   // Bounded in-memory previews disappear on restart and do not alter vault assets.
   while([...this.cache.values()].reduce((size,value)=>size+value.length,0)+bytes.length>24*1024*1024&&this.cache.size)this.cache.delete(this.cache.keys().next().value!);
   this.cache.set(key,bytes);return bytes;
  })();
  this.pending.set(key,work);try{return await work;}finally{this.pending.delete(key);}
 }
 /** Admitted PDFKit line geometry uses the same page asset as the rendered image.
  * Raster-only and rotated pages return no native alignment proof. */
 async layout(vault:string,id:string,page:number):Promise<{text:string;bounds:number[]}[]>{
  await this.get(vault,id,page);
  const executable=await this.compiler!,filename=this.files.filename(vault,id);
  const profile='(version 1)(allow default)(deny network*)(deny file-write*)(deny process-fork)(deny process-exec)(allow process-exec (literal '+JSON.stringify(realpathSync(executable))+'))(deny file-read* (subpath "/Users"))(allow file-read* (literal '+JSON.stringify(realpathSync(filename))+') (literal '+JSON.stringify(realpathSync(executable))+'))';
  const bytes=await this.command('/usr/bin/sandbox-exec',['-p',profile,executable,filename,String(page),'--layout'],30000);
  if(bytes.length>2*1024*1024)throw new HttpError(502,'Native layout exceeds the evidence budget.');
  const value:unknown=JSON.parse(bytes.toString('utf8'));
  if(!Array.isArray(value)||value.length>2000||value.some(line=>!line||typeof line.text!=='string'||line.text.length>4000||!Array.isArray(line.bounds)||line.bounds.length!==4||line.bounds.some((n:unknown)=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)||line.bounds[2]<=0||line.bounds[3]<=0||line.bounds[0]+line.bounds[2]>1.000001||line.bounds[1]+line.bounds[3]>1.000001))throw new HttpError(502,'Native layout evidence is malformed.');
  return value;
 }
 private async compile(){
  mkdirSync(this.files.root,{recursive:true});
  const script=fileURLToPath(new URL('../../../scripts/render-source-page.swift',import.meta.url)),executable=path.join(this.files.root,'source-page-renderer');
  if(!existsSync(executable)||statSync(script).mtimeMs>statSync(executable).mtimeMs){
   const temporary=executable+'-'+randomUUID();
   try{await this.command('/usr/bin/swiftc',[script,'-module-cache-path',path.join(tmpdir(),'noema-swift-module-cache'),'-o',temporary],120000);renameSync(temporary,executable);}finally{rmSync(temporary,{force:true});}
  }
  return executable;
 }
 private command(program:string,args:string[],timeout:number):Promise<Buffer>{
  if(this.closed)return Promise.reject(new HttpError(503,'Page rendering is shutting down.'));
  const prepared=preparePDFWorker(program,args);
  return new Promise<Buffer>((resolve,reject)=>{
   const child=spawn(program,prepared.args,{stdio:['ignore','pipe','pipe']});this.children.add(child);
   const chunks:Buffer[]=[];let size=0;const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
   child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>12*1024*1024)child.kill('SIGKILL');else chunks.push(chunk);});
   child.stderr.resume();
   child.on('error',()=>{clearTimeout(timer);this.children.delete(child);reject(new HttpError(503,'Local page rendering could not start.'));});
   child.on('close',code=>{clearTimeout(timer);this.children.delete(child);if(code===0)resolve(Buffer.concat(chunks));else reject(new HttpError(502,'Local page rendering failed or timed out.'));});
  }).finally(()=>prepared.dispose());
 }
 close(){this.closed=true;this.cache.clear();for(const child of this.children)child.kill('SIGKILL');}
}
