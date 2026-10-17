import type { AIDebugTrace } from './ai-debug.js';
import { HttpError } from '../validation.js';

export function redactedTrace(trace: AIDebugTrace | void, key: string): AIDebugTrace | undefined {
  if (!trace) return;
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
export async function readOpenAIResponse(response: Response, trace?: AIDebugTrace) {
  const headers: Record<string,string> = {};
  for (const name of ['content-type','x-request-id','openai-processing-ms','retry-after']) {
    const value=response.headers.get(name); if (value !== null) headers[name]=value;
  }
  trace?.headers(response.status,headers);
  const reader=response.body?.getReader();
  if (!reader) throw new HttpError(502,'OpenAI returned an empty response.');
  const streaming=response.headers.get('content-type')?.includes('text/event-stream');
  const limit=streaming?2*1024*1024:128000;
  let raw='',pending='',size=0,lastUpdate=0;
  let result: ReturnType<typeof JSON.parse>;
  const decoder=new TextDecoder();
  function frame(value: string) {
    const lines=value.split(/\r?\n/);
    const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
    if (!data || data==='[DONE]') return;
    const event=JSON.parse(data);
    const type=typeof event.type==='string'?event.type:lines.find(line=>line.startsWith('event:'))?.slice(6).trim()||'message';
    trace?.event(type,event);
    if (['response.completed','response.failed','response.incomplete'].includes(type) && event.response) {
      result=event.response;
      trace?.response(result);
    }
  }
  function consume(text: string) {
    raw+=text;
    if (!streaming) return;
    pending+=text;
    let boundary: RegExpExecArray | null;
    while ((boundary=/\r?\n\r?\n/.exec(pending))) {
      frame(pending.slice(0,boundary.index));
      pending=pending.slice(boundary.index+boundary[0].length);
    }
  }
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.length;
      if (size>limit) { await reader.cancel(); throw new HttpError(502,'OpenAI response exceeded the response size limit. The debug trace contains the partial response.'); }
      consume(decoder.decode(value,{stream:true}));
      if (trace && Date.now()-lastUpdate>=100) { trace.body(raw); lastUpdate=Date.now(); }
    }
    consume(decoder.decode());
    if (streaming) {
      if (pending.trim()) frame(pending);
      if (!result) throw new HttpError(502,'OpenAI stream ended before a final response was received.');
    } else {
      result=JSON.parse(raw);
      trace?.response(result);
    }
    return result;
  } finally {
    trace?.body(raw);
    reader.releaseLock();
  }
}
