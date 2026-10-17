import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import type { SourceFile } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError, now } from '../validation.js';

export const maxSourceBytes = 50 * 1024 * 1024;
export const sourceExtensions = ['txt','md','pdf'];
// Keep legacy HTML originals addressable for download/removal, but reject new uploads.
const filePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(txt|md|html|pdf)$/;
const maxText = 16 * 1024 * 1024;
export class SourceFiles {
  readonly root: string;
  private closed = false;
  private running = false;
  private child?: ChildProcess;
  constructor(private store: Store) {
    const database=store.all<{name:string;file:string}>('PRAGMA database_list').find(db=>db.name==='main');
    this.root=path.join(path.dirname(database?.file || ':memory:'),'assets');
  }
  filename(vault:string,id:string) {
    if(!/^(default|[0-9a-f-]{36})$/.test(vault)||!filePattern.test(id))throw new HttpError(400,'Invalid source file ID');
    return path.join(this.root,vault,'sources',id);
  }
  require(vault:string,id:string): SourceFile {
    const row=this.store.get<SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND id=?',vault,id);
    if(!row)throw new HttpError(404,'Source file not found in this vault');
    return row;
  }
  add(vault:string,name:string,bytes:Buffer,entityId?:string) {
    const extension=name.split('.').at(-1)?.toLowerCase();
    if(!extension || !sourceExtensions.includes(extension))throw new HttpError(415,'Choose a TXT, MD, or PDF file');
    if(!bytes.length)throw new HttpError(400,'Choose a nonempty file');
    if(bytes.length>maxSourceBytes)throw new HttpError(413,'Source files must be 50 MB or smaller');
    if(name.length>255 || /[\x00-\x1f\x7f/\\]/.test(name))throw new HttpError(400,'Invalid filename');
    if(extension==='pdf' && !bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new HttpError(415,'This file is not a PDF');
    if(extension!=='pdf') {
      try {new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new HttpError(415,'Text sources must use UTF-8 encoding');}
      if(bytes.includes(0))throw new HttpError(415,'This file contains binary data');
    }
    if(entityId && this.store.get<{type:string}>('SELECT type FROM entities WHERE id=? AND vault_id=?',entityId,vault)?.type!=='source')throw new HttpError(400,'Attach files to a Source entity in this vault');
    const id=randomUUID()+'.'+extension,filename=this.filename(vault,id);
    mkdirSync(path.dirname(filename),{recursive:true});
    writeFileSync(filename,bytes,{flag:'wx',mode:0o600});
    try {
      this.store.run('INSERT INTO source_files (id,vault_id,entity_id,name,size,status,created_at) VALUES (?,?,?,?,?,?,?)',id,vault,entityId??null,name,bytes.length,'queued',now());
    }catch(error){unlinkSync(filename);throw error;}
    return this.require(vault,id);
  }
  remove(vault:string,id:string) {
    const file=this.require(vault,id);
    if(file.status==='processing')throw new HttpError(409,'Wait for extraction to finish before removing this file');
    if(file.entity_id && this.store.get<{count:number}>('SELECT count(*) AS count FROM source_files WHERE entity_id=?',file.entity_id)!.count<=1)throw new HttpError(400,'A source must keep at least one attached file. Attach a replacement first.');
    // Unlink first so a filesystem failure leaves the database reference available to retry.
    try {unlinkSync(this.filename(vault,id));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    this.store.run('DELETE FROM source_files WHERE id=? AND vault_id=?',id,vault);
    return {ok:true};
  }
  retry(vault:string,id:string) {
    const file=this.require(vault,id);
    if(file.status==='processing'||file.status==='queued')throw new HttpError(409,'Extraction is already in progress');
    this.store.run("UPDATE source_files SET status='queued',error=NULL,progress=0 WHERE id=?",id);
    return this.require(vault,id);
  }
  recover() {
    this.store.run("UPDATE source_files SET status='queued',progress=0 WHERE status='processing'");
    this.cleanup();
  }
  cleanup() {
    // Only abandoned, unattached uploads expire. Knowledge entities retain all originals.
    for(const file of this.store.all<SourceFile>("SELECT * FROM source_files WHERE entity_id IS NULL AND created_at < ?",new Date(Date.now()-86400000).toISOString()))this.remove(file.vault_id,file.id);
  }
  async tick() {
    if(this.closed || this.running)return;
    const file=this.store.get<SourceFile>("SELECT f.* FROM source_files f JOIN vaults v ON v.id=f.vault_id WHERE f.status='queued' AND v.locked=0 ORDER BY f.created_at LIMIT 1");
    if(!file)return;
    this.running=true;
    this.store.run("UPDATE source_files SET status='processing',error=NULL WHERE id=?",file.id);
    try {
      let result:{text:string;pages:number;ocrPages:number};
      if(file.id.endsWith('.pdf')) result=await this.pdf(this.filename(file.vault_id,file.id),file.id);
      else {
        if(file.id.endsWith('.html'))throw new Error('HTML source extraction is disabled. Attach a TXT, MD, or PDF replacement.');
        const value=readFileSync(this.filename(file.vault_id,file.id),'utf8');
        result={text:value,pages:0,ocrPages:0};
      }
      if(this.closed)return;
      if(Buffer.byteLength(result.text)>maxText)throw new Error('Extracted text exceeds the 16 MB limit.');
      if(!result.text.trim())throw new Error('No readable text found. The original is saved; try a clearer file, then retry.');
      this.store.run("UPDATE source_files SET status='ready',text=?,pages=?,ocr_pages=?,progress=100,error=NULL WHERE id=?",result.text,result.pages,result.ocrPages,file.id);
    }catch(error){
      if(!this.closed)this.store.run("UPDATE source_files SET status='failed',error=? WHERE id=?",error instanceof Error?error.message:'Text extraction failed. Retry extraction.',file.id);
    }finally{this.running=false;}
  }
  private async pdf(filename:string,id:string):Promise<{text:string;pages:number;ocrPages:number}> {
    if(process.platform!=='darwin')throw new Error('PDF extraction requires macOS with Apple PDFKit and Vision. TXT and MD sources work on this device.');
    // Compile once into the local vault data area; no cloud model or remote OCR.
    const executable=path.join(this.root,'source-extractor');
    const script=fileURLToPath(new URL('../../../scripts/extract-source.swift',import.meta.url));
    if(!existsSync(executable)||statSync(script).mtimeMs>statSync(executable).mtimeMs)await this.command('/usr/bin/swiftc',[script,'-o',executable],120000);
    const output=await this.command(executable,[filename],10*60*1000,line=>{
      try {const p=JSON.parse(line);if(Number.isInteger(p.page)&&p.pages>0&&!this.closed)this.store.run('UPDATE source_files SET pages=?,progress=? WHERE id=?',p.pages,Math.floor(p.page/p.pages*100),id);}catch{/* Native diagnostics are never stored as source text. */}
    });
    try {return JSON.parse(output);}catch{throw new Error('The local PDF extractor returned an invalid result. Retry extraction.');}
  }
  private command(program:string,args:string[],timeout:number,onProgress?:(line:string)=>void):Promise<string> {
    return new Promise((resolve,reject)=>{
      const child=spawn(program,args,{stdio:['ignore','pipe','pipe']});this.child=child;
      let output='',errors='',pending='',overflow=false;
      const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
      child.stdout!.on('data',chunk=>{output+=chunk.toString();if(Buffer.byteLength(output)>maxText*2){overflow=true;child.kill('SIGKILL');}});
      child.stderr!.on('data',chunk=>{const value=chunk.toString();errors=(errors+value).slice(-2000);pending+=value;let newline;while((newline=pending.indexOf('\n'))>=0){onProgress?.(pending.slice(0,newline));pending=pending.slice(newline+1);}});
      child.on('error',()=>{clearTimeout(timer);reject(new Error('The local PDF extractor could not start. Install the macOS Command Line Tools, then retry.'));});
      child.on('close',code=>{clearTimeout(timer);this.child=undefined;if(code===0)resolve(output);else reject(new Error(overflow?'Extracted text exceeds the size limit.':errors && !errors.includes('error:')?errors.slice(-500):'Local PDF extraction failed or timed out. Check macOS Command Line Tools, then retry.'));});
    });
  }
  close(){this.closed=true;this.child?.kill('SIGKILL');}
}
