import {statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {cleanSpeechText} from '../../shared/speech-text.js';
import {HttpError} from '../validation.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const voices={puck:'am_puck',echo:'am_echo',lewis:'bm_lewis',daniel:'bm_daniel'} as const;
const requiredFiles:Record<string,number>={'config.json':44,'tokenizer.json':3497,'tokenizer_config.json':113,'onnx/model_quantized.onnx':92361116,...Object.fromEntries(Object.values(voices).map(voice=>[`voices/${voice}.bin`,522240]))};
const modelDirectory=()=>resolve(process.env.NOEMA_KOKORO_MODEL_DIR||resolve(root,'data/models/kokoro'));
export function kokoroStatus() {
  const directory=modelDirectory();
  const missingFiles=Object.entries(requiredFiles).filter(([file,size])=>{try{const info=statSync(resolve(directory,file));return !info.isFile()||info.size!==size;}catch{return true;}}).map(([file])=>file);
  return {ready:missingFiles.length===0,model:'kokoro-82m-v1.0',missingFiles,downloadCommand:'npm run tts:download'};
}
let downloading:Promise<ReturnType<typeof kokoroStatus>>|undefined;
export function downloadKokoro():Promise<ReturnType<typeof kokoroStatus>> {
  if(downloading)return downloading;
  downloading=new Promise<void>((resolveDownload,reject)=>{
    const child=spawn(process.execPath,[resolve(root,'scripts/download-kokoro.mjs')],{cwd:root,env:{...process.env,NOEMA_KOKORO_MODEL_DIR:modelDirectory()},stdio:['ignore','ignore','pipe']});
    let detail='';child.stderr.on('data',chunk=>{detail=(detail+String(chunk)).slice(-2000);});
    child.once('error',()=>reject(new HttpError(502,'Could not start the Kokoro model download. Run npm run tts:download.')));
    child.once('exit',code=>code===0?resolveDownload():reject(new HttpError(502,`Kokoro model download failed. Run npm run tts:download and check your connection. ${detail.trim()}`)));
  }).then(()=>kokoroStatus()).finally(()=>{downloading=undefined;});
  return downloading;
}

// Native ONNX inference runs off the HTTP event loop. Terminating the worker also
// stops a cancelled inference; later requests start a clean runtime.
const workerSource=String.raw`
const {parentPort,workerData}=require('node:worker_threads');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
let loading;
async function runtime(){
  if(!loading)loading=(async()=>{
    const {env,Tensor,RawAudio}=await import(workerData.transformers);
    env.allowRemoteModels=false;env.allowLocalModels=true;env.useFSCache=false;
    // Fail closed if a dependency ever attempts a synthesis-time network fetch.
    globalThis.fetch=async()=>{throw new Error('Network access is disabled during local speech synthesis.');};
    const {KokoroTTS}=await import(workerData.kokoro);
    const tts=await KokoroTTS.from_pretrained(workerData.directory,{dtype:'q8',device:'cpu'});
    tts.generate_from_ids=async(input_ids,{voice,speed=1})=>{
      const bytes=readFileSync(resolve(workerData.directory,'voices',voice+'.bin'));
      const data=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      const offset=Math.min(Math.max(input_ids.dims.at(-1)-2,0),509)*256;
      const {waveform}=await tts.model({input_ids,style:new Tensor('float32',data.slice(offset,offset+256),[1,256]),speed:new Tensor('float32',[speed],[1])});
      return new RawAudio(waveform.data,24000);
    };
    return tts;
  })();
  return loading;
}
parentPort.on('message',async({text,voice})=>{
  try {
    const tts=await runtime(),chunks=[];let length=0;
    // Short word-preserving pieces keep the model below its 512-token context.
    const pieces=text.match(/.{1,180}(?:\s+|$)|\S+/gu)||[];
    for(const piece of pieces){
      if(piece.length>200)throw new Error('Speech contains a word longer than the local model supports.');
      const audio=await tts.generate(piece.trim(),{voice});
      if(audio.sampling_rate!==24000)throw new Error('Unexpected audio sample rate.');
      const pcm=Buffer.alloc(audio.audio.length*2);
      for(let i=0;i<audio.audio.length;i++){const value=Math.max(-1,Math.min(1,audio.audio[i]));pcm.writeInt16LE(Math.round(value*(value<0?32768:32767)),i*2);}
      length+=pcm.length;if(length>24*1024*1024)throw new Error('Local speech exceeded the audio limit.');chunks.push(pcm);
    }
    if(!length)throw new Error('Local speech returned empty audio.');
    const header=Buffer.alloc(44);
    header.write('RIFF');header.writeUInt32LE(36+length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(length,40);
    parentPort.postMessage({audio:Buffer.concat([header,...chunks])});
  }catch(error){parentPort.postMessage({error:error.message});}
});
`;
let worker:Worker|undefined,workerDirectory:string|undefined;
let queue=Promise.resolve(),pending=0;
export async function kokoroSpeech(text:string,signal:AbortSignal,voice:string):Promise<Buffer> {
  if(!Object.hasOwn(voices,voice))throw new HttpError(400,'Choose a supported Kokoro speech voice.');
  text=cleanSpeechText(text);
  if(!text||text.length>4096)throw new HttpError(400,'Speech requires text of at most 4,096 characters.');
  if(signal.aborted)throw new HttpError(409,'Speech request stopped or timed out.');
  if(!kokoroStatus().ready)throw new HttpError(409,'Download the Kokoro 82M model to use local speech. Run npm run tts:download.');
  if(pending>=8)throw new HttpError(429,'Local speech is busy. Please try again shortly.');
  pending++;
  const previous=queue;let release!:()=>void;queue=new Promise<void>(resolveQueue=>{release=resolveQueue;});
  try {
    await previous;
    if(signal.aborted)throw new HttpError(409,'Speech request stopped or timed out.');
    const directory=modelDirectory();
    if(worker&&workerDirectory!==directory){await worker.terminate();worker=undefined;}
    if(!worker){worker=new Worker(workerSource,{eval:true,execArgv:[],workerData:{directory,transformers:import.meta.resolve('@huggingface/transformers'),kokoro:import.meta.resolve('kokoro-js')}});workerDirectory=directory;worker.unref();}
    const current=worker;current.ref();
    return await new Promise<Buffer>((resolveAudio,reject)=>{
      let settled=false;
      const finish=(error?:HttpError,audio?:Uint8Array)=>{
        if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
        current.off('message',message);current.off('error',failure);current.off('exit',exited);
        if(error){worker=undefined;void current.terminate();reject(error);}else{current.unref();resolveAudio(Buffer.from(audio!));}
      };
      const abort=()=>finish(new HttpError(409,'Speech request stopped or timed out.'));
      const failure=()=>finish(new HttpError(502,'Local speech could not run. Re-download the Kokoro model and check the server runtime.'));
      const exited=()=>failure();
      const message=(value:{audio?:Uint8Array;error?:string})=>value.error||!value.audio?failure():finish(undefined,value.audio);
      const timer=setTimeout(()=>finish(new HttpError(504,'Local speech generation timed out. Try a shorter passage.')),180000);
      current.on('message',message);current.on('error',failure);current.on('exit',exited);signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();else current.postMessage({text,voice:voices[voice as keyof typeof voices]});
    });
  }finally{pending--;release();}
}
