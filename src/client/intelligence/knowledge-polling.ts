import type {PageEnrichmentStatus} from '../../shared/domain';

type PollTimer=number|ReturnType<typeof setTimeout>;

/** One request chain per page; event wakeups during a request are replayed afterwards. */
export function pollKnowledge(options:{
  status:(signal:AbortSignal)=>Promise<PageEnrichmentStatus>;
  refresh:(signal:AbortSignal)=>Promise<void>;
  onStatus:(status:PageEnrichmentStatus)=>void;
  visible:()=>boolean;
  schedule?:(callback:()=>void,delay:number)=>PollTimer;
  unschedule?:(timer:PollTimer)=>void;
}) {
  const schedule=options.schedule??((callback:()=>void,delay:number):PollTimer=>setTimeout(callback,delay)),unschedule=options.unschedule??((timer:PollTimer)=>clearTimeout(timer));
  let stopped=false,running=false,again=false,version:string|undefined,timer:PollTimer|undefined,controller:AbortController|undefined;
  const wake=()=>{
    if(stopped)return;
    if(timer!==undefined)unschedule(timer);
    if(!options.visible())return;
    if(running){again=true;return;}
    void run();
  };
  async function run() {
    running=true;again=false;controller=new AbortController();
    const current=controller;
    const timeout=schedule(()=>current.abort(),15_000);
    let delay=5_000;
    try {
      const status=await options.status(current.signal);
      if(stopped||current.signal.aborted)return;
      if(status.version!==version){
        await options.refresh(current.signal);
        if(stopped||current.signal.aborted)return;
        version=status.version;
      }
      options.onStatus(status);
      delay=status.pending?2_000:60_000;
    }catch{/* A failed read retains the displayed result and retries. */}
    finally {
      unschedule(timeout);running=false;
      if(!stopped)timer=schedule(wake,again?0:delay);
    }
  }
  wake();
  return {wake,stop:()=>{stopped=true;controller?.abort();if(timer!==undefined)unschedule(timer);}};
}
