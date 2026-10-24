/** Explicit provider entry/completion gates; waiting never depends on polling a mutable callback. */
export function providerBarrier(label) {
 const entered=Promise.withResolvers(),completion=Promise.withResolvers();
 let didEnter=false;
 return {
  enter(){didEnter=true;entered.resolve();return completion.promise;},
  release(value){completion.resolve(value);},
  // request must honor controller.signal, as native fetch does at both call sites.
  async close(request,{value,controller,timeoutMs=1000}){
   completion.resolve(value);
   // Drain an entered route before closing its server/database. Abort is the fallback
   // for a route that never reached the fixture, or failed to drain after release.
   if(!didEnter)controller.abort();
   const settled=request.then(()=>{},()=>{});
   let timer;
   try {
    await Promise.race([settled,new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve();},timeoutMs);})]);
    await settled;
   }finally{clearTimeout(timer);}
  },
  async waitForEntry(request,{timeoutMs=10000}={}){
   let timer;
   try {
    await Promise.race([
     entered.promise,
     request.then(()=>{throw new Error(`${label}: request completed before provider entry`);}),
     new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label}: provider entry timed out after ${timeoutMs}ms`)),timeoutMs);}),
    ]);
   }finally{clearTimeout(timer);}
  },
 };
}
