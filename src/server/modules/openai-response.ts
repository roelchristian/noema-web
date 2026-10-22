import type { AIDebugTrace,AIUsageObserver,AIStreamSummary } from './ai-debug.js';
import {compactRequest,compactResponse,withoutVectors,traceExcerpt as excerpt} from './ai-debug-summary.js';
import { HttpError } from '../validation.js';

export class OpenAIResponseSizeError extends HttpError {
  constructor() {super(502,'OpenAI response exceeded the response size limit. The debug trace contains the partial response.');this.name='OpenAIResponseSizeError';}
}

/** Commentary is a preliminary message, not part of the generated artifact. */
export function responseOutputText(result:{output?:{type:string;phase?:string;content?:{type:string;text?:string}[]}[]}) {
  return (result.output??[]).filter(item=>item.type==='message'&&item.phase!=='commentary').flatMap(item=>item.content??[]).filter(part=>part.type==='output_text'&&typeof part.text==='string').map(part=>part.text!).join('\n');
}

export function redactedTrace(trace: AIDebugTrace | AIUsageObserver | void, key: string): AIDebugTrace | undefined {
  if (!trace || !('request' in trace)) return;
  const full=trace.mode==='full';
  let embeddings=false;
  const text = (value: string) => (key?value.split(key).join('[redacted]'):value).replace(/sk-[A-Za-z0-9_-]{16,}/g,'[redacted]');
  const payload = (value: unknown): unknown => JSON.parse(text(JSON.stringify(withoutVectors(value))??'null'));
  const safe=<T extends unknown[]>(callback:(...args:T)=>void)=>(...args:T)=>{try{callback(...args);}catch{/* Diagnostics must never change provider outcomes. */}};
  const wrapped:AIDebugTrace={
    mode:full?'full':'compact',
    usage:trace.usage,
    stream:trace.stream?summary=>trace.stream!(payload(summary) as AIStreamSummary):undefined,
    request: (endpoint,value) => {embeddings=endpoint.includes('embeddings');trace.request(endpoint,payload(full?value:compactRequest(value)));},
    headers: (status,headers) => trace.headers(status,payload(headers) as Record<string,string>),
    body: value => {if(!embeddings&&full)trace.body(text(value));},
    event: (type,value) => {
      if(full || ['validation','prompt','stream.summary','error','response.failed','response.incomplete'].includes(type)) {
        const p=value&&typeof value==='object'?value as Record<string,any>:{};
        trace.event(text(type),payload(full?value:type==='response.failed'||type==='response.incomplete'||type==='error'?compactResponse(type==='error'?{error:p.error??p}:p.response??p):value));
      }
    },
    response: value => trace.response(payload(full?value:compactResponse(value))),
    error: value => trace.error(text(excerpt(value,4096))),
  };
  return {...wrapped,request:safe(wrapped.request),headers:safe(wrapped.headers),body:safe(wrapped.body),event:safe(wrapped.event),response:safe(wrapped.response),error:safe(wrapped.error),stream:wrapped.stream?safe(wrapped.stream):undefined};
}

/** Read provider payloads while collecting bounded diagnostics independently of generation. */
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
  let raw='',pending='',size=0,textSize=0,complete=false,outputText='',debugTruncated=false;
  const started=Date.now(),full=trace?.mode==='full';
  const summary:AIStreamSummary={eventCount:0,textDeltaCount:0,textBytes:0,transportBytes:0,firstOutputMs:null,completedMs:0,terminalEvent:null,interrupted:false,events:Object.create(null)};
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
    if(trace){
      const elapsed=Date.now()-started,bytes=Buffer.byteLength(data);
      summary.eventCount++;
      // Bound provider-controlled event names while retaining all aggregate counts.
      const bucket=Object.hasOwn(summary.events,type)?type:Object.keys(summary.events).length<64?type:'other';
      const entry=summary.events[bucket]??{count:0,bytes:0,firstMs:elapsed,lastMs:elapsed};
      entry.count++;entry.bytes+=bytes;entry.lastMs=elapsed;summary.events[bucket]=entry;
      if(type==='response.output_text.delta'&&typeof event.delta==='string'){
        summary.textDeltaCount++;summary.textBytes+=Buffer.byteLength(event.delta);
        if(event.delta&&summary.firstOutputMs===null)summary.firstOutputMs=elapsed;
      }
      if(['response.completed','response.failed','response.incomplete','error'].includes(type))summary.terminalEvent=type;
      if(full)trace.event(type,event);
      else if(['response.failed','response.incomplete','error'].includes(type))trace.event(type,event.response??event);
    }
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
    else if(full&&raw.length<debugLimit) {
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
      if (size>limit) { await reader.cancel(); throw new OpenAIResponseSizeError(); }
      consume(decoder.decode(value,{stream:true}));
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
    if(streaming && trace){
      summary.transportBytes=size;summary.completedMs=Date.now()-started;summary.interrupted=!complete;
      if(!complete){summary.outputExcerpt=excerpt(outputText);summary.outputBytes=Buffer.byteLength(outputText);}
      if(trace.stream)trace.stream(summary);else trace.event('stream.summary',summary);
    }
    if(full&&(streaming||!complete))trace?.body(raw);
    reader.releaseLock();
  }
}
