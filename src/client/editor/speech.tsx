import {useEffect,useRef,useState} from 'react';
import {api,createSpeech,ApiError} from '../api';
import {cleanSpeechText} from '../../shared/speech-text';
import {SpeechPlayer,type SpeechState} from './SpeechPlayer';
import {defaultNarrationPreferences,type NarrationPreferences} from '../../shared/narration';
import {resumeRevision,readSpeechResume,writeSpeechResume,clearSpeechResume,type SpeechSection} from './speech-sections';
import {defaultSpeechVoiceFor,defaultSpeechProvider,isSpeechProvider,isSpeechVoice,type SpeechProvider,type SpeechVoice} from '../../shared/intelligence';
export {speechText} from '../../shared/speech-text';

/** Split at sentence/word boundaries, retaining every character and Unicode pair. */
export function speechChunks(text:string,limit=4096):string[] {
  const chunks:string[]=[];let rest=text.trim();
  while(rest.length>limit){
    let end=limit;
    const boundary=Math.max(rest.lastIndexOf('\n',limit-1),rest.lastIndexOf('. ',limit-1),rest.lastIndexOf(' ',limit-1));
    if(boundary>limit/2)end=boundary+1;
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

type Session={token:number;sections:SpeechSection[];parts:Blob[];urls:Map<number,string>;active:number;next:number;busy:boolean;failed:boolean;retryable:boolean;error:string;voice:string;valid:(blockId:string)=>boolean;finish:boolean;download:string;revision:string;bytes:number};
// Keep at most two sections ahead of playback. Generation is unary and ordered;
// an explicit retry resumes at the failed section, retaining completed audio.
const maxSections=256,maxRecordingBytes=128*1024*1024;
export function useSpeech(vaultId:string,pageId?:string) {
  const [enabled,setEnabled]=useState(false);
  const [provider,setProvider]=useState<SpeechProvider>(defaultSpeechProvider);
  const [voice,setVoice]=useState<SpeechVoice>(defaultSpeechVoiceFor(defaultSpeechProvider));
  const [narration,setNarration]=useState<NarrationPreferences>(defaultNarrationPreferences);
  const [state,setState]=useState<SpeechState|null>(null);
  const [currentBlockId,setCurrentBlockId]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null),generation=useRef(0),session=useRef<Session|null>(null);
  function release(){const run=session.current;if(run){for(const value of new Set([...run.urls.values(),run.download].filter(Boolean)))URL.revokeObjectURL(value);}session.current=null;}
  function stop(){generation.current++;controller.current?.abort();controller.current=null;release();setCurrentBlockId(null);setState(null);}
  function current(run:Session){return run.token===generation.current&&session.current===run&&!controller.current?.signal.aborted;}
  function publish(run:Session,error?:string){
    if(!current(run))return;
    if(error!==undefined)run.error=error;
    if(run.parts[run.active]&&!run.valid(run.sections[run.active]!.blockId)){stop();return;}
    let activeUrl=run.urls.get(run.active)??'';
    if(!activeUrl&&run.parts[run.active]){activeUrl=URL.createObjectURL(run.parts[run.active]!);run.urls.set(run.active,activeUrl);}
    setState({loading:run.next<run.sections.length&&!run.failed,url:activeUrl,error:run.error,part:Math.min(run.next+1,run.sections.length),total:run.sections.length,downloadUrl:run.download,section:run.active,generated:run.parts.length,canNext:run.sections.some((section,index)=>index>run.active&&section.blockId!==run.sections[run.active]!.blockId),retryable:run.failed&&run.retryable});

  }
  useEffect(()=>{
    stop();setEnabled(false);
    let active=true,revision=0;
    const refresh=()=>{const request=++revision;void api.intelligence().then(value=>{if(active&&request===revision){const selected=isSpeechProvider(value.ttsProvider)?value.ttsProvider:defaultSpeechProvider;setEnabled(value.ttsEnabled);setProvider(selected);setVoice(isSpeechVoice(value.ttsVoice,selected)?value.ttsVoice:defaultSpeechVoiceFor(selected));setNarration(value.narration??defaultNarrationPreferences);if(!value.ttsEnabled)stop();}}).catch(()=>{if(active&&request===revision){setEnabled(false);stop();}});};
    const changed=()=>{stop();refresh();};
    refresh();window.addEventListener('noema:tts-preferences',changed);
    return()=>{active=false;generation.current++;controller.current?.abort();release();window.removeEventListener('noema:tts-preferences',changed);};
  },[vaultId,pageId]);
  async function pump(run:Session){
    if(!current(run)||run.busy||run.failed)return;
    run.busy=true;
    try{
      while(current(run)&&run.next<run.sections.length&&(run.finish||run.next<=run.active+2)){
        const index=run.next,section=run.sections[index]!;
        if(!run.valid(section.blockId)){stop();return;}
        const lastOfBlock=run.sections[index+1]?.blockId!==section.blockId;
        const pauseKind=section.pauseKind??section.kind;
        const pause=lastOfBlock?(pauseKind==='heading'?narration.pauses.heading:pauseKind==='list'?narration.pauses.listItem:pauseKind==='protected'?0:narration.pauses.paragraph):0;
        const part=await createSpeech(vaultId,section.text,controller.current!.signal,pageId,voice,provider,{expectedNarration:narration,pauseAfterMs:pause,protectedText:section.kind==='protected'});
        if(!current(run))return;
        // Validate each complete file before exposing playback, including partial runs.
        await combineSpeechAudio([part]);
        if(!current(run))return;
        if(run.bytes+part.size>maxRecordingBytes)throw new Error('This recording exceeds 128 MB. Select fewer blocks.');
        run.bytes+=part.size;run.parts.push(part);run.next++;
        publish(run);
      }
      if(current(run)&&run.next===run.sections.length&&!run.download){
        const audio=await combineSpeechAudio(run.parts);
        if(!current(run))return;
        run.download=run.parts.length===1?(run.urls.get(0)??URL.createObjectURL(audio)):URL.createObjectURL(audio);
        publish(run);
      }
    }catch(error){
      if(!current(run))return;
      run.failed=true;run.retryable=!(error instanceof ApiError&&error.status===409);publish(run,error instanceof Error?error.message:'Could not generate this section.');
      if(error instanceof ApiError&&error.status===409){
        const value=await api.intelligence().catch(()=>null);
        if(value&&current(run)){const selected=isSpeechProvider(value.ttsProvider)?value.ttsProvider:defaultSpeechProvider;setProvider(selected);setVoice(isSpeechVoice(value.ttsVoice,selected)?value.ttsVoice:defaultSpeechVoiceFor(selected));setEnabled(value.ttsEnabled);setNarration(value.narration??defaultNarrationPreferences);}
      }
    }finally{run.busy=false;}
  }
  function move(index:number){
    const run=session.current;if(!run||index<0||index>=run.sections.length)return;
    setCurrentBlockId(null);run.active=index;publish(run);void pump(run);
  }
  function advance(){setCurrentBlockId(null);const run=session.current;if(!run)return;if(run.active+1<run.sections.length)move(run.active+1);else if(pageId)clearSpeechResume(vaultId,pageId);}
  function paragraph(direction:number){
    const run=session.current;if(!run)return;
    let index=run.active;
    const block=run.sections[index]?.blockId;
    if(direction>0){while(index<run.sections.length&&run.sections[index]?.blockId===block)index++;}
    else{while(index>0&&run.sections[index-1]?.blockId===block)index--;if(index>0){index--;const previous=run.sections[index]?.blockId;while(index>0&&run.sections[index-1]?.blockId===previous)index--;}}
    move(index);
  }
  function remember(){const run=session.current;if(run)setCurrentBlockId(run.sections[run.active]?.blockId||null);if(run&&pageId&&run.revision)writeSpeechResume(vaultId,pageId,run.revision,run.sections,run.active);}
  function retry(){const run=session.current;if(!run||!run.failed||!run.retryable)return;run.failed=false;run.error='';publish(run);void pump(run);}
  async function speak(text:string,sections?:SpeechSection[],valid:(blockId:string)=>boolean=()=>true){
    if(!enabled)return;stop();
    const limit=provider==='gemini'?1800:4096;
    const planned=sections??cleanSpeechText(text).split(/\n\s*\n/).flatMap((paragraph,index)=>speechChunks(paragraph,limit).map((part,sectionIndex)=>({text:part,blockId:'text-'+index,kind:'paragraph' as const,sectionIndex})));
    // Rebound metadata supplied by the editor to the selected provider limit.
    const chunks=planned.flatMap(section=>speechChunks(section.text,limit).map(text=>({...section,text})));
    if(!chunks.length||chunks.length>maxSections){setState({loading:false,url:'',error:chunks.length?'Select at most 256 speech sections.':'This block has no text to speak.',part:0,total:chunks.length});return;}
    const run:Session={token:generation.current,sections:chunks,parts:[],urls:new Map(),active:0,next:0,busy:false,failed:false,retryable:true,error:'',voice,valid,finish:false,download:'',revision:'',bytes:0};
    session.current=run;controller.current=new AbortController();publish(run);
    run.revision=await resumeRevision(chunks).catch(()=>'');
    if(!current(run))return;
    // Resume playback at a validated boundary while still generating a complete download.
    const resume=pageId&&run.revision?readSpeechResume(vaultId,pageId,run.revision,chunks):null;
    if(resume!==null)run.active=resume;
    void pump(run);
  }
  const player=state&&<SpeechPlayer key={generation.current} state={state} voice={session.current?.voice??voice} onClose={stop} onNext={()=>paragraph(1)} onPrevious={()=>paragraph(-1)} onSectionEnded={advance} beforePlay={()=>{const run=session.current;if(!run||!run.valid(run.sections[run.active]!.blockId)){stop();return false;}return true;}} onSectionPlay={remember} onSectionPause={()=>setCurrentBlockId(null)} onRetry={state.retryable?retry:undefined} onCompleteRequest={()=>{const run=session.current;if(run){run.finish=true;void pump(run);}}} onError={()=>{const run=session.current;if(run){controller.current?.abort();release();setCurrentBlockId(null);setState({...state,loading:false,url:'',downloadUrl:'',error:'Could not play this audio. Select Speak to try again.'});}}}/>;
  return {enabled,speak,player,currentBlockId,activeBlockId:state?.url?session.current?.sections[session.current.active]?.blockId??null:null,stop};
}
