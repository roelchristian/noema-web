import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {cleanSpeechText} from '../../shared/speech-text.js';
import {speechModel} from '../../shared/intelligence.js';
import {speechVoice,speechNarrationInstructions,speechMaxAudioBytes} from './realtime-speech.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';

export const speechCacheVersion='wav-pcm24k-mono16-v1';
export function speechCacheKey(text:string,options:{model?:string;voice?:string;version?:string}={}) {
  return createHash('sha256').update(JSON.stringify([cleanSpeechText(text),options.model??speechModel,options.voice??speechVoice,options.version??speechCacheVersion,speechNarrationInstructions])).digest('hex');
}
function digest(audio:Buffer){return createHash('sha256').update(audio).digest('hex');}
export function validSpeechWav(audio:Buffer) {
  return audio.length>44&&audio.length<=speechMaxAudioBytes+44&&audio.length%2===0&&audio.toString('ascii',0,4)==='RIFF'&&audio.readUInt32LE(4)===audio.length-8&&audio.toString('ascii',8,16)==='WAVEfmt '&&audio.readUInt32LE(16)===16&&audio.readUInt16LE(20)===1&&audio.readUInt16LE(22)===1&&audio.readUInt32LE(24)===24000&&audio.readUInt32LE(28)===48000&&audio.readUInt16LE(32)===2&&audio.readUInt16LE(34)===16&&audio.toString('ascii',36,40)==='data'&&audio.readUInt32LE(40)===audio.length-44;
}
/** Derived vault assets contain only generated audio and an integrity digest. */
export class SpeechCache {
  private root:string|undefined;
  private memory=new Map<string,Buffer>();
  constructor(store:Store) {
    const database=store.all<{name:string;file:string}>('PRAGMA database_list').find(row=>row.name==='main')?.file;
    this.root=database?path.join(path.dirname(database),'assets'):undefined;
  }
  private filename(vault:string,key:string) {
    if(!/^(default|[0-9a-f-]{36})$/.test(vault)||! /^[a-f0-9]{64}$/.test(key))throw new HttpError(400,'Invalid speech cache reference.');
    return this.root?path.join(this.root,vault,'speech',key+'.wav'):null;
  }
  private directory(vault:string,create=false):boolean {
    this.filename(vault,'0'.repeat(64));
    if(!this.root)return true;
    for(const directory of [this.root,path.join(this.root,vault),path.join(this.root,vault,'speech')]) {
      try {
        if(create&&!existsSync(directory))mkdirSync(directory,{mode:0o700});
        const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())return false;
      } catch(error) {if(!create)return false;throw error;}
    }
    return true;
  }
  read(vault:string,key:string):Buffer|null {
    const filename=this.filename(vault,key);
    if(!filename)return this.memory.get(vault+':'+key)??null;
    if(!this.directory(vault))return null;
    try {
      const stat=lstatSync(filename),checksumStat=lstatSync(filename+'.sha256');
      if(!stat.isFile()||!checksumStat.isFile()||stat.size>speechMaxAudioBytes+44||checksumStat.size!==64)return null;
      const audio=readFileSync(filename),checksum=readFileSync(filename+'.sha256','utf8');
      return validSpeechWav(audio)&&digest(audio)===checksum?audio:null;
    }catch{return null;}
  }
  private assetKey(id:string) {
    if(!/^[a-f0-9]{64}\.wav$/.test(id))throw new HttpError(400,'Invalid speech asset ID.');
    return id.slice(0,-4);
  }
  entries(vault:string):{id:string;bytes:Buffer}[] {
    const probe=this.filename(vault,'0'.repeat(64));
    const ids=probe?(this.directory(vault)?readdirSync(path.dirname(probe)):[]):[...this.memory.keys()].filter(key=>key.startsWith(vault+':')).map(key=>key.slice(vault.length+1)+'.wav');
    return ids.filter(id=>/^[a-f0-9]{64}\.wav$/.test(id)).flatMap(id=>{const bytes=this.read(vault,id.slice(0,-4));return bytes?[{id,bytes}]:[];});
  }
  restore(vault:string,id:string,bytes:Buffer) {this.write(vault,this.assetKey(id),bytes,()=>{});}
  remove(vault:string,id:string) {
    const key=this.assetKey(id),filename=this.filename(vault,key);
    if(filename){if(!this.directory(vault))return;rmSync(filename,{force:true});rmSync(filename+'.sha256',{force:true});}
    else this.memory.delete(vault+':'+key);
  }
  write(vault:string,key:string,audio:Buffer,validateAccess:()=>void) {
    const filename=this.filename(vault,key);
    if(!validSpeechWav(audio))throw new HttpError(502,'Generated speech audio is invalid.');
    validateAccess();
    if(!filename){this.memory.set(vault+':'+key,Buffer.from(audio));return;}
    const temporary=filename+'.'+randomUUID()+'.tmp',checksumTemporary=temporary+'.sha256';
    try {
      if(!this.directory(vault,true))throw new HttpError(409,'Speech cache directory is unavailable.');
      writeFileSync(temporary,audio,{flag:'wx',mode:0o600});
      writeFileSync(checksumTemporary,digest(audio),{flag:'wx',mode:0o600});
      validateAccess();
      renameSync(temporary,filename);renameSync(checksumTemporary,filename+'.sha256');
    } finally {
      if(existsSync(temporary))rmSync(temporary,{force:true});
      if(existsSync(checksumTemporary))rmSync(checksumTemporary,{force:true});
    }
  }
}
