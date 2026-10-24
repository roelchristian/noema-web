import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFileSync,mkdtempSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {tmpdir,release} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HttpError} from '../validation.js';
import {preparePDFWorker} from './pdf-worker.js';

export interface EvidenceOCRLine {text:string;confidence:number;bounds:number[];alternatives:string[]}
export interface EvidenceOCRResult {engine:string;version:string;configuration:string;lines:EvidenceOCRLine[]}
export interface ReprocessingOCRBackend {available:boolean;fingerprint?:string;recognize(image:Buffer,signal:AbortSignal):Promise<EvidenceOCRResult>}
/** A separate local raster pass, not a reuse of the import extractor's OCR cache. Whether
 * this is independent of the initial extraction is decided from that page's provenance. */
export class NativeReprocessingOCR implements ReprocessingOCRBackend {
 readonly available=process.platform==='darwin'&&existsSync('/usr/bin/swiftc')&&existsSync('/usr/bin/sandbox-exec');readonly fingerprint=createHash('sha256').update(readFileSync(fileURLToPath(new URL('../../../scripts/reprocessing-ocr.swift',import.meta.url)))).update(release()).digest('hex');private closed=false;private children=new Set<ReturnType<typeof spawn>>();private directory:string|null=null;private compiler:Promise<string>|null=null;
 async recognize(image:Buffer,signal:AbortSignal):Promise<EvidenceOCRResult>{
  if(this.closed)throw new HttpError(503,'Local OCR worker is closed.');
  if(!this.available)throw new HttpError(501,'Local raster OCR currently requires macOS.');
  if(image.length>12*1024*1024)throw new HttpError(413,'Page image exceeds the local OCR limit.');
  const executable=await (this.compiler??=this.compile(signal).catch(error=>{this.compiler=null;throw error;}));
  if(this.closed)throw new HttpError(503,'Local OCR worker is closed.');
  const profile=`(version 1)(allow default)(deny network*)(deny file-write*)(deny process-fork)(deny process-exec)(allow process-exec (literal ${JSON.stringify(realpathSync(executable))}))(deny file-read* (subpath "/Users"))`;
  const output=await this.command('/usr/bin/sandbox-exec',['-p',profile,executable],signal,40000,image);
  let result:unknown;try{result=JSON.parse(output.toString('utf8'));}catch{throw new HttpError(502,'Local OCR returned malformed data.');}
  return validateOCRResult(result);
 }
 private async compile(signal:AbortSignal){
  const script=fileURLToPath(new URL('../../../scripts/reprocessing-ocr.swift',import.meta.url));
  this.directory??=mkdtempSync(path.join(tmpdir(),'noema-reprocessing-ocr-'));const executable=path.join(this.directory,'ocr-'+createHash('sha256').update(readFileSync(script)).digest('hex').slice(0,16));
  await this.command('/usr/bin/swiftc',[script,'-module-cache-path',path.join(this.directory,'modules'),'-o',executable],signal,120000);return executable;
 }
 private async command(program:string,args:string[],signal:AbortSignal,timeout:number,input?:Buffer){
  if(signal.aborted)throw new HttpError(409,'Local evidence collection cancelled.');const prepared=preparePDFWorker(program,args);
  try{return await new Promise<Buffer>((resolve,reject)=>{
   const child=spawn(program,prepared.args,{stdio:['pipe','pipe','pipe']});this.children.add(child);const chunks:Buffer[]=[];let size=0,overflow=false;
   const abort=()=>child.kill('SIGKILL'),timer=setTimeout(abort,timeout);signal.addEventListener('abort',abort,{once:true});
   child.stdout.on('data',(bytes:Buffer)=>{size+=bytes.length;if(size>2*1024*1024){overflow=true;abort();}else chunks.push(bytes);});child.stderr.resume();child.stdin.on('error',()=>{});child.stdin.end(input);
   const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);this.children.delete(child);};
   child.on('error',()=>{done();reject(new HttpError(503,'Local OCR worker could not start.'));});child.on('close',code=>{done();if(code===0&&!signal.aborted&&!overflow)resolve(Buffer.concat(chunks));else reject(new HttpError(signal.aborted?409:502,signal.aborted?'Local evidence collection cancelled.':'Local OCR failed or exceeded its bounds.'));});
  });}finally{prepared.dispose();}
 }
 close(){this.closed=true;for(const child of this.children)child.kill('SIGKILL');if(this.directory)rmSync(this.directory,{force:true,recursive:true});}
}
export function validateOCRResult(value:unknown):EvidenceOCRResult{
 if(Buffer.byteLength(JSON.stringify(value)??'')>2*1024*1024)throw new HttpError(502,'OCR evidence exceeds the aggregate budget.');
 if(!value||typeof value!=='object')throw new HttpError(502,'Invalid local OCR result.');const result=value as EvidenceOCRResult;
 if(typeof result.engine!=='string'||result.engine.length>100||typeof result.version!=='string'||result.version.length>100||typeof result.configuration!=='string'||result.configuration.length>1000||!Array.isArray(result.lines)||result.lines.length>2000)throw new HttpError(502,'Invalid local OCR provenance.');
 for(const line of result.lines)if(!line||typeof line.text!=='string'||!line.text.trim()||line.text.length>4000||!Number.isFinite(line.confidence)||line.confidence<0||line.confidence>1||!Array.isArray(line.bounds)||line.bounds.length!==4||line.bounds.some(n=>!Number.isFinite(n)||n<0||n>1)||line.bounds[0]!+line.bounds[2]!>1.000001||line.bounds[1]!+line.bounds[3]!>1.000001||!Array.isArray(line.alternatives)||line.alternatives.length>10||line.alternatives.some(text=>typeof text!=='string'||text.length>4000))throw new HttpError(502,'Invalid local OCR line.');
 return result;
}
