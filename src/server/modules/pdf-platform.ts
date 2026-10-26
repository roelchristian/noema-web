import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {scanSourcePDF} from './source-import.js';
import {HttpError} from '../validation.js';
const maxBytes=50*1024*1024;
/** PDF libraries supply parsing and page operations, never admission policy.
 * Rejected originals are reconstructed only inside a network-isolated sandbox. */
export class PdfPlatform {
 private sandbox?:boolean;
 capabilities(){return {pageCount:true,split:true,render:true,nativeText:true,passiveReconstruction:this.sandboxAvailable(),extractor:'pdfjs-dist/6.4.299'};}
 private sandboxAvailable(){
  if(this.sandbox!==undefined)return this.sandbox;
  if(process.platform!=='linux')return this.sandbox=false;
  const result=spawnSync('/usr/bin/bwrap',['--ro-bind','/','/','--unshare-net','--die-with-parent','--','/bin/true'],{stdio:'ignore',timeout:3000});
  return this.sandbox=result.status===0;
 }
 private worker(operation:string,bytes:Uint8Array,extra:Record<string,unknown>={},signal?:AbortSignal):Promise<any>{
  if(bytes.length>maxBytes)return Promise.reject(new HttpError(413,'PDF exceeds the application byte limit.'));
  if(operation==='sanitize'&&!this.sandboxAvailable())return Promise.reject(new HttpError(503,'This PDF requires passive reconstruction, but the isolated portable PDF sandbox is unavailable.'));
  if(signal?.aborted)return Promise.reject(new HttpError(409,'PDF processing was stopped.'));
  // tsx development runs the parent from src; the isolated worker still runs
  // compiled JavaScript with Node, just as it does in production.
  const script=fileURLToPath(new URL(import.meta.url.endsWith('.ts')?'../../../dist/server/modules/pdf-platform-worker.js':'./pdf-platform-worker.js',import.meta.url));
  if(!existsSync(script))return Promise.reject(new HttpError(503,'Build the portable PDF worker before using PDF operations.'));
  const workerArgs=['--max-old-space-size=384',script];
  // Sanitization cannot access vaults, credentials, the network or writable host paths.
  const root=path.resolve(path.dirname(script),'../../..');
  const sandboxArgs=['--die-with-parent','--unshare-all','--new-session','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--dir',root,'--ro-bind',path.join(root,'dist'),path.join(root,'dist'),'--ro-bind',path.join(root,'node_modules'),path.join(root,'node_modules'),'--proc','/proc','--dev','/dev','--tmpfs','/tmp','--',process.execPath,...workerArgs];
  return new Promise((resolve,reject)=>{
   const child=spawn(operation==='sanitize'?'/usr/bin/bwrap':process.execPath,operation==='sanitize'?sandboxArgs:workerArgs,{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
   let size=0,settled=false;const chunks:Buffer[]=[];const fail=(message:string)=>{if(!settled){settled=true;reject(new HttpError(502,message));}};
   const timer=setTimeout(()=>{child.kill('SIGKILL');fail('Portable PDF processing timed out.');},operation==='sanitize'?10*60*1000:60000);
   const abort=()=>{child.kill('SIGKILL');fail('PDF processing was stopped.');};signal?.addEventListener('abort',abort,{once:true});
   child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBytes*1.4){child.kill('SIGKILL');fail('Portable PDF output exceeds the size limit.');}else chunks.push(chunk);});
   child.stderr.resume();child.on('error',()=>fail('The portable PDF worker could not start.'));
   child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(settled)return;if(code!==0){fail('Portable PDF parsing or rendering failed.');return;}try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));settled=true;resolve(result);}catch{fail('The portable PDF worker returned invalid output.');}});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({operation,bytes:Buffer.from(bytes).toString('base64'),...extra}));
  });
 }
 async count(bytes:Uint8Array,signal?:AbortSignal):Promise<number>{const result=await this.worker('count',bytes,{},signal);if(!Number.isSafeInteger(result.pages)||result.pages<1||result.pages>10000)throw new HttpError(413,'PDF physical page count exceeds the application limit.');return result.pages;}
 async split(bytes:Uint8Array,physicalPages:number[],signal?:AbortSignal):Promise<{bytes:Buffer;pageMap:number[]}>{const result=await this.worker('split',bytes,{pages:physicalPages},signal);const output=Buffer.from(result.bytes,'base64');scanSourcePDF(output);return {bytes:output,pageMap:physicalPages.slice()};}
 async inspectText(bytes:Uint8Array,page:number,signal?:AbortSignal):Promise<string>{const result=await this.worker('text',bytes,{page},signal);if(typeof result.text!=='string'||result.text.length>2_000_000)throw new HttpError(502,'Native PDF text exceeds the evidence budget.');return result.text;}
 /** Optional bounded hints; callers must label these provisional PDF metadata. */
 async inspectContext(bytes:Uint8Array,signal?:AbortSignal):Promise<{title?:string;language?:string;sections:{page:number;title:string}[]}>{
  const result=await this.worker('context',bytes,{},signal);
  if(!result||typeof result!=='object'||!Array.isArray(result.sections)||result.sections.length>256||result.sections.some((section:{page:unknown;title:unknown})=>!Number.isSafeInteger(section.page)||Number(section.page)<1||typeof section.title!=='string'||section.title.length>300)||result.title!==undefined&&(typeof result.title!=='string'||result.title.length>1000)||result.language!==undefined&&(typeof result.language!=='string'||result.language.length>100))throw new HttpError(502,'Portable PDF context inspection returned invalid hints.');
  return result;
 }
 /** Native text is optional anomaly evidence, never independent geometry or OCR. */
 async inspectTexts(bytes:Uint8Array,pages:number[],signal?:AbortSignal):Promise<{page:number;text:string;extractor:'pdfjs-dist/6.4.299'}[]>{
  if(!Array.isArray(pages)||pages.length>32||new Set(pages).size!==pages.length||pages.some(page=>!Number.isSafeInteger(page)||page<1))throw new HttpError(400,'Inspect at most 32 distinct physical pages at a time.');
  if(!pages.length)return [];
  const result=await this.worker('texts',bytes,{pages},signal);
  if(!Array.isArray(result)||result.length!==pages.length||result.some((entry,index)=>entry?.page!==pages[index]||typeof entry.text!=='string'||entry.text.length>200000||entry.extractor!=='pdfjs-dist/6.4.299')||result.reduce((sum,entry)=>sum+entry.text.length,0)>1000000)throw new HttpError(502,'Portable native PDF text inspection exceeded the evidence budget.');
  return result;
 }
 async render(bytes:Uint8Array,page:number,signal?:AbortSignal):Promise<Buffer>{const result=await this.worker('render',bytes,{page},signal),output=Buffer.from(result.bytes,'base64');if(!output.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new HttpError(502,'The portable PDF renderer returned an invalid PNG.');return output;}
 async admit(bytes:Uint8Array,signal?:AbortSignal):Promise<{bytes:Buffer;pages:number;flattened:boolean;method:string}>{
  const original=Buffer.from(bytes);try{scanSourcePDF(original);}catch{const result=await this.worker('sanitize',bytes,{},signal);const output=Buffer.from(result.bytes,'base64');scanSourcePDF(output);return {bytes:output,pages:result.pages,flattened:true,method:'portable-raster-pdfjs-6.4.299'};}
  return {bytes:original,pages:await this.count(original,signal),flattened:false,method:'screened-original'};
 }
}
