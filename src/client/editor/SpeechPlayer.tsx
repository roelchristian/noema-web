import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '../components/Icon';
import {Select} from '../components/Select';

type SpeechState={loading:boolean;url:string;error:string;part:number;total:number;assembling?:boolean};
const time=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;

export function SpeechPlayer({state,voice,onClose,onError}:{state:SpeechState;voice:string;onClose:()=>void;onError:()=>void}) {
  const audio=useRef<HTMLAudioElement>(null);
  const anchor=useRef<HTMLSpanElement>(null);
  const information=useRef<HTMLDetailsElement>(null);
  const [workspace,setWorkspace]=useState<{left:number;width:number}|null>(null);
  useLayoutEffect(()=>{
    const main=anchor.current?.closest('main');if(!main)return;
    const measure=()=>{
      const {left,width}=main.getBoundingClientRect();
      if(width>0)setWorkspace(current=>current?.left===left&&current.width===width?current:{left,width});
    };
    measure();
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
    observer?.observe(main);window.addEventListener('resize',measure);
    return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
  },[]);
  const [elapsed,setElapsed]=useState(0),[playing,setPlaying]=useState(false),[waiting,setWaiting]=useState(false);
  const [position,setPosition]=useState(0),[duration,setDuration]=useState(0),[rate,setRate]=useState(1),[ended,setEnded]=useState(false),[started,setStarted]=useState(false),[notice,setNotice]=useState('');
  useEffect(()=>{
    if(!state.url||!audio.current)return;
    let active=true;
    // Request playback explicitly once the complete selection has been assembled.
    // Keep manual play available if the browser requires a fresh user gesture.
    void audio.current.play().catch(()=>{if(active)setNotice('Press play to listen. Your browser paused automatic playback.');});
    return()=>{active=false;};
  },[state.url]);
  useEffect(()=>{
    const dismiss=(event:PointerEvent)=>{if(information.current&&!information.current.contains(event.target as Node))information.current.open=false;};
    document.addEventListener('pointerdown',dismiss);
    return()=>document.removeEventListener('pointerdown',dismiss);
  },[]);
  useEffect(()=>{
    if(!state.loading)return;
    const start=Date.now();
    const interval=window.setInterval(()=>setElapsed(Math.floor((Date.now()-start)/1000)),1000);
    return()=>window.clearInterval(interval);
  },[state.loading]);
  async function toggle(){
    const media=audio.current;if(!media)return;
    if(!media.paused){media.pause();return;}
    if(media.ended)media.currentTime=0;
    try{await media.play();setNotice('');}catch{setPlaying(false);setWaiting(false);setNotice('Playback could not start. Press play to try again, or download the audio.');}
  }
  const completed=state.assembling?state.total:Math.max(0,state.part-1);
  const title=state.error?'Speech unavailable':state.loading?(state.assembling?'Preparing audio…':'Generating speech…'):waiting?'Loading audio…':playing?'Playing':ended?'Finished reading':started?'Paused':'Ready to listen';
  const placement=workspace?{'--speech-workspace-center':`${workspace.left+workspace.width/2}px`,'--speech-workspace-width':`${workspace.width}px`} as CSSProperties:undefined;
  return <><span ref={anchor} hidden/>{createPortal(<aside className="editor-speech" aria-label="Speak selected blocks" data-loading={state.loading} data-error={!!state.error} data-ready={!!state.url} data-compact={workspace?workspace.width<=600:undefined} style={placement}>
    <div className="speech-heading">
      <div className={'speech-status'+(state.url?' sr-only':'')} role="status" aria-atomic="true">
        <strong>{title}</strong>
        {(state.error||state.loading&&state.total>1)&&<span>{state.error||`${state.part} / ${state.total}`}</span>}
      </div>
      <button type="button" className="speech-dismiss" onClick={onClose} aria-label={state.loading?'Cancel speech generation':state.error?'Dismiss':'Close speech player'} title={state.loading?'Cancel generation':'Close'}>{state.loading?'Cancel':state.error?'Dismiss':<Icon name="close"/>}</button>
    </div>
    {state.loading&&<div className="speech-generation">
      <progress aria-label="Speech generation progress" max={state.total} value={state.total>1||state.assembling?completed:undefined}/>
      <div className="speech-generation-detail"><span>{state.assembling?'Finishing your audio':elapsed>=20?'Still working. Longer selections can take a little while.':state.total>1?`${completed} of ${state.total} sections complete`:'Preparing your selected text for listening'}</span><span aria-label={`${elapsed} seconds elapsed`}>{time(elapsed)}</span></div>
    </div>}
    {state.url&&<>
      <audio ref={audio} key={state.url} autoPlay src={state.url} aria-label="AI-generated speech" onError={onError}
        onLoadedMetadata={event=>{const value=event.currentTarget.duration;setDuration(Number.isFinite(value)?value:0);}}
        onDurationChange={event=>{const value=event.currentTarget.duration;setDuration(Number.isFinite(value)?value:0);}}
        onTimeUpdate={event=>setPosition(event.currentTarget.currentTime)}
        onPlay={()=>{setPlaying(true);setStarted(true);setEnded(false);setNotice('');}} onPlaying={()=>setWaiting(false)} onWaiting={()=>setWaiting(true)}
        onPause={()=>{setPlaying(false);setWaiting(false);}} onEnded={()=>{setPlaying(false);setWaiting(false);setEnded(true);}}/>
      <div className="speech-playback" role="group" aria-label="Speech playback">
        <button type="button" className="speech-play" onClick={()=>void toggle()} aria-label={playing?'Pause speech':ended?'Replay speech':'Play speech'} title={playing?'Pause':ended?'Replay':'Play'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{playing?<path d="M6 4h4v16H6zm8 0h4v16h-4z"/>:<path d="m7 4 14 8-14 8z"/>}</svg>
        </button>
        <span className="speech-time">{time(position)}</span>
        <input className="speech-seek" type="range" min="0" max={duration||1} step="0.1" value={Math.min(position,duration||1)} disabled={!duration} aria-label="Seek speech" aria-valuetext={`${time(position)} of ${time(duration)}`} onInput={event=>{const value=Number(event.currentTarget.value);if(audio.current){audio.current.currentTime=value;setPosition(value);setEnded(false);}}}/>
        <span className="speech-time">{time(duration)}</span>
        <span className="speech-speed"><Select aria-label="Playback speed" value={rate} onChange={event=>{const value=Number(event.currentTarget.value);setRate(value);if(audio.current)audio.current.playbackRate=value;}}>{[0.75,1,1.25,1.5,2].map(value=><option key={value} value={value}>{value}×</option>)}</Select></span>
      </div>
      <details ref={information} className="speech-info" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}>
        <summary aria-label="Speech information" title="Speech information"><Icon name="info"/></summary>
        <div className="speech-info-panel"><strong>{voice.charAt(0).toUpperCase()+voice.slice(1)}</strong><span>AI-generated voice</span><span>Selected text · WAV audio</span></div>
      </details>
      <a className="speech-download" href={state.url} download="noema-speech.wav" aria-label="Download audio" title="Download audio"><Icon name="download"/><span>Download audio</span></a>
      {notice&&<p className="speech-notice" role="status">{notice}</p>}
    </>}
  </aside>,document.body)}</>;
}
