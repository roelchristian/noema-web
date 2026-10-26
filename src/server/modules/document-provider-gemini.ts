import {candidateResult,checkDocumentRequest,documentRequestDeadline,documentRequestSystemPrompt,DocumentProviderError,providerHTTP,readDocumentResponse,tokenCount,type DocumentProvider,type DocumentRequest,type DocumentResult} from './document-provider.js';
const base='https://generativelanguage.googleapis.com';
export class GeminiDocumentProvider implements DocumentProvider {
 readonly provider='gemini' as const;
 readonly capabilities={pdf:true as const,structuredOutput:true as const,remoteRetentionHours:48,retrieve:false,cancel:false,explicitCaching:false as const};
 constructor(private readKey:()=>string,private transport:typeof fetch=fetch){}
 async extract(request:DocumentRequest):Promise<DocumentResult>{
  request=documentRequestDeadline(request);checkDocumentRequest(this.provider,request);const key=this.readKey();if(!key)throw new DocumentProviderError('credentials',503,'Configure the Gemini server credential first.');
  const headers={'x-goog-api-key':key};let name:string|undefined;
  try{
   // Multipart Files upload: file handles are transport details, never a source of record.
   const boundary='noema-document-boundary';const metadata=JSON.stringify({file:{display_name:'Noema PDF window'}});
   const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`),Buffer.from(request.pdf),Buffer.from(`\r\n--${boundary}--\r\n`)]);
   const uploaded=await readDocumentResponse(await providerHTTP(this.transport,`${base}/upload/v1/files?uploadType=multipart`,{method:'POST',headers:{...headers,'Content-Type':`multipart/related; boundary=${boundary}`,'X-Goog-Upload-Protocol':'multipart'},body,signal:request.signal}));
   let file=uploaded.file;if(!file||typeof file.name!=='string'||!/^files\/[a-zA-Z0-9_-]+$/.test(file.name)||typeof file.uri!=='string'||!file.uri.startsWith(base+'/'))throw new DocumentProviderError('upload_invalid',502,'Gemini returned invalid document upload metadata.');name=file.name;
   if(file.expirationTime&&Date.parse(file.expirationTime)<=Date.now())throw new DocumentProviderError('file_expired',409,'The uploaded Gemini file has expired. Re-upload this window.');
   for(let poll=0;file.state==='PROCESSING'&&poll<12;poll++){await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DocumentProviderError('cancelled',409,'PDF upload processing stopped before generation.'));};const timer=setTimeout(()=>{request.signal?.removeEventListener('abort',abort);resolve();},250);request.signal?.addEventListener('abort',abort,{once:true});if(request.signal?.aborted)abort();});file=await readDocumentResponse(await providerHTTP(this.transport,`${base}/v1/${name}`,{headers,signal:request.signal}));}
   if(file.state&&file.state!=='ACTIVE')throw new DocumentProviderError('file_not_ready',409,'Gemini has not finished processing the uploaded PDF. Retry this known unfinished upload.');
   request.signal?.throwIfAborted();request.onSubmitted?.();
   // Stable v1 accepts input steps; raw text/document content belongs inside
   // a user_input step (the bare content-array shorthand is v1beta-only).
   const response=await providerHTTP(this.transport,`${base}/v1/interactions`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},signal:request.signal,body:JSON.stringify({model:request.model,store:false,stream:false,system_instruction:documentRequestSystemPrompt(request),input:[{type:'user_input',content:[{type:'document',uri:file.uri,mime_type:'application/pdf'},{type:'text',text:request.prompt}]}],response_format:{type:'text',mime_type:'application/json',schema:request.schema},generation_config:{max_output_tokens:request.maxOutputTokens,thinking_level:request.reasoning??'medium',tool_choice:'none'}})},true);
   const result=await readDocumentResponse(response,undefined,true);if(typeof result.id==='string')request.onSubmitted?.(result.id);
   const content=Array.isArray(result.steps)?result.steps.flatMap((step:any)=>step?.type==='model_output'&&Array.isArray(step.content)?step.content:[]):[];
   const text=content.filter((part:any)=>part?.type==='text'&&typeof part.text==='string').map((part:any)=>part.text).join('');
   const usage=result.usage??{};
   return candidateResult(result,request,text,content.some((part:any)=>part?.type==='refusal')?'refused':result.status==='completed'?'completed':'incomplete',{inputTokens:tokenCount(usage.total_input_tokens),outputTokens:tokenCount(usage.total_output_tokens),thinkingTokens:tokenCount(usage.total_thought_tokens),cachedInputTokens:tokenCount(usage.total_cached_tokens),cacheWriteTokens:0});
  }finally{if(name)try{await providerHTTP(this.transport,`${base}/v1/${name}`,{method:'DELETE',headers,signal:AbortSignal.timeout(10000)});}catch{/* The provider also expires Files after 48 hours. */}}
 }
}
