import {documentProviderRepairSchema} from './document-provider-repairs.js';
import {candidateResult,checkDocumentRequest,documentRequestDeadline,documentRequestSystemPrompt,DocumentProviderError,providerHTTP,readDocumentResponse,tokenCount,type DocumentProvider,type DocumentRequest,type DocumentResult} from './document-provider.js';
export class OpenAIDocumentProvider implements DocumentProvider {
 readonly provider='openai' as const;
 readonly capabilities={pdf:true as const,structuredOutput:true as const,remoteRetentionHours:1,retrieve:false,cancel:false,explicitCaching:false as const};
 constructor(private readKey:()=>string,private transport:typeof fetch=fetch){}
 async extract(request:DocumentRequest):Promise<DocumentResult>{
  request=documentRequestDeadline(request);checkDocumentRequest(this.provider,request);const key=this.readKey();if(!key)throw new DocumentProviderError('credentials',503,'Configure the OpenAI server credential first.');
  const authorization={Authorization:`Bearer ${key}`};let fileId:string|undefined;
  try{
   const form=new FormData();form.set('purpose','user_data');form.set('expires_after[anchor]','created_at');form.set('expires_after[seconds]','3600');form.set('file',new Blob([new Uint8Array(request.pdf)],{type:'application/pdf'}),'window.pdf');
   const uploaded=await readDocumentResponse(await providerHTTP(this.transport,'https://api.openai.com/v1/files',{method:'POST',headers:authorization,body:form,signal:request.signal}));
   if(typeof uploaded.id!=='string'||!/^file-[a-zA-Z0-9_-]+$/.test(uploaded.id))throw new DocumentProviderError('upload_invalid',502,'OpenAI returned an invalid file identity.');fileId=uploaded.id;
   request.signal?.throwIfAborted();request.onSubmitted?.();
   const response=await providerHTTP(this.transport,'https://api.openai.com/v1/responses',{method:'POST',headers:{...authorization,'Content-Type':'application/json'},signal:request.signal,body:JSON.stringify({model:request.model,store:false,stream:false,instructions:documentRequestSystemPrompt(request),input:[{role:'user',content:[{type:'input_file',file_id:fileId},{type:'input_text',text:request.prompt}]}],max_output_tokens:request.maxOutputTokens,reasoning:{effort:request.reasoning??'medium'},text:{format:{type:'json_schema',name:'source_ingestion',strict:true,schema:documentProviderRepairSchema(request.schema)}}})},true);
   const body=await readDocumentResponse(response,undefined,true);if(typeof body.id==='string')request.onSubmitted?.(body.id);
   const content=Array.isArray(body.output)?body.output.flatMap((item:any)=>item?.type==='message'&&Array.isArray(item.content)?item.content:[]):[];
   const refused=content.some((item:any)=>item?.type==='refusal');
   const text=content.filter((item:any)=>item?.type==='output_text'&&typeof item.text==='string').map((item:any)=>item.text).join('');
   const usage=body.usage??{};
   return candidateResult(body,request,text,refused?'refused':body.status==='completed'?'completed':'incomplete',{inputTokens:tokenCount(usage.input_tokens),outputTokens:tokenCount(usage.output_tokens),thinkingTokens:tokenCount(usage.output_tokens_details?.reasoning_tokens),cachedInputTokens:tokenCount(usage.input_tokens_details?.cached_tokens),cacheWriteTokens:tokenCount(usage.input_tokens_details?.cache_write_tokens)});
  }finally{if(fileId)try{await providerHTTP(this.transport,`https://api.openai.com/v1/files/${fileId}`,{method:'DELETE',headers:authorization,signal:AbortSignal.timeout(10000)});}catch{/* Expiry remains a bounded fallback; no handles enter durable jobs. */}}
 }
}
