import {createHmac,randomBytes,type Hmac} from 'node:crypto';
// The process-local key makes short private content fingerprints resistant to guessing.
const fingerprintKey=randomBytes(32);
function fingerprintInput(value:unknown,hash:Hmac):void {
  if(typeof value==='string'){hash.update('string:').update(String(Buffer.byteLength(value))).update(':').update(value);return;}
  if(Array.isArray(value)){hash.update('[');for(const item of value)fingerprintInput(item,hash);hash.update(']');return;}
  if(value&&typeof value==='object'){hash.update('{');for(const [key,item] of Object.entries(value)){hash.update(key).update(':');fingerprintInput(item,hash);}hash.update('}');return;}
  hash.update(String(value));
}
const record = (value:unknown):Record<string,any> => value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,any> : {};
export const traceExcerpt = (value:string,limit=4096) => Buffer.byteLength(value)<=limit?value:Buffer.from(value).subarray(0,limit/2).toString('utf8')+'\n[excerpt omitted]\n'+Buffer.from(value).subarray(-limit/2).toString('utf8');
function inputSize(value:unknown):number {
  if(typeof value==='string')return Buffer.byteLength(value);
  if(Array.isArray(value))return value.reduce((sum,item)=>sum+inputSize(item),0);
  return Object.values(record(value)).reduce<number>((sum,item)=>sum+inputSize(item),0);
}
/** Vector elements are never diagnostics, including in deliberately enabled full traces. */
export function withoutVectors(value:unknown):unknown {
  if(Array.isArray(value))return value.map(withoutVectors);
  if(!value || typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='embedding'?(Array.isArray(item)?{dimensions:item.length,valid:item.every(n=>typeof n==='number'&&Number.isFinite(n))}:{dimensions:finiteNumber(record(item).dimensions)??null,valid:record(item).valid===true}):withoutVectors(item)]));
}
const shortString = (value:unknown) => typeof value==='string'?traceExcerpt(value,256):undefined;
const finiteNumber = (value:unknown) => typeof value==='number'&&Number.isFinite(value)?value:undefined;
function usageSummary(value:unknown) {
  const p=record(value),counts:Record<string,unknown>={};
  for(const name of ['input_tokens','output_tokens','prompt_tokens','completion_tokens','total_tokens'])if(finiteNumber(p[name])!==undefined)counts[name]=p[name];
  for(const name of ['input_tokens_details','output_tokens_details','prompt_tokens_details','completion_tokens_details']){
    const details=record(p[name]),safe:Record<string,number>={};
    for(const key of ['cached_tokens','cache_write_tokens','reasoning_tokens'])if(finiteNumber(details[key])!==undefined)safe[key]=details[key];
    if(Object.keys(safe).length)counts[name]=safe;
  }
  return counts;
}
export function compactRequest(value:unknown) {
  const p=record(value),input=p.input??p.messages;
  if(Number.isSafeInteger(p.inputBytes)&&typeof p.fingerprint==='string')return p;
  const hash=createHmac('sha256',fingerprintKey);
  fingerprintInput(value,hash);
  return {model:shortString(p.model),...(typeof p.voice==='string'?{voice:shortString(p.voice)}:{}),reasoning:{effort:shortString(record(p.reasoning).effort)},max_output_tokens:finiteNumber(p.max_output_tokens),stream:p.stream===true,
    fingerprint:hash.digest('hex'),inputCount:Array.isArray(input)?input.length:input===undefined?0:1,inputBytes:inputSize(input),instructionBytes:inputSize(p.instructions),dimensions:finiteNumber(p.dimensions)};
}
export function compactResponse(value:unknown) {
  const p=record(value),texts:string[]=[];
  if(Number.isSafeInteger(p.outputBytes)&&typeof p.outputFingerprint==='string')return p;
  if(typeof p.output_text==='string')texts.push(p.output_text);
  for(const item of Array.isArray(p.output)?p.output:[])for(const part of Array.isArray(item.content)?item.content:[])if(typeof part.text==='string')texts.push(part.text);
  const output=texts.join('\n');
  const vectors=Array.isArray(p.data)?p.data.slice(0,64).map((item:any,index:number)=>({index: item.index??index,dimensions:Array.isArray(item.embedding)?item.embedding.length:null,valid:Array.isArray(item.embedding)&&item.embedding.length>0&&item.embedding.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n))})):undefined;
  return {id:shortString(p.id),model:shortString(p.model),status:shortString(p.status),usage:usageSummary(p.usage),error:p.error?{code:shortString(p.error.code),type:shortString(p.error.type),message:traceExcerpt(String(p.error.message??''),2048)}:undefined,
    incomplete_details:p.incomplete_details?{reason:shortString(record(p.incomplete_details).reason)}:undefined,outputBytes:Buffer.byteLength(output),outputExcerpt:traceExcerpt(output),outputFingerprint:createHmac('sha256',fingerprintKey).update(output).digest('hex'),vectorCount:Array.isArray(p.data)?p.data.length:undefined,vectors};
}
