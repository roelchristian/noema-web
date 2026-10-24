import {InlineNotice} from './InlineNotice';
import type {ProgressNoticeProps,NoticeTone} from './types';
export function ProgressNotice({id,title,stage,detail,state,value,max,retryAction,progressLabel,compact=false,className=''}:ProgressNoticeProps) {
 const tone:NoticeTone=state==='failed'?'error':state==='interrupted'?'warning':state==='completed'?'success':'info';
 const active=state==='running'||state==='queued';
 return <div id={id} className={'progress-notice '+className} data-state={state}>
 <InlineNotice tone={tone} title={<span aria-live="polite">{title}{stage&&<> — {stage}</>}</span>} announcement="off" variant={compact?'compact':'standard'} actions={retryAction} description={<>{detail}{(active||value!==undefined&&max!==undefined)&&<progress aria-label={progressLabel??title} value={value!==undefined&&max!==undefined?Math.min(max,Math.max(0,value)):undefined} max={max}/>}</>}/>
 </div>;
}
