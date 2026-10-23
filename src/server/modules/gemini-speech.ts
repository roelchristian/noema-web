import {geminiSpeechModel,geminiSpeechStyle,isSpeechVoice} from '../../shared/intelligence.js';
import {cleanSpeechText} from '../../shared/speech-text.js';
import {validSpeechWav} from './speech-cache.js';
import {speechMaxAudioBytes} from './realtime-speech.js';
import type {AIUsageObserver} from './ai-debug.js';
import {HttpError} from '../validation.js';

// Official Interactions REST schema, checked 2026-10-23. Never put the key in a URL.
export const geminiSpeechEndpoint='https://generativelanguage.googleapis.com/v1beta/interactions';
const maxResponseBytes=Math.ceil((speechMaxAudioBytes+44)/3)*4+64*1024;
const invalid=()=>new HttpError(502,'Gemini returned incomplete or invalid WAV audio. Try a shorter selection.');
type AudioBlock={type?:unknown;mime_type?:unknown;data?:unknown};
type Interaction={status?:unknown;steps?:{type?:unknown;content?:AudioBlock[]}[];usage?:Record<string,unknown>};

/** Convert a complete provider WAV with ancillary chunks to the app's PCM WAV layout. */
function normalizeWav(wav:Buffer):Buffer {
  if(validSpeechWav(wav))return wav;
  if(wav.length<44||wav.toString('ascii',0,4)!=='RIFF'||wav.readUInt32LE(4)!==wav.length-8||wav.toString('ascii',8,12)!=='WAVE')throw invalid();
  let format:Buffer|undefined,pcm:Buffer|undefined,offset=12;
  while(offset<wav.length){
    if(offset+8>wav.length)throw invalid();
    const type=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4),end=offset+8+size;
    if(end+(size%2)>wav.length)throw invalid();
    if(type==='fmt '){if(format||size!==16)throw invalid();format=wav.subarray(offset, end);}
    if(type==='data'){if(pcm||!size||size%2||size>speechMaxAudioBytes)throw invalid();pcm=wav.subarray(offset+8,end);}
    // Gemini may append C2PA provenance; ancillary chunks are not PCM samples.
    offset=end+(size%2);
  }
  if(!format||!pcm)throw invalid();
  const normalized=Buffer.alloc(44+pcm.length);
  wav.copy(normalized,0,0,12);normalized.writeUInt32LE(normalized.length-8,4);
  format.copy(normalized,12);normalized.write('data',36);normalized.writeUInt32LE(pcm.length,40);pcm.copy(normalized,44);
  if(!validSpeechWav(normalized))throw invalid();
  return normalized;
}

export async function geminiSpeech(text:string,key:string,signal:AbortSignal,transport:typeof fetch,voice:string,observer?:AIUsageObserver):Promise<Buffer> {
  text=cleanSpeechText(text);
  // UTF-8 bytes conservatively bound input tokens, leaving room for style metadata.
  if(!text||text.length>4096||Buffer.byteLength(text,'utf8')>7000)throw new HttpError(400,'Gemini speech requires at most 4,096 characters and 7,000 UTF-8 bytes per section.');
  if(!isSpeechVoice(voice,'gemini'))throw new HttpError(400,'Choose a supported Gemini speech voice.');
  if(signal.aborted)throw new HttpError(409,'Speech request cancelled.');
  try {
    const response=await transport(geminiSpeechEndpoint,{
      method:'POST',redirect:'error',signal,
      headers:{'Content-Type':'application/json','x-goog-api-key':key},
      body:JSON.stringify({model:geminiSpeechModel,store:false,stream:false,
        input:[{type:'user_input',content:[{type:'text',text,annotations:[{type:'speech_metadata',style:geminiSpeechStyle}]}]}],
        response_format:{type:'audio',mime_type:'audio/wav',sample_rate:24000},
        generation_config:{speech_config:[{voice}]},
      }),
    });
    if(!response.ok){
      await response.body?.cancel();
      if(response.status===401||response.status===403)throw new HttpError(409,'Gemini rejected the saved key or model access. Check the Gemini key in Settings → Intelligence.');
      if(response.status===429)throw new HttpError(429,'Gemini speech quota or rate limit reached. Try again later.');
      throw new HttpError(502,'Gemini speech is unavailable. Try again later.');
    }
    if(!response.body)throw invalid();
    if(Number(response.headers.get('content-length'))>maxResponseBytes){await response.body.cancel();throw invalid();}
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,finished=false;
    try {
      while(true){
        if(signal.aborted)throw new HttpError(409,'Speech request cancelled.');
        const {done,value}=await reader.read();if(done){finished=true;break;}
        size+=value.byteLength;if(size>maxResponseBytes)throw invalid();chunks.push(value);
      }
    }finally{if(!finished)await reader.cancel().catch(()=>{});reader.releaseLock();}
    let result:Interaction;
    try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw invalid();}
    // Only normalized numeric counts reach accounting. No provider body, headers,
    // transcript, audio, interaction ID or error text is ever sent to diagnostics.
    const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined;
    const usage=result?.usage;
    if(usage)observer?.usage?.({input_tokens:count(usage.total_input_tokens),output_tokens:count(usage.total_output_tokens),input_tokens_details:{cached_tokens:count(usage.total_cached_tokens)},output_tokens_details:{reasoning_tokens:count(usage.total_thought_tokens)}});
    if(result?.status!=='completed'||!Array.isArray(result.steps))throw invalid();
    const audio=result.steps.filter(step=>step?.type==='model_output').flatMap(step=>Array.isArray(step.content)?step.content:[]).filter(block=>block?.type==='audio');
    // Unary single-speaker output must be one complete recording. Never expose a
    // partial result, append a second RIFF header, or silently accept another codec.
    if(audio.length!==1||audio[0]!.mime_type!=='audio/wav')throw invalid();
    const data=audio[0]!.data;
    if(typeof data!=='string'||data.length>maxResponseBytes||data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw invalid();
    const decoded=Buffer.from(data,'base64');
    if(decoded.toString('base64')!==data)throw invalid();
    const wav=normalizeWav(decoded);
    if(signal.aborted)throw new HttpError(409,'Speech request cancelled.');
    return wav;
  }catch(error){
    if(signal.aborted)throw new HttpError(409,'Speech request stopped or timed out.');
    if(error instanceof HttpError)throw error;
    throw new HttpError(502,'Gemini speech failed. Please try again.');
  }
}
