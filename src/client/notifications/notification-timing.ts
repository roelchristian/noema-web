import type {NoticeTone} from './types';
export interface NotificationClock {now:()=>number;setTimeout:(callback:()=>void,ms:number)=>ReturnType<typeof setTimeout>;clearTimeout:(timer:ReturnType<typeof setTimeout>)=>void}
export const systemNotificationClock:NotificationClock={now:()=>Date.now(),setTimeout:(callback,ms)=>setTimeout(callback,ms),clearTimeout:timer=>clearTimeout(timer)};
export function defaultDuration(tone:NoticeTone):number|null {return tone==='error'?null:tone==='neutral'||tone==='success'?4000:6000;}
export function remainingDuration(remaining:number|null,startedAt:number|null,now:number):number|null {return remaining===null?null:Math.max(0,remaining-(startedAt===null?0:Math.max(0,now-startedAt)));}
