import {HttpError} from '../validation.js';

export interface EditorialFailure {code:string;message:string;retryable:boolean;configuration:boolean;outcomeUncertain:boolean}
/** Only explicit failed provider responses may be automatically resubmitted.
 * A lost connection/timeout can occur after the provider has completed paid work. */
export function editorialFailure(error:unknown,aborted=false):EditorialFailure {
 const message=error instanceof Error?error.message:'Editorial pass failed.';
 const result=(code:string,retryable=false,configuration=false,outcomeUncertain=false)=>({code,message,retryable,configuration,outcomeUncertain});
 const value=error as {name?:string;providerStatus?:number;code?:string;outcomeUncertain?:boolean};
 if(value?.name==='GenerationCancellationError')return result('cancelled',false,false,value.outcomeUncertain??false);
 if(aborted)return result('cancelled',false,false,value?.outcomeUncertain??false);
 if(value?.name==='GenerationAdmissionError')return result('local_admission');
 if(value?.name==='GenerationTransportError')return result(value.code==='timeout'?'transport_timeout':value.code??'provider_transport',false,false,true);
 if(typeof value?.providerStatus==='number'){
  if(value.providerStatus===429)return result('provider_rate_limit',true);
  if([500,502,503,504].includes(value.providerStatus))return result('provider_unavailable',true);
  return result(`provider_http_${value.providerStatus}`,false,[400,401,403,404,422].includes(value.providerStatus));
 }
 if(/invalid editorial JSON/i.test(message))return result('invalid_json');
 if(/invalid editorial (patch )?response/i.test(message))return result('invalid_response');
 if(/canonical source changed/i.test(message))return result('source_changed');
 if(/model changed|configuration changed|supported model|reasoning|credential|API key|AI is not configured/i.test(message))return result('configuration',false,true);
 if(/overlapping patches|checkpoint|canonical excerpt/i.test(message))return result('patch_rejected');
 if(error instanceof HttpError&&error.status===429)return result('local_admission');
 return result('unknown');
}

export function editorialBackoff(attempt:number,signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new HttpError(409,'Editorial pass interrupted.'));return;}
  const stop=()=>{clearTimeout(timer);reject(new HttpError(409,'Editorial pass interrupted.'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},Math.min(4000,500*2**(attempt-1)));
  signal.addEventListener('abort',stop,{once:true});
 });
}
