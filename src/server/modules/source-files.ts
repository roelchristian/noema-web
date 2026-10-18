import { AINotifications } from './ai-notifications.js';
import { scanSourcePDF, fetchSource, sourceURL } from './source-import.js';
import { syncSourceProvenance } from './source-provenance.js';
import { mergeSourceStructure } from './source-structure.js';
import { normalizeSourceText } from './source-text-normalization.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, existsSync, statSync, rmSync, renameSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import type { SourceFile, SourceStructureNode } from '../../shared/domain.js';
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
  private pageMapAttempts=new Set<string>();
  private children = new Set<ChildProcess>();
  private flattenCompiler?: Promise<string>;
  constructor(private store: Store) {
    const database=store.all<{name:string;file:string}>('PRAGMA database_list').find(db=>db.name==='main');
    this.root=path.join(path.dirname(database?.file || ':memory:'),'assets');
  }
  filename(vault:string,id:string) {
    if(!/^(default|[0-9a-f-]{36})$/.test(vault)||!filePattern.test(id))throw new HttpError(400,'Invalid source file ID');
    return path.join(this.root,vault,'sources',id);
  }
  private inboxFilename(vault:string,id:string) {
    this.filename(vault,id); // Apply the same vault and file identifier checks.
    return path.join(this.root,vault,'source-inbox',id);
  }
  assetFilename(vault:string,id:string) {
    const file=this.require(vault,id);
    const inbox=this.inboxFilename(vault,id),admitted=this.filename(vault,id);
    return file.admitted===1||!existsSync(inbox)?admitted:inbox;
  }
  removeAssets(vault:string,id:string) {
    for(const filename of [this.filename(vault,id),this.inboxFilename(vault,id)])try{unlinkSync(filename);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  private requireSingle(vault:string,entityId:string|undefined) {
    if(!entityId)return;
    if(this.store.get<{type:string}>('SELECT type FROM entities WHERE id=? AND vault_id=?',entityId,vault)?.type!=='source')throw new HttpError(400,'Attach a file to a Source entity in this vault.');
    if(this.store.get('SELECT 1 FROM source_files WHERE entity_id=?',entityId))throw new HttpError(400,'A source has exactly one file or URL. Create another source instead.');
  }
  require(vault:string,id:string): SourceFile {
    const row=this.store.get<SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND id=?',vault,id);
    if(!row)throw new HttpError(404,'Source file not found in this vault');
    return row;
  }
  add(vault:string,name:string,bytes:Buffer,entityId?:string,sourceUrl?:string,pdfFlattened=false,pending=false,format?:SourceFile['format']) {
    const extension=name.split('.').at(-1)?.toLowerCase();
    if(format&&format!=='url'&&format!==extension)throw new HttpError(400,'Source format does not match the filename.');
    if(format==='url'&&(!pending||!sourceUrl))throw new HttpError(400,'A queued URL source needs a URL.');
    if(!extension || !sourceExtensions.includes(extension))throw new HttpError(415,'Choose a TXT, MD, or PDF file');
    if(!bytes.length)throw new HttpError(400,'Choose a nonempty file');
    if(bytes.length>maxSourceBytes)throw new HttpError(413,'Source files must be 50 MB or smaller');
    if(name.length>255 || /[\x00-\x1f\x7f/\\]/.test(name))throw new HttpError(400,'Invalid filename');
    if(!pending&&extension==='pdf')scanSourcePDF(bytes);
    const origin=sourceUrl?sourceURL(sourceUrl).href:null;
    if(!pending&&extension!=='pdf') {
      try {new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new HttpError(415,'Text sources must use UTF-8 encoding');}
      if(bytes.includes(0))throw new HttpError(415,'This file contains binary data');
    }
    this.requireSingle(vault,entityId);
    const id=randomUUID()+'.'+extension,filename=pending?this.inboxFilename(vault,id):this.filename(vault,id);
    mkdirSync(path.dirname(filename),{recursive:true});
    writeFileSync(filename,bytes,{flag:'wx',mode:0o600});
    try {
      const insert=()=>this.store.run('INSERT INTO source_files (id,vault_id,entity_id,name,size,status,created_at,import_method,source_url,pdf_flattened,admitted,format,original_filename) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',id,vault,entityId??null,name,bytes.length,'queued',now(),origin?'url':'upload',origin,pdfFlattened?1:0,pending?0:1,format??extension,name);
      if(entityId)this.store.transaction(()=>{this.requireSingle(vault,entityId);insert();this.store.run('UPDATE entities SET inactive=0,updated_at=? WHERE id=?',now(),entityId);syncSourceProvenance(this.store,vault,entityId);});
      else insert();
    }catch(error){unlinkSync(filename);throw error;}
    return this.require(vault,id);
  }
  async admit(vault:string,name:string,bytes:Buffer,entityId:string|undefined,requireOpen:()=>void,sourceUrl?:string) {
    if(this.closed)throw new HttpError(503,'Source processing is shutting down. Try again after restarting.');
    requireOpen();
    return this.add(vault,name,bytes,entityId,sourceUrl,false,true);
  }
  private async flattenPDF(bytes:Buffer):Promise<Buffer> {
    const directory=mkdtempSync(path.join(tmpdir(),'noema-pdf-'));
    try {
      const input=path.join(directory,'input.pdf'),output=path.join(directory,'flattened.pdf');
      writeFileSync(input,bytes,{mode:0o600,flag:'wx'});
      if(!this.flattenCompiler)this.flattenCompiler=this.compileFlattener().catch(error=>{this.flattenCompiler=undefined;throw error;});
      const executable=await this.flattenCompiler;
      await this.command(executable,[input,output],10*60*1000);
      const size=statSync(output).size;
      if(!size||size>maxSourceBytes)throw new HttpError(413,'The flattened PDF exceeds the 50 MB limit or is empty. Split it into smaller files and try again.');
      return readFileSync(output);
    }catch(error){
      if(error instanceof HttpError)throw error;
      throw new HttpError(415,'Local PDF flattening failed. '+(error instanceof Error?error.message:'Try another copy of this PDF.'));
    }finally{rmSync(directory,{recursive:true,force:true});}
  }
  private async compileFlattener() {
    mkdirSync(this.root,{recursive:true});
    const executable=path.join(this.root,'source-flattener');
    const script=fileURLToPath(new URL('../../../scripts/flatten-source.swift',import.meta.url));
    if(!existsSync(executable)||statSync(script).mtimeMs>statSync(executable).mtimeMs) {
      const temporary=executable+'-'+randomUUID();
      try {await this.command('/usr/bin/swiftc',[script,'-o',temporary],120000);renameSync(temporary,executable);}
      finally{rmSync(temporary,{force:true});}
    }
    return executable;
  }
  async addURL(vault:string,value:unknown,entityId:string|undefined,requireOpen:()=>void) {
    const url=sourceURL(value);
    let name:string;try{name=decodeURIComponent(url.pathname.split('/').at(-1)??'');}catch{name='';}
    name=(name||url.hostname).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,220);
    if(!/\.(txt|md|pdf)$/i.test(name))name+='.txt';
    requireOpen();
    return this.add(vault,name,Buffer.from(url.href),entityId,url.href,false,true,'url');
  }
  remove(vault:string,id:string) {
    const file=this.require(vault,id);
    if(file.status==='processing')throw new HttpError(409,'Wait for extraction to finish before removing this file');
    if(file.entity_id && this.store.get<{count:number}>('SELECT count(*) AS count FROM source_files WHERE entity_id=?',file.entity_id)!.count<=1)throw new HttpError(400,'A source must keep at least one attached file. Attach a replacement first.');
    // Unlink first so a filesystem failure leaves the database reference available to retry.
    this.removeAssets(vault,id);
    this.store.run('DELETE FROM source_files WHERE id=? AND vault_id=?',id,vault);
    if(file.entity_id)syncSourceProvenance(this.store,vault,file.entity_id);
    return {ok:true};
  }
  retry(vault:string,id:string) {
    const file=this.require(vault,id);
    if(file.status==='processing'||file.status==='queued')throw new HttpError(409,'Extraction is already in progress');
    this.store.transaction(()=>{
      this.store.run("UPDATE source_files SET status='queued',error=NULL,progress=0,enrichment_status='pending',enrichment_attempts=0,enrichment_error=NULL,enrichment_next_attempt_at='' WHERE id=?",id);
      if(file.entity_id)this.store.run('UPDATE entities SET inactive=0,updated_at=? WHERE id=?',now(),file.entity_id);
    });
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
    let file=this.store.get<SourceFile>("SELECT f.* FROM source_files f JOIN vaults v ON v.id=f.vault_id WHERE f.status='queued' AND f.entity_id IS NOT NULL AND v.locked=0 ORDER BY f.created_at LIMIT 1");
    if(!file){await this.backfillPageMap();return;}
    this.running=true;
    this.store.run("UPDATE source_files SET status='processing',error=NULL WHERE id=?",file.id);
    const open=()=>!!this.store.get('SELECT 1 FROM vaults WHERE id=? AND locked=0',file!.vault_id);
    try {
      let bytes:Buffer;
      let downloadedStructure:SourceStructureNode[]|undefined;
      if(file.format==='url') {
        const downloaded=await fetchSource(file.source_url);
        if(this.closed)return;
        if(!open()){this.store.run("UPDATE source_files SET status='queued',progress=0 WHERE id=?",file.id);return;}
        bytes=downloaded.bytes;
        downloadedStructure=downloaded.structuralNodes;
        const format=downloaded.name.split('.').at(-1)!.toLowerCase() as SourceFile['format'];
        this.replaceFile(this.inboxFilename(file.vault_id,file.id),bytes);
        this.store.transaction(()=>{
          this.store.run('UPDATE source_files SET name=?,size=?,format=? WHERE id=?',downloaded.name,bytes.length,format,file!.id);
          this.store.run('UPDATE entities SET name=?,updated_at=? WHERE id=? AND name=?',downloaded.name.slice(0,200),now(),file!.entity_id,file!.name.slice(0,200));
        });
        file=this.require(file.vault_id,file.id);
      }else bytes=readFileSync(this.assetFilename(file.vault_id,file.id));
      if(file.format==='pdf') {
        try{scanSourcePDF(bytes);}catch(error){
          if(!(error instanceof HttpError))throw error;
          if(process.platform!=='darwin')throw new Error('This PDF needs local flattening, which currently requires macOS.');
          bytes=await this.flattenPDF(bytes);
          scanSourcePDF(bytes);
          if(this.closed)return;
          this.replaceFile(this.inboxFilename(file.vault_id,file.id),bytes);
          this.store.run('UPDATE source_files SET pdf_flattened=1,admitted=0,size=? WHERE id=?',bytes.length,file.id);
          file=this.require(file.vault_id,file.id);
        }
      } else {
        if(file.format==='html')throw new Error('Legacy HTML files need a TXT, Markdown, or URL replacement.');
        try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('Text sources must use UTF-8 encoding.');}
        if(bytes.includes(0))throw new Error('This file contains binary data.');
      }
      if(this.closed)return;
      if(!open()){this.store.run("UPDATE source_files SET status='queued',progress=0 WHERE id=?",file.id);return;}
      // Only screened bytes move out of the inbox and become downloadable.
      if(file.admitted!==1) {
        this.replaceFile(this.filename(file.vault_id,file.id),bytes);
        this.store.run('UPDATE source_files SET admitted=1,size=? WHERE id=?',bytes.length,file.id);
        rmSync(this.inboxFilename(file.vault_id,file.id),{force:true});
      }
      const result=file.format==='pdf'?await this.pdf(this.filename(file.vault_id,file.id),file.id):{text:bytes.toString('utf8'),pages:0,ocrPages:0,pageStartLines:[]};
      if(this.closed)return;
      if(!open()){this.store.run("UPDATE source_files SET status='queued',progress=0 WHERE id=?",file.id);return;}
      if(Buffer.byteLength(result.text)>maxText)throw new Error('Extracted text exceeds the 16 MB limit.');
      if(!result.text.trim())throw new Error('No readable text found. Try a clearer file.');
      let explicit:SourceStructureNode[]=[];
      if(downloadedStructure)explicit=downloadedStructure;
      else if('structuralNodes' in result&&Array.isArray(result.structuralNodes))explicit=result.structuralNodes;
      else if(file.text===result.text&&file.structural_nodes)try{const nodes:unknown=JSON.parse(file.structural_nodes);if(Array.isArray(nodes))explicit=nodes;}catch{/* Old metadata can be regenerated from text. */}
      // Existing references address stored lines. Reprocessing must not renumber
      // those lines merely to improve formatting.
      const cited=this.store.get('SELECT 1 FROM note_source_references WHERE file_id=? LIMIT 1',file.id);
      let savedStructure:SourceStructureNode[]=[];
      if(cited)try{const nodes:unknown=JSON.parse(file.structural_nodes??'[]');if(Array.isArray(nodes))savedStructure=nodes;}catch{/* Infer headings without changing citation lines. */}
      const processed=cited?{text:file.text,pageStartLines:JSON.parse(file.page_start_lines??'[]') as number[],structuralNodes:mergeSourceStructure(file.text,savedStructure)}:normalizeSourceText(result.text,explicit,result.pageStartLines??[]);
      const structure=processed.structuralNodes;
      this.store.transaction(()=>{
        this.store.run("UPDATE source_files SET enrichment_status='pending',enrichment_attempts=0,enrichment_error=NULL,enrichment_next_attempt_at='',status='ready',text=?,pages=?,ocr_pages=?,page_start_lines=?,structural_nodes=?,progress=100,error=NULL WHERE id=?",processed.text,result.pages,result.ocrPages,JSON.stringify(processed.pageStartLines),JSON.stringify(structure),file!.id);
        this.store.run('UPDATE entities SET inactive=0,updated_at=? WHERE id=? AND vault_id=?',now(),file!.entity_id,file!.vault_id);
        new AINotifications(this.store).recordSource(file!.vault_id,file!.entity_id!,'completed');
      });
    }catch(error){
      if(!this.closed)this.store.transaction(()=>{
        this.store.run("UPDATE source_files SET status='failed',error=? WHERE id=?",error instanceof Error?error.message:'Source processing failed. Retry processing.',file!.id);
        this.store.run('UPDATE entities SET inactive=CASE WHEN ? THEN inactive ELSE 1 END,updated_at=? WHERE id=? AND vault_id=?',file!.text.trim()?1:0,now(),file!.entity_id,file!.vault_id);
        new AINotifications(this.store).recordSource(file!.vault_id,file!.entity_id!,'failed');
      });
    }finally{this.running=false;}
  }
  /** Recover boundaries for old PDFs without changing their stored text or citations. */
  private async backfillPageMap() {
    if(process.platform!=='darwin')return;
    const file=this.store.all<SourceFile>(`SELECT f.* FROM source_files f JOIN vaults v ON v.id=f.vault_id
      WHERE f.format='pdf' AND f.status='ready' AND f.admitted=1 AND f.page_start_lines='[]' AND v.locked=0
      AND EXISTS (SELECT 1 FROM note_source_references r WHERE r.file_id=f.id) ORDER BY f.created_at`).find(file=>!this.pageMapAttempts.has(file.id));
    if(!file)return;
    this.pageMapAttempts.add(file.id);this.running=true;
    try {
      const result=await this.pdf(this.filename(file.vault_id,file.id),file.id,false);
      if(this.closed||result.text!==file.text)return;
      this.store.run(`UPDATE source_files SET page_start_lines=? WHERE id=? AND text=? AND status='ready'
        AND EXISTS (SELECT 1 FROM vaults WHERE id=source_files.vault_id AND locked=0)`,JSON.stringify(result.pageStartLines),file.id,file.text);
    }catch{/* Keep old citations usable when original files or page boundaries cannot be recovered. */}
    finally{this.running=false;}
  }
  private replaceFile(filename:string,bytes:Buffer) {
    mkdirSync(path.dirname(filename),{recursive:true});
    const temporary=filename+'.'+randomUUID()+'.tmp';
    try{writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});renameSync(temporary,filename);}
    finally{rmSync(temporary,{force:true});}
  }
  private async pdf(filename:string,id:string,trackProgress=true):Promise<{text:string;pages:number;ocrPages:number;pageStartLines:number[];structuralNodes?:SourceStructureNode[]}> {
    if(process.platform!=='darwin')throw new Error('PDF extraction requires macOS with Apple PDFKit and Vision. TXT and MD sources work on this device.');
    // Compile once into the local vault data area; no cloud model or remote OCR.
    const executable=path.join(this.root,'source-extractor');
    const script=fileURLToPath(new URL('../../../scripts/extract-source.swift',import.meta.url));
    if(!existsSync(executable)||statSync(script).mtimeMs>statSync(executable).mtimeMs)await this.command('/usr/bin/swiftc',[script,'-o',executable],120000);
    const output=await this.command(executable,[filename],10*60*1000,line=>{
      try {const p=JSON.parse(line);if(trackProgress&&Number.isInteger(p.page)&&p.pages>0&&!this.closed)this.store.run('UPDATE source_files SET pages=?,progress=? WHERE id=?',p.pages,Math.floor(p.page/p.pages*100),id);}catch{/* Native diagnostics are never stored as source text. */}
    });
    try {return JSON.parse(output);}catch{throw new Error('The local PDF extractor returned an invalid result. Retry extraction.');}
  }
  private command(program:string,args:string[],timeout:number,onProgress?:(line:string)=>void):Promise<string> {
    return new Promise((resolve,reject)=>{
      if(this.closed){reject(new Error('Local PDF processing stopped. Try importing again.'));return;}
      const child=spawn(program,args,{stdio:['ignore','pipe','pipe']});this.children.add(child);
      let output='',errors='',pending='',overflow=false;
      const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
      child.stdout!.on('data',chunk=>{output+=chunk.toString();if(Buffer.byteLength(output)>maxText*2){overflow=true;child.kill('SIGKILL');}});
      child.stderr!.on('data',chunk=>{const value=chunk.toString();errors=(errors+value).slice(-2000);pending=(pending+value).slice(-4000);let newline;while((newline=pending.indexOf('\n'))>=0){onProgress?.(pending.slice(0,newline));pending=pending.slice(newline+1);}});
      child.on('error',()=>{clearTimeout(timer);this.children.delete(child);reject(new Error('Local PDF processing could not start. Install the macOS Command Line Tools, then retry.'));});
      child.on('close',code=>{clearTimeout(timer);this.children.delete(child);if(code===0)resolve(output);else reject(new Error(overflow?'Extracted text exceeds the size limit.':errors && !errors.includes('error:')?errors.slice(-500):'Local PDF processing failed or timed out. Check macOS Command Line Tools, then retry.'));});
    });
  }
  close(){this.closed=true;for(const child of this.children)child.kill('SIGKILL');}
}
