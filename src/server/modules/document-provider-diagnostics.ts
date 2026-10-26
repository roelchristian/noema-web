import {existsSync,lstatSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

/** Explicit, one-rejection local debugging. Never participates in activity,
 * exports, source IR or normal persisted errors. Enable by creating the private
 * data/document-provider-debug.json file with {directory,expiresAt}; the existing
 * directory must be private. The switch is consumed after a diagnostic is saved. */
export function captureDocumentProviderRejection(input:{status:number;phase:string;body:unknown;url:string;headers?:HeadersInit},configPath=path.resolve('data/document-provider-debug.json')):string|undefined {
 try{
  if(!existsSync(configPath))return;
  const configStat=lstatSync(configPath);
  if(!configStat.isFile()||configStat.isSymbolicLink()||configStat.size>2048||(configStat.mode&0o077)!==0)return;
  const config=JSON.parse(readFileSync(configPath,'utf8'));
  const expiresAt=typeof config.expiresAt==='string'?Date.parse(config.expiresAt):NaN;
  if(typeof config.directory!=='string'||!path.isAbsolute(config.directory)||!Number.isFinite(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+3600000)return;
  const directory=lstatSync(config.directory);
  if(!directory.isDirectory()||directory.isSymbolicLink()||(directory.mode&0o077)!==0)return;
  const headers=new Headers(input.headers),secrets:string[]=[];
  for(const name of ['authorization','x-goog-api-key','api-key','x-api-key']){const value=headers.get(name);if(value){secrets.push(value);if(/^Bearer /i.test(value))secrets.push(value.slice(7));}}
  for(const [name,value] of new URL(input.url).searchParams)if(/^(?:key|api_key|token|access_token)$/i.test(name)&&value)secrets.push(value);
  // Only the rejected response body is captured. No request payload, PDF,
  // prompt, headers or endpoint URL is written. Credential matches are removed
  // even when a provider unexpectedly echoes them in its error response.
  let body=JSON.stringify(input.body??null);
  if(body.length>65536)return;
  for(const secret of [...new Set(secrets)].sort((a,b)=>b.length-a.length))for(const value of [secret,encodeURIComponent(secret)])body=body.split(value).join('[redacted credential]');
  body=body.replace(/https?:\/\/[^\s"<>\\]+/g,'[redacted URL]');
  const filename=path.join(config.directory,`document-rejection-${randomUUID()}.json`);
  writeFileSync(filename,JSON.stringify({capturedAt:new Date().toISOString(),httpStatus:input.status,phase:input.phase,response:JSON.parse(body)},null,2),{mode:0o600,flag:'wx'});
  unlinkSync(configPath);
  return filename;
 }catch{return undefined;} // Diagnostics must never replace the real provider outcome.
}
