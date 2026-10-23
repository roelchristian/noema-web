import {useEffect,useState} from 'react';
import {api} from '../api';
import {liturgicalKey,liturgicalCalendar,supportedLiturgicalYear,validLiturgicalYear,type LiturgicalYear,type LiturgicalCalendarId} from '../../shared/liturgical';
const prefix='noema.liturgical.v2:';
const memory=new Map<string,LiturgicalYear>();
function remember(id:LiturgicalCalendarId,data:LiturgicalYear) {
 const key=`${id}:${data.year}`;memory.delete(key);memory.set(key,data);while(memory.size>32)memory.delete(memory.keys().next().value!);
 try {
  localStorage.setItem(prefix+key,JSON.stringify(data));
  const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)!).filter(key=>key.startsWith(prefix));
  for(const old of keys.filter(item=>item!==prefix+key).slice(0,Math.max(0,keys.length-32)))localStorage.removeItem(old);
 }catch{/* The server cache remains available when browser storage is full. */}
}
function cached(id:LiturgicalCalendarId,year:number):LiturgicalYear|null {
 const key=`${id}:${year}`,providerKey=liturgicalKey(id),value=memory.get(key);if(value&&validLiturgicalYear(value,year,providerKey))return value;
 try {const raw=localStorage.getItem(prefix+key);if(raw&&raw.length<=1_000_000){const value:unknown=JSON.parse(raw);if(validLiturgicalYear(value,year,providerKey)){remember(id,value);return value;}}}catch{/* Invalid local caches are ignored. */}
 return null;
}
export function useLiturgicalYear(vault:string,year:number,enabled:boolean,id:LiturgicalCalendarId='grc-en') {
 const [state,setState]=useState<{key:string;data:LiturgicalYear|null;loading:boolean;error:string}>({key:'',data:null,loading:false,error:''}),[retry,setRetry]=useState(0);
 const key=JSON.stringify([vault,year,enabled,liturgicalKey(id),retry]);
 useEffect(()=>{
  const controller=new AbortController(),calendar=liturgicalCalendar(id)!;
  if(!enabled){setState({key,data:null,loading:false,error:''});return;}
  if(!supportedLiturgicalYear(year,id)){setState({key,data:null,loading:false,error:`${calendar.label} supports ${calendar.minYear}–${calendar.maxYear}. Civil dates remain available.`});return;}
  const local=cached(id,year);if(local){setState({key,data:local,loading:false,error:''});return;}
  setState({key,data:null,loading:true,error:''});
  api.liturgicalYear(vault,year,controller.signal,id).then(data=>{if(!validLiturgicalYear(data,year,liturgicalKey(id)))throw new Error('Invalid liturgical calendar data');if(!controller.signal.aborted){remember(id,data);setState({key,data,loading:false,error:''});}}).catch(error=>{if(!controller.signal.aborted)setState({key,data:null,loading:false,error:error instanceof Error?error.message:'Liturgical calendar unavailable. Civil dates remain available.'});});
  return()=>controller.abort();
 },[key]);
 return {...(state.key===key?state:{key,data:null,loading:enabled&&supportedLiturgicalYear(year,id),error:''}),retry:()=>setRetry(value=>value+1)};
}
