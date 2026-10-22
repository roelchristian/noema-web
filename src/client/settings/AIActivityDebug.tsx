import {t as uiText} from '../i18n';
import {DisclosureSummary} from '../components/DisclosureSummary';
import { useEffect, useRef, useState } from 'react';
import type { AIActivityDebug as DebugPayload } from '../../shared/intelligence';
import { Modal, ModalHeader } from '../components/Modal';
import { api } from '../api';

function pretty(value:string|null) {
  if(value===null)return uiText('Not received yet.');
  try{return JSON.stringify(JSON.parse(value),null,2);}catch{return value;}
}
function parse(value:string|null):Record<string,unknown> {
  try {const parsed=value?JSON.parse(value):null;return parsed&&typeof parsed==='object'?parsed:{};}catch{return {};}
}
function bytes(value:number) {return value<1024?`${value} B`:`${(value/1024).toFixed(1)} KiB`;}
const maxExportBytes=4*1024*1024,maxViewerEvents=1000;

export function AIActivityDebug({id,onClose}:{id:string;onClose:()=>void}) {
  const [data,setData]=useState<DebugPayload|null>(null),[error,setError]=useState('');
  const [events,setEvents]=useState<DebugPayload['events']>([]),[eventCursor,setEventCursor]=useState<number|undefined>(),[hasMore,setHasMore]=useState(true),[eventsLoaded,setEventsLoaded]=useState(false),[eventsBusy,setEventsBusy]=useState(false),[downloading,setDownloading]=useState(false);
  const controller=useRef<AbortController|null>(null),loadingEvents=useRef(false);
  useEffect(()=>{
    let active=true,timer:ReturnType<typeof setTimeout>,revision:number|undefined;
    const abort=new AbortController();controller.current=abort;
    setData(null);setEvents([]);setEventsLoaded(false);setHasMore(true);setEventCursor(undefined);setError('');
    async function refresh() {
      let running=true;
      try {
        const result=await api.aiActivityDebug(id,abort.signal,{events:false,after:revision});
        running=result.status==='running';
        if(active){setData(previous=>result.unchanged&&previous?{...previous,status:result.status,revision:result.revision,updatedAt:result.updatedAt}:result);setError('');revision=result.revision;}
      } catch(error){if(active)setError(error instanceof Error?error.message:'Could not load debug payload.');}
      finally{if(active&&running)timer=setTimeout(()=>void refresh(),2000);}
    }
    void refresh();
    return()=>{active=false;clearTimeout(timer);abort.abort();};
  },[id]);
  async function loadEvents() {
    if(loadingEvents.current||events.length>=maxViewerEvents)return;
    loadingEvents.current=true;setEventsBusy(true);
    try {
      const page=await api.aiActivityDebug(id,controller.current?.signal,{events:true,eventCursor,limit:100});
      if(controller.current?.signal.aborted)return;
      setEvents(previous=>[...previous,...page.events.filter(event=>!previous.some(item=>item.sequence===event.sequence))].slice(0,maxViewerEvents));
      setEventCursor(page.nextEventCursor??page.events.at(-1)?.sequence);setHasMore(!!page.hasMoreEvents);setEventsLoaded(true);
    }catch(error){if(!controller.current?.signal.aborted)setError(error instanceof Error?error.message:'Could not load events.');}
    finally{loadingEvents.current=false;if(!controller.current?.signal.aborted)setEventsBusy(false);}
  }
  async function download() {
    if(!data||downloading)return;
    setDownloading(true);setError('');
    try {
      const savedEvents:DebugPayload['events']=[];
      let size=new Blob([JSON.stringify(data)]).size,cursor:number|undefined;
      if(size>maxExportBytes)throw new Error('This legacy trace exceeds the 4 MiB download limit.');
      for(let pageNumber=0;;pageNumber++) {
        const page=await api.aiActivityDebug(id,controller.current?.signal,{events:true,eventCursor:cursor,limit:100});
        if(controller.current?.signal.aborted)return;
        size+=new Blob([JSON.stringify(page.events)]).size;
        if(size>maxExportBytes||pageNumber>=100)throw new Error('This trace exceeds the bounded download limit. Download was stopped.');
        savedEvents.push(...page.events);
        if(!page.hasMoreEvents)break;
        const next=page.nextEventCursor??page.events.at(-1)?.sequence;
        if(next===undefined||next===cursor)throw new Error('Could not advance through saved events.');
        cursor=next;
      }
      const url=URL.createObjectURL(new Blob([JSON.stringify({...data,events:savedEvents,exportedWhileRunning:data.status==='running'})],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`noema-ai-debug-${id}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){if(!controller.current?.signal.aborted)setError(error instanceof Error?error.message:'Could not download trace.');}
    finally{if(!controller.current?.signal.aborted)setDownloading(false);}
  }
  const request=parse(data?.request??null),response=parse(data?.response??null),stream=response.stream&&typeof response.stream==='object'?response.stream as Record<string,unknown>:{};
  const outputExcerpt=response.outputExcerpt??response.excerpt;
  const vectors=Array.isArray(response.vectors)?response.vectors.filter((value):value is Record<string,unknown>=>!!value&&typeof value==='object'):[];
  const vectorsValid=typeof response.vectorsValid==='boolean'?response.vectorsValid:vectors.length?vectors.every(vector=>vector.valid===true):undefined;
  return <Modal className="ai-debug-modal" titleId="ai-debug-title" onClose={onClose}>
    <ModalHeader titleId="ai-debug-title">{uiText("AI activity diagnostics")}</ModalHeader>
    {error&&<p role="alert">{error}</p>}
    {!data&&!error&&<p role="status">{uiText("Loading diagnostics…")}</p>}
    {data&&<>
      <p className="ai-debug-status" role="status">{data.status} · {uiText(data.mode==='compact'?'Compact trace':data.mode==='full'?'Full trace':'Legacy trace')}{data.status==='running'?' · '+uiText('Live progress'):''}</p>
      <dl className="ai-debug-overview">
        <div><dt>{uiText("Duration")}</dt><dd>{typeof data.durationMs==='number'?`${(data.durationMs/1000).toFixed(2)}s`:typeof response.elapsedMs==='number'?`${(response.elapsedMs/1000).toFixed(2)}s`:'—'}</dd></div>
        <div><dt>{uiText("HTTP")}</dt><dd>{data.responseStatus??'—'}</dd></div>
        <div><dt>{uiText("Stream events")}</dt><dd>{typeof stream.eventCount==='number'?stream.eventCount:data.eventCount??'—'}</dd></div>
        <div><dt>{uiText("Retained")}</dt><dd>{data.retainedBytes===undefined?'—':bytes(data.retainedBytes)}</dd></div>
      </dl>
      <p className="ai-debug-endpoint">{data.endpoint??uiText("Request not sent yet.")}</p>
      {data.truncated&&<p className="display-hint">{uiText("Capture limit reached. Some diagnostic content was omitted.")}</p>}
      {data.error&&<p role="alert">{data.error}</p>}
      {data.mode==='compact'&&<dl className="ai-debug-facts">
        <dt>{uiText("Input")}</dt><dd>{typeof request.inputBytes==='number'?bytes(request.inputBytes):'—'} · {uiText("body omitted")}</dd>
        <dt>{uiText("Output")}</dt><dd>{typeof response.outputBytes==='number'?bytes(response.outputBytes):'—'}{typeof outputExcerpt==='string'&&outputExcerpt?' · '+uiText("excerpt available"):''}</dd>
        <dt>{uiText("Provider")}</dt><dd>{typeof response.status==='string'?response.status:data.status}</dd>
        {typeof vectorsValid==='boolean'&&<><dt>{uiText("Embedding validation")}</dt><dd>{uiText(vectorsValid?'Passed':'Failed')} · {String(response.vectorCount??0)} {uiText("vectors")} · {String(response.dimensions??vectors[0]?.dimensions??0)} {uiText("dimensions")}</dd></>}
      </dl>}
      {Object.keys(stream).length>0&&<ol className="ai-debug-timeline">
        <li>{uiText("Request started")} <span>0 ms</span></li>
        {typeof stream.firstOutputMs==='number'&&<li>{uiText("First output received")} <span>{stream.firstOutputMs.toLocaleString()} ms</span></li>}
        {typeof stream.completedMs==='number'&&<li>{typeof stream.terminalEvent==='string'?stream.terminalEvent:uiText(stream.interrupted?'Stream interrupted':'Stream ended')} <span>{stream.completedMs.toLocaleString()} ms</span></li>}
      </ol>}
      {typeof outputExcerpt==='string'&&outputExcerpt&&<details><DisclosureSummary>{uiText("Output excerpt")}</DisclosureSummary><pre>{outputExcerpt}</pre></details>}
      {Object.keys(stream).length>0&&<details><DisclosureSummary>{uiText("Execution timeline and stream summary")}</DisclosureSummary><pre>{JSON.stringify(stream,null,2)}</pre></details>}
      <details><DisclosureSummary>{uiText(data.mode==='compact'?"Request summary":"Request body")}</DisclosureSummary><pre>{pretty(data.request)}</pre></details>
      <details><DisclosureSummary>{uiText(data.mode==='compact'?"Response summary and output excerpt":"Provider response")}</DisclosureSummary><pre>{data.response?pretty(data.response):uiText("Waiting for response…")}</pre></details>
      {data.mode!=='compact'&&<details><DisclosureSummary>{uiText("Raw response body")}</DisclosureSummary><pre>{data.responseBody||uiText("No raw body retained.")}</pre></details>}
      <details><DisclosureSummary>{uiText("Response metadata")}</DisclosureSummary><pre>{pretty(data.responseHeaders)}</pre></details>
      <details onToggle={event=>{if(event.currentTarget.open&&!eventsLoaded)void loadEvents();}}><DisclosureSummary>{uiText(data.mode==='compact'?"Diagnostic events":"Saved stream events")}{eventsLoaded?` (${events.length})`:''}</DisclosureSummary>
        <ol className="ai-debug-events">{events.map(event=><li key={event.sequence}><details><DisclosureSummary><time dateTime={event.receivedAt}>{new Date(event.receivedAt).toLocaleTimeString()}</time> · {event.type}</DisclosureSummary><pre>{pretty(event.data)}</pre></details></li>)}</ol>
        {eventsBusy&&<p role="status">{uiText("Loading events…")}</p>}
        {eventsLoaded&&!events.length&&<p>{uiText("No saved events.")}</p>}
        {eventsLoaded&&events.length<maxViewerEvents&&<button className="button" disabled={eventsBusy} onClick={()=>void loadEvents()}>{uiText(hasMore?"Load more events":"Refresh events")}</button>}
        {events.length>=maxViewerEvents&&hasMore&&<p>{uiText("Showing the first 1,000 events. Download JSON to inspect the bounded trace.")}</p>}
      </details>
    </>}
    <div className="dialog-actions"><button className="button" disabled={!data||downloading} onClick={()=>void download()}>{uiText(downloading?"Preparing download…":"Download JSON")}</button><button className="button primary" onClick={onClose}>{uiText("Back to activity")}</button></div>
  </Modal>;
}
