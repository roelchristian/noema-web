import {useEffect,useRef,useState} from 'react';
import {api,createSpeech,ApiError} from '../api';
import {cleanSpeechText} from '../../shared/speech-text';
import {SpeechPlayer} from './SpeechPlayer';
import {defaultSpeechVoiceFor,defaultSpeechProvider,isSpeechProvider,isSpeechVoice,type SpeechProvider,type SpeechVoice} from '../../shared/intelligence';
export {speechText} from '../../shared/speech-text';

/** Split at sentence/word boundaries, retaining every character and Unicode pair. */
export function speechChunks(text:string):string[] {
  const chunks:string[]=[];let rest=text.trim();
  while(rest.length>4096){
    let end=4096;
    const boundary=Math.max(rest.lastIndexOf('\n',4095),rest.lastIndexOf('. ',4095),rest.lastIndexOf(' ',4095));
    if(boundary>2048)end=boundary+1;
    if(/[\uD800-\uDBFF]/.test(rest[end-1]!))end--;
    chunks.push(rest.slice(0,end));rest=rest.slice(end);
  }
  if(rest)chunks.push(rest);return chunks;
}

/** Join the canonical PCM24k WAV files returned by the speech endpoint. */
export async function combineSpeechAudio(parts:Blob[]):Promise<Blob> {
  if(!parts.length)throw new Error('No speech audio was generated.');
  const data:Uint8Array<ArrayBuffer>[]=[],invalid=()=>new Error('The speech provider returned invalid speech audio. Please try again.');
  let bytes=0,header:Uint8Array<ArrayBuffer>|undefined;
  for(const part of parts){
    if(part.type!=='audio/wav')throw invalid();
    const buffer=await part.arrayBuffer(),view=new DataView(buffer),ascii=(offset:number,length:number)=>String.fromCharCode(...new Uint8Array(buffer,offset,length));
    if(buffer.byteLength<=44||ascii(0,4)!=='RIFF'||ascii(8,4)!=='WAVE'||ascii(12,4)!=='fmt '||ascii(36,4)!=='data'||view.getUint32(4,true)!==buffer.byteLength-8||view.getUint32(16,true)!==16||view.getUint16(20,true)!==1||view.getUint16(22,true)!==1||view.getUint32(24,true)!==24000||view.getUint32(28,true)!==48000||view.getUint16(32,true)!==2||view.getUint16(34,true)!==16||view.getUint32(40,true)!==buffer.byteLength-44||(buffer.byteLength-44)%2!==0)throw invalid();
    header??=new Uint8Array(buffer.slice(0,44));data.push(new Uint8Array(buffer,44));bytes+=buffer.byteLength-44;
    if(bytes>0xffffffff-36)throw new Error('Selected speech audio is too large to download. Select fewer blocks.');
  }
  if(parts.length===1)return parts[0]!;
  const view=new DataView(header!.buffer);view.setUint32(4,36+bytes,true);view.setUint32(40,bytes,true);
  return new Blob([header!,...data],{type:'audio/wav'});
}

export function useSpeech(vaultId:string,pageId?:string) {
  const [enabled,setEnabled]=useState(false);
  const [provider,setProvider]=useState<SpeechProvider>(defaultSpeechProvider);
  const [voice,setVoice]=useState<SpeechVoice>(defaultSpeechVoiceFor(defaultSpeechProvider));
  const [state,setState]=useState<{loading:boolean;url:string;error:string;part:number;total:number;assembling?:boolean}|null>(null);
  const controller=useRef<AbortController|null>(null),url=useRef(''),generation=useRef(0);
  function release(){if(url.current){URL.revokeObjectURL(url.current);url.current='';}}
  function stop(){generation.current++;controller.current?.abort();controller.current=null;release();setState(null);}
  useEffect(()=>{
    stop();setEnabled(false);
    let active=true,revision=0;
    const refresh=()=>{const current=++revision;void api.intelligence().then(value=>{if(active&&current===revision){const selected=isSpeechProvider(value.ttsProvider)?value.ttsProvider:defaultSpeechProvider;setEnabled(value.ttsEnabled);setProvider(selected);setVoice(isSpeechVoice(value.ttsVoice,selected)?value.ttsVoice:defaultSpeechVoiceFor(selected));if(!value.ttsEnabled)stop();}}).catch(()=>{if(active&&current===revision){setEnabled(false);stop();}});};
    const changed=()=>{stop();refresh();};
    refresh();window.addEventListener('noema:tts-preferences',changed);
    return()=>{active=false;generation.current++;controller.current?.abort();release();window.removeEventListener('noema:tts-preferences',changed);};
  },[vaultId,pageId]);
  async function load(chunks:string[],token:number){
    const request=new AbortController();controller.current=request;
    let part=1;
    try{
      const parts:Blob[]=[];
      for(const text of chunks){
        if(token!==generation.current||request.signal.aborted)return;
        setState({loading:true,url:'',error:'',part,total:chunks.length});
        parts.push(await createSpeech(vaultId,text,request.signal,pageId,voice,provider));
        if(token!==generation.current||request.signal.aborted)return;
        part++;
      }
      setState({loading:true,url:'',error:'',part:chunks.length,total:chunks.length,assembling:true});
      const audio=await combineSpeechAudio(parts);
      if(token!==generation.current)return;
      url.current=URL.createObjectURL(audio);setState({loading:false,url:url.current,error:'',part:chunks.length,total:chunks.length});
    }catch(error){
      if(token!==generation.current||request.signal.aborted)return;
      setState({loading:false,url:'',error:error instanceof Error?error.message:'Could not generate speech.',part:Math.min(part,chunks.length),total:chunks.length});
      // Settings may have changed in another tab. Refresh for the next explicit Speak without retrying generation.
      if(error instanceof ApiError&&error.status===409){
        const current=await api.intelligence().catch(()=>null);
        if(current&&token===generation.current){const selected=isSpeechProvider(current.ttsProvider)?current.ttsProvider:defaultSpeechProvider;setProvider(selected);setVoice(isSpeechVoice(current.ttsVoice,selected)?current.ttsVoice:defaultSpeechVoiceFor(selected));setEnabled(current.ttsEnabled);}
      }
    }
  }
  function speak(text:string){
    if(!enabled)return;stop();const chunks=speechChunks(cleanSpeechText(text));
    if(!chunks.length){setState({loading:false,url:'',error:'This block has no text to speak.',part:0,total:0});return;}
    void load(chunks,generation.current);
  }
  const player=state&&<SpeechPlayer key={generation.current} state={state} voice={voice} onClose={stop} onError={()=>{release();setState({...state,loading:false,url:'',error:'Could not play this audio. Select Speak to try again.'});}}/>;
  return {enabled,speak,player};
}
