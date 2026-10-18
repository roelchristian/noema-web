import {useEffect,useRef,useState} from 'react';
import type {SourceFile} from '../../shared/domain';
import {sourceDuration} from '../../shared/source-progress';

export function SourceLoadingProgress({file}:{file:SourceFile}) {
 const active=file.status==='queued'||file.status==='processing'||file.status==='ready'&&['pending','running'].includes(file.enrichment_status);
 const detail=file.processing_detail;
 const phase=detail?'math':file.status==='ready'?'enrichment':file.status;
 const [clock,setClock]=useState(Date.now());
 const sample=useRef({key:'',time:Date.now(),percent:file.progress});
 const key=file.id+':'+phase;
 if(sample.current.key!==key||file.progress<sample.current.percent)sample.current={key,time:Date.now(),percent:file.progress};
 useEffect(()=>{if(!active)return;setClock(Date.now());const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[active,key]);
 if(!active)return null;
 const elapsed=Math.max(0,Math.floor((clock-(detail?.startedAt??sample.current.time))/1000));
 const gained=file.progress-sample.current.percent;
 const estimate=detail?.estimatedRemainingSeconds!==undefined
  ?Math.max(0,detail.estimatedRemainingSeconds-(clock-detail.updatedAt)/1000)
  :phase==='processing'&&gained>0&&elapsed>=8?elapsed/gained*(100-file.progress):undefined;
 const label=phase==='math'?`Preparing math spans · ${detail!.completed} of ${detail!.total} batches complete`
  :phase==='queued'?'Waiting to start source processing'
  :phase==='processing'?`Extracting and organizing text · ${file.progress}%${file.pages?` · ${file.pages} pages`:''}`
  :'Identifying sections, authors, and source details';
 return <div className="section-hint">
  <p role="status">{label}</p>
  {detail&&<progress value={detail.completed} max={detail.total} aria-label="Math preparation batches completed"/>}
  <p>{elapsed<60?`${elapsed}s`:`${Math.floor(elapsed/60)}m ${elapsed%60}s`} elapsed in this stage
   {estimate!==undefined?(estimate>0?` · Estimated ${sourceDuration(estimate)} remaining in this stage`:detail&&detail.completed===detail.total?' · Notation preparation complete':' · Still working; this stage is taking longer than estimated')
    :phase==='math'?' · Estimating after the first batch…':phase==='processing'?' · Estimating once extraction advances…':phase==='queued'?' · Timing depends on other source jobs.':' · Timing depends on source length and model speed.'}
  </p>
  {phase!=='queued'&&<p>You can leave this panel; source processing continues in the background.</p>}
 </div>;
}
