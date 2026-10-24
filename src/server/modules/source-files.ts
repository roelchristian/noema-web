import {maxSourceBytes,maxSourceTextBytes} from '../../shared/source-input.js';
export {maxSourceBytes,maxSourceTextBytes} from '../../shared/source-input.js';
import {getNameProvenance,recordEntityNameProvenance} from './property-provenance.js';
import {preparePDFWorker} from './pdf-worker.js';
import { AINotifications } from './ai-notifications.js';
import { scanSourcePDF, fetchSource, sourceURL } from './source-import.js';
import { syncSourceProvenance } from './source-provenance.js';
import { mergeSourceStructure } from './source-structure.js';
import { normalizeSourceText } from './source-text-normalization.js';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, existsSync, statSync, rmSync, renameSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import type { SourceFile, SourceStructureNode } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError, now } from '../validation.js';

export const sourceExtensions = ['txt','md','pdf'];
// Keep legacy HTML originals addressable for download/removal, but reject new uploads.
const filePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(txt|md|html|pdf)$/;
/** Download filenames may replace only an unchanged, explicitly system-derived placeholder.
 * The caller performs this check inside the attachment metadata transaction. */
export function syncDownloadedSourceName(store:Store,file:SourceFile,downloadedName:string,expected:{name:string;updated_at:string}|undefined) {
  if(!expected||expected.name!==file.name.slice(0,200)||!file.entity_id)return;
  const entity=store.get<{name:string;updated_at:string}>(`SELECT e.name,e.updated_at FROM entities e JOIN source_files f ON f.entity_id=e.id AND f.vault_id=e.vault_id
    JOIN vaults v ON v.id=e.vault_id WHERE e.id=? AND e.vault_id=? AND e.type='source' AND e.archived_at IS NULL
    AND v.locked=0 AND f.id=?`,file.entity_id,file.vault_id,file.id);
  const origin=getNameProvenance(store,file.vault_id,file.entity_id);
  if(!entity||entity.name!==expected.name||entity.updated_at!==expected.updated_at||!origin||origin.stale||!['derived','ai'].includes(origin.origin))return;
  const changed=store.run('UPDATE entities SET name=?,updated_at=? WHERE id=? AND vault_id=? AND name=? AND updated_at=?',downloadedName.slice(0,200),now(),file.entity_id,file.vault_id,expected.name,expected.updated_at).changes;
  if(changed)recordEntityNameProvenance(store,file.vault_id,file.entity_id,{origin:'derived',source_file_id:file.id,source_hash:null,details:'source_download: downloaded filename replaced an unchanged system-derived placeholder.'});
}
export class SourceFiles {
  readonly root: string;
  private closed = false;
  private running = false;
  private pageMapAttempts=new Set<string>();
  private children = new Set<ChildProcess>();
  private flattenCompiler?: {hash:string;promise:Promise<string>};
  private lastSanitization:Record<string,unknown>={};
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
  private evidenceDirectory(vault:string,id:string) {
    this.filename(vault,id);
    return path.join(this.root,vault,'source-evidence',id);
  }
  evidence(vault:string,id:string):Record<string,unknown> {
    this.require(vault,id);
    const filename=path.join(this.evidenceDirectory(vault,id),'manifest.json');
    return existsSync(filename)?JSON.parse(readFileSync(filename,'utf8')):{version:1,originalAvailable:false,findings:['Original bytes and extraction evidence are unavailable for this legacy import. Re-upload to recover them.']};
  }
  /** Bind a reconstruction evidence adapter to both immutable original bytes and the
   * admitted viewing asset. Manifest claims alone are never sufficient. */
  reprocessingEvidenceBinding(vault:string,id:string) {
    const file=this.require(vault,id),manifest=this.evidence(vault,id);
    if(file.admitted!==1||file.status!=='ready'||file.format!=='pdf')throw new HttpError(409,'Original-page evidence requires an admitted processed PDF.');
    const original=path.join(this.evidenceDirectory(vault,id),'original'),admitted=this.filename(vault,id);
    if(!existsSync(original)||!existsSync(admitted)||manifest.originalAvailable!==true||typeof manifest.originalHash!=='string'||typeof manifest.admittedHash!=='string'||typeof manifest.canonicalHash!=='string')throw new HttpError(409,'Source evidence provenance is unavailable.');
    if(statSync(original).size>maxSourceBytes||statSync(admitted).size>maxSourceBytes||this.hash(readFileSync(original))!==manifest.originalHash||this.hash(readFileSync(admitted))!==manifest.admittedHash||this.hash(file.text)!==manifest.canonicalHash)throw new HttpError(409,'Source evidence checksums no longer match the admitted source.');
    return {originalHash:manifest.originalHash,admittedHash:manifest.admittedHash,canonicalHash:manifest.canonicalHash,extractorVerified:manifest.extractorHash===this.hash(readFileSync(fileURLToPath(new URL('../../../scripts/extract-source.swift',import.meta.url)))),manifest};
  }
  exportEvidence(vault:string,id:string) {
    const evidence=this.evidence(vault,id),original=path.join(this.evidenceDirectory(vault,id),'original');
    return {...evidence,...(existsSync(original)?{originalData:readFileSync(original).toString('base64')}:{})};
  }
  restoreEvidence(vault:string,id:string,value:unknown) {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'Invalid source evidence');
    const {originalData,...manifest}=value as Record<string,unknown>;
    // Restored extraction remains evidence, but must never become a trusted executable-version cache.
    delete manifest.extractorHash;
    delete manifest.sanitizerHash;
    if(Buffer.byteLength(JSON.stringify(manifest))>maxSourceTextBytes*4)throw new HttpError(413,'Source evidence exceeds the size limit');
    if(originalData!==undefined) {
      if(typeof originalData!=='string'||originalData.length>70*1024*1024)throw new HttpError(400,'Invalid original source bytes');
      const bytes=Buffer.from(originalData,'base64');
      if(!bytes.length||bytes.length>maxSourceBytes||bytes.toString('base64')!==originalData||manifest.originalHash!==this.hash(bytes))throw new HttpError(400,'Original source checksum does not match');
      this.preserveOriginal(vault,id,bytes);
    }
    this.replaceFile(path.join(this.evidenceDirectory(vault,id),'manifest.json'),Buffer.from(JSON.stringify(manifest)));
  }
  private hash(bytes:Buffer|string) {return createHash('sha256').update(bytes).digest('hex');}
  private preserveOriginal(vault:string,id:string,bytes:Buffer) {
    const directory=this.evidenceDirectory(vault,id),filename=path.join(directory,'original');
    mkdirSync(directory,{recursive:true,mode:0o700});
    if(!existsSync(filename))writeFileSync(filename,bytes,{flag:'wx',mode:0o600});
    else if(this.hash(readFileSync(filename))!==this.hash(bytes))throw new Error('The preserved original checksum changed.');
  }
  removeAssets(vault:string,id:string) {
    rmSync(this.evidenceDirectory(vault,id),{recursive:true,force:true});
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
  add(vault:string,name:string,bytes:Buffer,entityId?:string,sourceUrl?:string,pdfFlattened=false,pending=false,format?:SourceFile['format'],containsMath=false) {
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
      const insert=()=>this.store.run('INSERT INTO source_files (id,vault_id,entity_id,name,size,status,created_at,import_method,source_url,pdf_flattened,admitted,format,original_filename,contains_math) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,vault,entityId??null,name,bytes.length,'queued',now(),origin?'url':'upload',origin,pdfFlattened?1:0,pending?0:1,format??extension,name,containsMath?1:0);
      if(entityId)this.store.transaction(()=>{this.requireSingle(vault,entityId);insert();this.store.run('UPDATE entities SET inactive=0,updated_at=? WHERE id=?',now(),entityId);syncSourceProvenance(this.store,vault,entityId);});
      else insert();
    }catch(error){unlinkSync(filename);throw error;}
    return this.require(vault,id);
  }
  async admit(vault:string,name:string,bytes:Buffer,entityId:string|undefined,requireOpen:()=>void,sourceUrl?:string,containsMath=false) {
    if(this.closed)throw new HttpError(503,'Source processing is shutting down. Try again after restarting.');
    requireOpen();
    return this.add(vault,name,bytes,entityId,sourceUrl,false,true,undefined,containsMath);
  }
  private sanitizerHash() {return this.hash(readFileSync(fileURLToPath(new URL('../../../scripts/flatten-source.swift',import.meta.url))));}
  private cachedSanitized(vault:string,originalHash:unknown,sanitizerHash:string) {
    if(typeof originalHash!=='string')return undefined;
    for(const row of this.store.all<{id:string}>("SELECT id FROM source_files WHERE vault_id=? AND format='pdf' AND status='ready' AND admitted=1 AND pdf_flattened=1",vault)) {
      try {
        const manifest=this.evidence(vault,row.id);
        if(manifest.originalHash!==originalHash||manifest.sanitizerHash!==sanitizerHash)continue;
        const bytes=readFileSync(this.filename(vault,row.id));
        if(this.hash(bytes)!==manifest.admittedHash)continue;
        scanSourcePDF(bytes); // Cached viewing assets never bypass admission screening.
        return {bytes,fileId:row.id,flattening:manifest.flattening as Record<string,unknown>|undefined};
      }catch{/* Missing/corrupt cache sources are regenerated from preserved originals. */}
    }
    return undefined;
  }
  private async flattenPDF(bytes:Buffer):Promise<Buffer> {
    const directory=mkdtempSync(path.join(tmpdir(),'noema-pdf-'));
    try {
      const input=path.join(directory,'input.pdf'),output=path.join(directory,'flattened.pdf');
      writeFileSync(input,bytes,{mode:0o600,flag:'wx'});
      const hash=this.sanitizerHash();
      if(this.flattenCompiler?.hash!==hash)this.flattenCompiler={hash,promise:this.compileFlattener().catch(error=>{this.flattenCompiler=undefined;throw error;})};
      const executable=await this.flattenCompiler.promise;
      const profile='(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (literal '+JSON.stringify(path.join(realpathSync(directory),'flattened.pdf'))+'))(deny process-fork)(deny process-exec)(allow process-exec (literal '+JSON.stringify(realpathSync(executable))+'))(deny file-read* (subpath "/Users"))(allow file-read* (literal '+JSON.stringify(realpathSync(executable))+') (literal '+JSON.stringify(realpathSync(input))+'))';
      this.lastSanitization={};
      try {
        const metrics=await this.command('/usr/bin/sandbox-exec',['-p',profile,executable,input,output,'passive-rebuild'],10*60*1000);
        scanSourcePDF(readFileSync(output));
        this.lastSanitization=JSON.parse(metrics);
      }catch(error) {
        if(this.closed)throw error;
        const fallbackReason=error instanceof Error?error.message:'Passive reconstruction failed.';
        const metrics=await this.command('/usr/bin/sandbox-exec',['-p',profile,executable,input,output,'raster'],10*60*1000);
        scanSourcePDF(readFileSync(output));
        this.lastSanitization={...JSON.parse(metrics),fallbackReason};
      }
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
    const source=readFileSync(fileURLToPath(new URL('../../../scripts/flatten-source.swift',import.meta.url)));
    const executable=path.join(this.root,'source-flattener-'+this.hash(source).slice(0,20));
    if(!existsSync(executable)) {
      const temporary=executable+'-'+randomUUID(),script=temporary+'.swift';
      writeFileSync(script,source,{flag:'wx',mode:0o600});
      try {await this.command('/usr/bin/swiftc',[script,'-O','-module-cache-path',path.join(tmpdir(),'noema-swift-module-cache'),'-o',temporary],120000);renameSync(temporary,executable);}
      finally{rmSync(temporary,{force:true});rmSync(script,{force:true});}
    }
    return executable;
  }
  async addURL(vault:string,value:unknown,entityId:string|undefined,requireOpen:()=>void,containsMath=false) {
    const url=sourceURL(value);
    let name:string;try{name=decodeURIComponent(url.pathname.split('/').at(-1)??'');}catch{name='';}
    name=(name||url.hostname).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,220);
    if(!/\.(txt|md|pdf)$/i.test(name))name+='.txt';
    requireOpen();
    return this.add(vault,name,Buffer.from(url.href),entityId,url.href,false,true,'url',containsMath);
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
        const expectedName=this.store.get<{name:string;updated_at:string}>('SELECT name,updated_at FROM entities WHERE id=? AND vault_id=?',file.entity_id!,file.vault_id);
        const downloaded=await fetchSource(file.source_url);
        if(this.closed)return;
        if(!open()){this.store.run("UPDATE source_files SET status='queued',progress=0 WHERE id=?",file.id);return;}
        bytes=downloaded.bytes;
        downloadedStructure=downloaded.structuralNodes;
        const format=downloaded.name.split('.').at(-1)!.toLowerCase() as SourceFile['format'];
        this.replaceFile(this.inboxFilename(file.vault_id,file.id),bytes);
        this.store.transaction(()=>{
          this.store.run('UPDATE source_files SET name=?,size=?,format=? WHERE id=?',downloaded.name,bytes.length,format,file!.id);
          syncDownloadedSourceName(this.store,file!,downloaded.name,expectedName);
        });
        file=this.require(file.vault_id,file.id);
      }else bytes=readFileSync(this.assetFilename(file.vault_id,file.id));
      let rawPDF:Awaited<ReturnType<SourceFiles['pdf']>>|undefined;
      let evidence=this.evidence(file.vault_id,file.id);
      const originalFilename=path.join(this.evidenceDirectory(file.vault_id,file.id),'original');
      if(!existsSync(originalFilename)&&file.pdf_flattened!==1) {
        this.preserveOriginal(file.vault_id,file.id,bytes);
        evidence={version:1,originalAvailable:true,originalHash:this.hash(bytes),originalBytes:bytes.length,createdAt:now()};
        this.replaceFile(path.join(this.evidenceDirectory(file.vault_id,file.id),'manifest.json'),Buffer.from(JSON.stringify(evidence)));
      }
      if(file.format==='pdf'&&existsSync(originalFilename)) {
        const originalBytes=readFileSync(originalFilename);
        if(evidence.originalHash!==this.hash(originalBytes))throw new Error('The preserved original checksum does not match its provenance.');
        const extractorHash=this.hash(readFileSync(fileURLToPath(new URL('../../../scripts/extract-source.swift',import.meta.url))));
        // Local evidence is a cache only when both input and extractor versions agree.
        if(evidence.extractorHash===extractorHash&&evidence.rawExtraction)rawPDF=evidence.rawExtraction as typeof rawPDF;
        else {
          rawPDF=await this.pdf(originalFilename,file.id);
          evidence={...evidence,extractorHash,rawExtraction:rawPDF,extractedAt:now()};
          this.replaceFile(path.join(this.evidenceDirectory(file.vault_id,file.id),'manifest.json'),Buffer.from(JSON.stringify(evidence)));
        }
      }
      if(file.format==='pdf') {
        const sanitizerHash=this.sanitizerHash();
        let reason:string|undefined;
        try{scanSourcePDF(bytes);}catch(error){if(!(error instanceof HttpError))throw error;reason=error.message;}
        if(file.pdf_flattened===1&&existsSync(originalFilename)&&(evidence.sanitizerHash!==sanitizerHash||evidence.admittedHash!==this.hash(bytes)))reason='Sanitizer version updated; rebuilt from the preserved original.';
        if(reason) {
          if(process.platform!=='darwin')throw new Error('This PDF needs local flattening, which currently requires macOS.');
          const start=performance.now(),original=existsSync(originalFilename)?readFileSync(originalFilename):bytes;
          const cached=this.cachedSanitized(file.vault_id,evidence.originalHash,sanitizerHash);
          this.lastSanitization={method:'raster',compression:'quartz-lossless-raster',dpi:200,maxDimension:3000};
          bytes=cached?.bytes??await this.flattenPDF(original);
          scanSourcePDF(bytes);
          evidence={...evidence,sanitizerHash,admittedHash:this.hash(bytes),admittedBytes:bytes.length,flattening:{reason,...(cached?.flattening??this.lastSanitization),discardedFeatures:(cached?.flattening??this.lastSanitization).method==='passive-rebuild'?['PDF outline','annotations','document metadata']:['embedded text','PDF outline','annotations','document metadata'],completedAt:now(),durationMs:Math.round(performance.now()-start),inputBytes:original.length,outputBytes:bytes.length,cacheHit:!!cached,...(cached?{reusedFrom:cached.fileId}:{})}};
          if(this.closed)return;
          this.replaceFile(path.join(this.evidenceDirectory(file.vault_id,file.id),'manifest.json'),Buffer.from(JSON.stringify(evidence)));
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
      const result=file.format==='pdf'?rawPDF??await this.pdf(this.filename(file.vault_id,file.id),file.id):{text:bytes.toString('utf8'),pages:0,ocrPages:0,pageStartLines:[]};
      if(this.closed)return;
      if(!open()){this.store.run("UPDATE source_files SET status='queued',progress=0 WHERE id=?",file.id);return;}
      if(Buffer.byteLength(result.text)>maxSourceTextBytes)throw new Error('Extracted text exceeds the 16 MB limit.');
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
      const previousNormalization=evidence.normalization as {text?:string}|undefined;
      const normalization=cited?(previousNormalization?.text===processed.text?previousNormalization:{...processed,provenanceAvailable:false,findings:['Existing citation offsets were preserved; raw normalization mapping is unavailable for this stored version.']}):processed;
      evidence={...evidence,admittedHash:this.hash(bytes),admittedBytes:bytes.length,rawExtraction:result,normalization,canonicalHash:this.hash(processed.text),completedAt:now()};
      this.replaceFile(path.join(this.evidenceDirectory(file.vault_id,file.id),'manifest.json'),Buffer.from(JSON.stringify(evidence)));
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
  private async pdf(filename:string,id:string,trackProgress=true):Promise<{text:string;pages:number;ocrPages:number;pageStartLines:number[];structuralNodes?:SourceStructureNode[];pageEvidence?:unknown[];unresolvedOutlines?:string[]}> {
    if(process.platform!=='darwin')throw new Error('PDF extraction requires macOS with Apple PDFKit and Vision. TXT and MD sources work on this device.');
    // Compile once into the local vault data area; no cloud model or remote OCR.
    const source=readFileSync(fileURLToPath(new URL('../../../scripts/extract-source.swift',import.meta.url)));
    const executable=path.join(this.root,'source-extractor-'+this.hash(source).slice(0,20));
    if(!existsSync(executable)) {
      const temporary=executable+'-'+randomUUID(),script=temporary+'.swift';
      writeFileSync(script,source,{flag:'wx',mode:0o600});
      try{await this.command('/usr/bin/swiftc',[script,'-module-cache-path',path.join(tmpdir(),'noema-swift-module-cache'),'-o',temporary],120000);renameSync(temporary,executable);}
      finally{rmSync(temporary,{force:true});rmSync(script,{force:true});}
    }
    // No networking, child executables, or filesystem writes while parsing untrusted PDF bytes.
    const profile='(version 1)(allow default)(deny network*)(deny file-write*)(deny process-fork)(deny process-exec)(allow process-exec (literal '+JSON.stringify(realpathSync(executable))+'))(deny file-read* (subpath "/Users"))(allow file-read* (literal '+JSON.stringify(realpathSync(filename))+') (literal '+JSON.stringify(realpathSync(executable))+'))';
    const output=await this.command('/usr/bin/sandbox-exec',['-p',profile,executable,filename],10*60*1000,line=>{
      try {const p=JSON.parse(line);if(trackProgress&&Number.isInteger(p.page)&&p.pages>0&&!this.closed)this.store.run('UPDATE source_files SET pages=?,progress=? WHERE id=?',p.pages,Math.floor(p.page/p.pages*100),id);}catch{/* Native diagnostics are never stored as source text. */}
    });
    try {return JSON.parse(output);}catch{throw new Error('The local PDF extractor returned an invalid result. Retry extraction.');}
  }
  private command(program:string,args:string[],timeout:number,onProgress?:(line:string)=>void):Promise<string> {
    const prepared=preparePDFWorker(program,args);
    return new Promise<string>((resolve,reject)=>{
      if(this.closed){reject(new Error('Local PDF processing stopped. Try importing again.'));return;}
      const child=spawn(program,prepared.args,{stdio:['ignore','pipe','pipe']});this.children.add(child);
      let output='',errors='',pending='',overflow=false;
      const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
      child.stdout!.on('data',chunk=>{output+=chunk.toString();if(Buffer.byteLength(output)>maxSourceTextBytes*2){overflow=true;child.kill('SIGKILL');}});
      child.stderr!.on('data',chunk=>{const value=chunk.toString();errors=(errors+value).slice(-2000);pending=(pending+value).slice(-4000);let newline;while((newline=pending.indexOf('\n'))>=0){onProgress?.(pending.slice(0,newline));pending=pending.slice(newline+1);}});
      child.on('error',()=>{clearTimeout(timer);this.children.delete(child);reject(new Error('Local PDF processing could not start. Install the macOS Command Line Tools, then retry.'));});
      child.on('close',code=>{clearTimeout(timer);this.children.delete(child);if(code===0)resolve(output);else reject(new Error(overflow?'Extracted text exceeds the size limit.':errors && !errors.includes('error:')?errors.slice(-500):'Local PDF processing failed or timed out. Check macOS Command Line Tools, then retry.'));});
    }).finally(()=>prepared.dispose());
  }
  close(){this.closed=true;for(const child of this.children)child.kill('SIGKILL');}
}
