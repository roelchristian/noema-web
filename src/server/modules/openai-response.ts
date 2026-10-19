import type { AIDebugTrace,AIUsageObserver } from './ai-debug.js';
import { HttpError } from '../validation.js';

/** Commentary is a preliminary message, not part of the generated artifact. */
export function responseOutputText(result:{output?:{type:string;phase?:string;content?:{type:string;text?:string}[]}[]}) {
  return (result.output??[]).filter(item=>item.type==='message'&&item.phase!=='commentary').flatMap(item=>item.content??[]).filter(part=>part.type==='output_text'&&typeof part.text==='string').map(part=>part.text!).join('\n');
}

export function redactedTrace(trace: AIDebugTrace | AIUsageObserver | void, key: string): AIDebugTrace | undefined {
  if (!trace || !('request' in trace)) return;
  const text = (value: string) => value.split(key).join('[redacted]').replace(/sk-[A-Za-z0-9_-]{16,}/g,'[redacted]');
  const payload = (value: unknown): unknown => JSON.parse(text(JSON.stringify(value)));
  return {
    request: (endpoint,value) => trace.request(endpoint,payload(value)),
    headers: (status,headers) => trace.headers(status,payload(headers) as Record<string,string>),
    body: value => trace.body(text(value)),
    event: (type,value) => trace.event(text(type),payload(value)),
    response: value => trace.response(payload(value)),
    error: value => trace.error(text(value)),
  };
}

/** Read JSON or SSE, retaining the provider's final response and every stream event. */
export async function readOpenAIResponse(response: Response, trace?: AIDebugTrace, onTextDelta?:(delta:string)=>void, preview?:{onDelta:(delta:string)=>void;onReset:()=>void}, onUsage?:(usage:unknown)=>void, options?:{maxJsonBytes:number}) {
  const headers: Record<string,string> = {};
  for (const name of ['content-type','x-request-id','openai-processing-ms','retry-after']) {
    const value=response.headers.get(name); if (value !== null) headers[name]=value;
  }
  trace?.headers(response.status,headers);
  const reader=response.body?.getReader();
  if (!reader) throw new HttpError(502,'OpenAI returned an empty response.');
  const streaming=response.headers.get('content-type')?.includes('text/event-stream');
  // SSE envelopes, obfuscation, and final snapshots repeat generated text many times.
  // Bound transport, individual frames, generated text, and debug retention separately.
  const limit=streaming?32*1024*1024:options?.maxJsonBytes??128000,frameLimit=2*1024*1024,textLimit=1024*1024,debugLimit=2*1024*1024;
  let raw='',pending='',size=0,textSize=0,lastUpdate=0,complete=false,outputText='',debugTruncated=false;
  const phases=new Map<string,string>();
  let previewItem:string|undefined,previewVisible=false;
  let lastTextPart:string|undefined;
  let result: ReturnType<typeof JSON.parse>;
  const decoder=new TextDecoder();
  function frame(value: string) {
    if(Buffer.byteLength(value,'utf8')>frameLimit)throw new HttpError(502,'OpenAI returned an oversized stream event.');
    const lines=value.split(/\r?\n/);
    const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
    if (!data || data==='[DONE]') return;
    const event=JSON.parse(data);
    const type=typeof event.type==='string'?event.type:lines.find(line=>line.startsWith('event:'))?.slice(6).trim()||'message';
    trace?.event(type,event);
    if(type==='response.output_item.added'&&event.item?.type==='message')phases.set(event.item.id,event.item.phase??'');
    if(type==='response.output_text.delta'&&typeof event.delta==='string'){
      textSize+=Buffer.byteLength(event.delta,'utf8');
      if(textSize>textLimit)throw new HttpError(502,'OpenAI generated text exceeded the response size limit.');
      if(phases.get(event.item_id)==='commentary') {
        if(preview&&event.delta) {
          if(previewItem!==undefined&&previewItem!==event.item_id)preview.onReset();
          previewItem=event.item_id;previewVisible=true;preview.onDelta(event.delta);
        }
        return;
      }
      // Preliminary text is display-only. Start the authoritative artifact from scratch.
      if(previewVisible){preview!.onReset();previewVisible=false;}
      const part=JSON.stringify([event.item_id,event.output_index,event.content_index]);
      const delta=(lastTextPart!==undefined&&lastTextPart!==part?'\n':'')+event.delta;
      lastTextPart=part;outputText+=delta;onTextDelta?.(delta);
    }
    if (['response.completed','response.failed','response.incomplete'].includes(type) && event.response) {
      result=event.response;
      onUsage?.(result.usage);
      trace?.response(result);
    }
  }
  function consume(text: string) {
    if(!streaming)raw+=text;
    else if(trace&&raw.length<debugLimit) {
      raw+=text.slice(0,debugLimit-raw.length);
      if(raw.length===debugLimit&&!debugTruncated){raw+='\n[Debug body truncated; individual stream events are recorded separately.]';debugTruncated=true;}
    }
    if (!streaming) return;
    pending+=text;
    let boundary: RegExpExecArray | null;
    while ((boundary=/\r?\n\r?\n/.exec(pending))) {
      frame(pending.slice(0,boundary.index));
      pending=pending.slice(boundary.index+boundary[0].length);
    }
    if(Buffer.byteLength(pending,'utf8')>frameLimit)throw new HttpError(502,'OpenAI returned an oversized stream event.');
  }
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.length;
      if (size>limit) { await reader.cancel(); throw new HttpError(502,'OpenAI response exceeded the response size limit. The debug trace contains the partial response.'); }
      consume(decoder.decode(value,{stream:true}));
      if (trace && Date.now()-lastUpdate>=1000) { trace.body(raw); lastUpdate=Date.now(); }
    }
    consume(decoder.decode());
    if (streaming) {
      if (pending.trim()) frame(pending);
      if (!result) throw new HttpError(502,'OpenAI stream ended before a final response was received.');
    } else {
      result=JSON.parse(raw);
      onUsage?.(result.usage);
      trace?.response(result);
    }
    if(onTextDelta){
      const finalText=responseOutputText(result);
      if(Buffer.byteLength(finalText,'utf8')>textLimit)throw new HttpError(502,'OpenAI generated text exceeded the response size limit.');
      if(previewVisible){preview!.onReset();previewVisible=false;}
      if(!outputText)onTextDelta(finalText);
      else if(finalText.startsWith(outputText))onTextDelta(finalText.slice(outputText.length));
      else if(finalText.trim()!==outputText.trim())throw new HttpError(502,'The final AI response did not match its streamed blocks. Please retry.');
    }
    complete=true;
    return result;
  } finally {
    if(!complete)await reader.cancel().catch(()=>{});
    trace?.body(raw);
    reader.releaseLock();
  }
}
