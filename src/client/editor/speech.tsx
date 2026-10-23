import {useEffect,useRef,useState} from 'react';
import {api,createSpeech} from '../api';
import {entityMentionName,type Block,type Entity,type Segment} from '../../shared/domain';

/** Preserve document order and readable entity labels, without reading editor controls. */
export function speechText(blocks:Block[],ids:string[],entities:Entity[]):string {
  const selected=new Set(ids);
  const text=(segments:Segment[])=>segments.map(segment=>segment.entityId?segment.mentionText??entityMentionName(entities.find(entity=>entity.id===segment.entityId))??'':segment.text??'').join('');
  return blocks.filter(block=>selected.has(block.id)&&!['image','divider'].includes(block.type)).map(block=>
    block.type==='table'||block.type==='columns'?(block.rows??[]).map(row=>row.map(text).join('. ')).join('\n'):text(block.content)
  ).filter(value=>value.trim()).join('\n\n').trim();
}
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

export function useSpeech(vaultId:string,pageId?:string) {
  const [enabled,setEnabled]=useState(false);
  const [state,setState]=useState<{loading:boolean;url:string;error:string;part:number;total:number}|null>(null);
  const controller=useRef<AbortController|null>(null),url=useRef(''),queue=useRef<string[]>([]),generation=useRef(0);
  function release(){if(url.current){URL.revokeObjectURL(url.current);url.current='';}}
  function stop(){generation.current++;controller.current?.abort();controller.current=null;queue.current=[];release();setState(null);}
  useEffect(()=>{
    stop();setEnabled(false);
    let active=true,revision=0;
    const refresh=()=>{const current=++revision;void api.intelligence().then(value=>{if(active&&current===revision){setEnabled(value.ttsEnabled);if(!value.ttsEnabled)stop();}}).catch(()=>{if(active&&current===revision){setEnabled(false);stop();}});};
    const changed=()=>{stop();refresh();};
    refresh();window.addEventListener('noema:tts-preferences',changed);
    return()=>{active=false;generation.current++;controller.current?.abort();release();window.removeEventListener('noema:tts-preferences',changed);};
  },[vaultId,pageId]);
  async function load(part:number,total:number,token:number){
    const text=queue.current.shift();if(!text)return;
    release();setState({loading:true,url:'',error:'',part,total});
    const request=new AbortController();controller.current=request;
    try{
      const audio=await createSpeech(vaultId,text,request.signal,pageId);
      if(token!==generation.current)return;
      url.current=URL.createObjectURL(audio);setState({loading:false,url:url.current,error:'',part,total});
    }catch(error){if(token===generation.current&&!request.signal.aborted)setState({loading:false,url:'',error:error instanceof Error?error.message:'Could not generate speech.',part,total});}
  }
  function speak(text:string){
    if(!enabled)return;stop();const chunks=speechChunks(text);
    if(!chunks.length){setState({loading:false,url:'',error:'This block has no text to speak.',part:0,total:0});return;}
    queue.current=chunks;void load(1,chunks.length,generation.current);
  }
  const player=state&&<aside className="editor-speech" aria-label="Speak selected blocks">
    <div role="status">{state.error|| (state.loading?'Generating speech…':'AI-generated voice')}{state.total>1&&` · ${state.part} / ${state.total}`}</div>
    {state.url&&<audio key={state.url} controls autoPlay src={state.url} aria-label="AI-generated speech" onEnded={()=>{if(queue.current.length)void load(state.part+1,state.total,generation.current);}} onError={()=>{release();setState({...state,url:'',error:'Could not play this audio. Select Speak to try again.'});}}/>}
    <button type="button" className="button" onClick={stop}>{state.error?'Dismiss':'Stop'}</button>
  </aside>;
  return {enabled,speak,player};
}
