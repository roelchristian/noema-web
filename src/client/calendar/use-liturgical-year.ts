import {useEffect,useState} from 'react';
import {api} from '../api';
import {liturgicalProviderKey,supportedLiturgicalYear,validLiturgicalYear,type LiturgicalYear} from '../../shared/liturgical';
const prefix='noema.general-roman.v1:';
const memory=new Map<number,LiturgicalYear>();
function remember(data:LiturgicalYear) {
 memory.delete(data.year);memory.set(data.year,data);while(memory.size>4)memory.delete(memory.keys().next().value!);
 try {
  localStorage.setItem(prefix+data.year,JSON.stringify(data));
  const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)!).filter(key=>key.startsWith(prefix));
  for(const key of keys.filter(key=>key!==prefix+data.year).slice(0,Math.max(0,keys.length-4)))localStorage.removeItem(key);
 }catch{/* Storage unavailability does not block the calendar or its memory cache. */}
}
function cached(year:number):LiturgicalYear|null {
 const value=memory.get(year);if(value&&validLiturgicalYear(value,year))return value;
 try {const raw=localStorage.getItem(prefix+year);if(raw&&raw.length<=1_000_000){const value:unknown=JSON.parse(raw);if(validLiturgicalYear(value,year)){remember(value);return value;}}}catch{/* Invalid local caches are ignored. */}
 return null;
}
export function useLiturgicalYear(vault:string,year:number,enabled:boolean) {
 const [state,setState]=useState<{key:string;data:LiturgicalYear|null;loading:boolean;error:string}>({key:'',data:null,loading:false,error:''}),[retry,setRetry]=useState(0);
 const key=JSON.stringify([vault,year,enabled,liturgicalProviderKey,retry]);
 useEffect(()=>{
  const controller=new AbortController();
  if(!enabled){setState({key,data:null,loading:false,error:''});return;}
  if(!supportedLiturgicalYear(year)){setState({key,data:null,loading:false,error:'General Roman Calendar supports 1970–2099. Civil dates and knowledge remain available.'});return;}
  const local=cached(year);if(local){setState({key,data:local,loading:false,error:''});return;}
  setState({key,data:null,loading:true,error:''});
  api.liturgicalYear(vault,year,controller.signal).then(data=>{if(!validLiturgicalYear(data,year))throw new Error('Invalid liturgical calendar data');if(!controller.signal.aborted){remember(data);setState({key,data,loading:false,error:''});}}).catch(()=>{if(!controller.signal.aborted)setState({key,data:null,loading:false,error:'Liturgical supplement unavailable. The civil calendar is still usable.'});});
  return()=>controller.abort();
 },[key]);
 return {...(state.key===key?state:{key,data:null,loading:enabled&&supportedLiturgicalYear(year),error:''}),retry:()=>setRetry(value=>value+1)};
}
