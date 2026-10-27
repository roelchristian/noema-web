import type {AIActivityLog} from './ai-activity.js';
import type {Store} from '../store.js';
import type {DocumentProvider,DocumentRequest,DocumentResult,DocumentUsage} from './document-provider.js';
export type SourceIngestionActivityScope={vaultId:string;fileId:string;phase:'extract'|'repair'|'relate'|'recover'|'enrich'};
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined;
/** Activity's output total includes thinking. Gemini reports thought tokens as a
 * separate count; OpenAI includes them in output_tokens already. */
export function ingestionActivityUsage(provider:DocumentProvider['provider'],usage:DocumentUsage){
 const output=count(usage.outputTokens),thinking=count(usage.thinkingTokens);
 const total=provider==='gemini'&&output!==undefined&&thinking!==undefined?count(output+thinking):output;
 return {input_tokens:count(usage.inputTokens),output_tokens:total,input_tokens_details:{cached_tokens:count(usage.cachedInputTokens),cache_write_tokens:count(usage.cacheWriteTokens)},output_tokens_details:{reasoning_tokens:thinking}};
}
/** Summary-only activity projection. Never install a transport/debug observer or
 * pass PDF bytes, prompts, candidates, remote handles, credentials or raw errors
 * into AIActivityLog, including when full debug capture is enabled. Durable
 * ingestion attempts remain the recovery authority; this wrapper never retries. */
export async function sourceIngestionWithActivity(log:AIActivityLog,store:Store,scope:SourceIngestionActivityScope,provider:DocumentProvider,request:DocumentRequest):Promise<DocumentResult>{
 let id:string|undefined,observer:ReturnType<AIActivityLog['request']>|undefined,wasSubmitted=false;
 const diagnostic=(work:()=>void)=>{try{work();}catch{/* Activity projection cannot discard a successful paid result. */}};
 diagnostic(()=>{
  const entityId=store.get<{entity_id:string|null}>('SELECT entity_id FROM source_files WHERE vault_id=? AND id=?',scope.vaultId,scope.fileId)?.entity_id??null;
  id=log.start('source_ingestion',{model:request.model,reasoningEffort:request.reasoning??'medium'},scope.vaultId,entityId,'entity');
 });
 const submitted=()=>diagnostic(()=>{if(id&&!observer)observer=log.request(id,request.pdf.byteLength+Buffer.byteLength(request.prompt,'utf8'),null);});
 try{
  const result=await provider.extract({...request,onSubmitted:requestId=>{wasSubmitted=true;submitted();request.onSubmitted?.(requestId);}});
  submitted();
  diagnostic(()=>{if(!id)return;observer?.usage?.(ingestionActivityUsage(provider.provider,result.usage));
   // Events contain fixed vocabulary only, never provider-generated text.
   if(observer&&'event' in observer&&typeof observer.event==='function')observer.event('validation',{phase:scope.phase,status:result.status,outcome:'known'});
   log.finish(id,result.status==='completed'?'completed':'failed',result.status==='completed'?200:result.status==='refused'?403:502);
  });
  return result;
 }catch(error){
  const details=error&&typeof error==='object'?error as {outcomeUncertain?:unknown;code?:unknown;status?:unknown}:{};
  const uncertain=details.outcomeUncertain===true||wasSubmitted&&details.outcomeUncertain!==false,stopped=details.code==='cancelled';
  if(uncertain)submitted();
  diagnostic(()=>{if(!id)return;
   if(observer&&'error' in observer&&typeof observer.error==='function')observer.error(uncertain?'Document provider outcome unknown; explicit duplicate-cost recovery is required.':stopped?'Document processing stopped before a paid request was submitted.':'Document provider request failed; inspect ingestion diagnostics.');
   if(observer&&'event' in observer&&typeof observer.event==='function')observer.event('validation',{phase:scope.phase,status:uncertain?'unknown':stopped?'not-submitted':'failed',outcome:uncertain?'unknown':'known'});
   log.finish(id,uncertain?'interrupted':stopped?'skipped':'failed',uncertain?null:typeof details.status==='number'?details.status:null);
  });
  throw error;
 }
}
