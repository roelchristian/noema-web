import { summaryPrompt } from './summary-prompt.js';
import { defaultIntelligencePreferences, supportedIntelligencePreferences, type IntelligencePreferences } from '../../shared/intelligence.js';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { IntelligenceStatus } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError } from '../validation.js';

interface Credential { key: string; expiresAt: string; generation: string }
export interface SecretStore { read(): Credential | null; write(value: Credential): void; remove(): void }
// The credential never enters SQLite, browser storage, command arguments, or logs.
export class MacKeychain implements SecretStore {
  constructor(private account: string, private execute: typeof spawnSync=spawnSync) {
    if(!/^[a-f0-9-]{36}$/.test(account))throw new Error('Invalid intelligence account');
  }
  private run(args: string[], input?: string) {
    if(process.platform !== 'darwin')throw new HttpError(503,'Secure key storage requires macOS Keychain. Intelligence is disabled on this system.');
    const result=this.execute('/usr/bin/security',args,{input,encoding:'utf8',timeout:15000,maxBuffer:16384});
    if(result.error || result.signal || (result.status!==0 && result.status!==44))throw new HttpError(503,'Keychain is unavailable. Unlock your login keychain and try again.');
    return result;
  }
  read(): Credential | null {
    const result=this.run(['find-generic-password','-a',this.account,'-s','app.noema.openai','-w']);
    if(result.status===44)return null;
    try {
      const value=JSON.parse(Buffer.from(result.stdout.trim(),'base64').toString('utf8')) as Credential;
      if(typeof value.key!=='string'||!Number.isFinite(Date.parse(value.expiresAt))||typeof value.generation!=='string')throw new Error();
      return value;
    }catch {throw new HttpError(503,'The saved credential is unreadable. Remove it and save a replacement.');}
  }
  write(value: Credential) {
    // security's interactive mode keeps the secret off the process command line.
    // Only generated UUIDs and base64 enter its command parser; no shell is used.
    const encoded=Buffer.from(JSON.stringify(value)).toString('base64');
    const result=this.run(['-i'],`add-generic-password -U -a ${this.account} -s app.noema.openai -w ${encoded}\n`);
    if(/error|failed|SecKeychain/i.test(result.stderr)||this.read()?.generation!==value.generation)throw new HttpError(503,'Could not save the credential in Keychain.');
  }
  remove() { this.run(['delete-generic-password','-a',this.account,'-s','app.noema.openai']); }
}
export function keychainFor(store: Store) {
  let account=store.get<{value:string}>("SELECT value FROM metadata WHERE key='intelligence_account'")?.value;
  if(!account) {account=randomUUID();store.run("INSERT INTO metadata(key,value) VALUES ('intelligence_account',?)",account);}
  if(!/^[a-f0-9-]{36}$/.test(account))throw new Error('Invalid intelligence account');
  return new MacKeychain(account);
}
export interface PreferencesStore { read(): unknown; write(value: IntelligencePreferences): void }
export function intelligencePreferencesFor(store: Store): PreferencesStore {
  return {
    read() {
      const raw=store.get<{value:string}>("SELECT value FROM metadata WHERE key='intelligence_preferences'")?.value;
      try {return raw ? JSON.parse(raw) : null;}catch{return null;}
    },
    write(value) {store.run("INSERT INTO metadata(key,value) VALUES ('intelligence_preferences',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(value));},
  };
}
export class Intelligence {
  private active: AbortController | null=null;
  private attempts: number[]=[];
  private preferences: IntelligencePreferences={...defaultIntelligencePreferences};
  private preferenceRevision=0;
  constructor(private secrets: SecretStore, private transport: typeof fetch=fetch, private clock=()=>Date.now(), private preferenceStore?: PreferencesStore) {
    const saved=preferenceStore?.read();
    if(supportedIntelligencePreferences(saved))this.preferences={model:saved.model,reasoningEffort:saved.reasoningEffort};
  }
  selection(): IntelligencePreferences {return {...this.preferences};}
  savePreferences(body: Record<string,unknown>) {
    if(!supportedIntelligencePreferences(body))throw new HttpError(400,'Choose a supported model and reasoning effort.');
    const value={model:body.model,reasoningEffort:body.reasoningEffort};
    this.preferenceStore?.write(value);
    this.preferences=value;this.preferenceRevision++;this.active?.abort();
    return this.selection();
  }
  private credential() {
    const value=this.secrets.read();
    if(value && Date.parse(value.expiresAt)<=this.clock()) {this.remove();return null;}
    return value;
  }
  status(): IntelligenceStatus {
    const value=this.credential();
    return {configured:!!value,expiresAt:value?.expiresAt ?? null,...this.selection()};
  }
  save(body: Record<string,unknown>) {
    if(typeof body.apiKey!=='string'||!/^sk-[A-Za-z0-9_-]{16,500}$/.test(body.apiKey))throw new HttpError(400,'Enter a valid OpenAI API key.');
    const days=body.days === undefined ? 30 : body.days;
    if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>365)throw new HttpError(400,'Choose a lifetime between 1 and 365 days.');
    this.active?.abort();
    this.secrets.write({key:body.apiKey,expiresAt:new Date(this.clock()+days*86400000).toISOString(),generation:randomUUID()});
    return this.status();
  }
  remove() {this.active?.abort();this.secrets.remove();return {configured:false,expiresAt:null,...this.selection()};}
  purgeExpired() {this.credential();}
  async generate(input: string, validate=false, onRequest?: (promptBytes: number) => void) {
    const credential=this.credential(),selection=this.selection(),preferenceRevision=this.preferenceRevision;
    if(!credential)throw new HttpError(409,'Add an API key in Settings → Intelligence. It may have expired.');
    if(this.active)throw new HttpError(429,'Another AI request is running. Please wait.');
    this.attempts=this.attempts.filter(t=>t>this.clock()-60000);
    if(this.attempts.length>=5)throw new HttpError(429,'AI is limited to 5 requests per minute. Try again shortly.');
    this.attempts.push(this.clock());
    const controller=new AbortController();this.active=controller;
    const timer=setTimeout(()=>controller.abort(),Math.min(45000,Date.parse(credential.expiresAt)-this.clock()));
    try {
      const prompt=validate?{instructions:'Reply with OK.',input:'Connection test.'}:summaryPrompt(input);
      const inputText=typeof prompt.input==='string'?prompt.input:prompt.input.flatMap(item=>item.content.map(part=>part.text)).join('');
      onRequest?.(Buffer.byteLength(prompt.instructions+inputText,'utf8'));
      const response=await this.transport('https://api.openai.com/v1/responses',{
        method:'POST',redirect:'error',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential.key}`},
        body:JSON.stringify({model:selection.model,store:false,max_output_tokens:validate?2048:8192,reasoning:{effort:selection.reasoningEffort},
          tools:[],tool_choice:'none',
          ...prompt}),
      });
      if(!response.ok) {
        await response.body?.cancel();
        throw new HttpError(response.status===429?429:502,response.status===401?'OpenAI rejected the API key. Replace it in Settings.':response.status===429?'OpenAI quota or rate limit reached. Check your OpenAI account.':'OpenAI could not complete the request. Check API permissions, model access, and billing.');
      }
      // Bound provider output before parsing; never return raw provider errors or headers.
      const reader=response.body?.getReader();let raw='',size=0;
      if(!reader)throw new Error();
      const decoder=new TextDecoder();
      while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>128000){await reader.cancel();throw new Error();}raw+=decoder.decode(value,{stream:true});}
      raw+=decoder.decode();
      const result=JSON.parse(raw);
      const summary=(result.output ?? []).filter((item:{type:string})=>item.type==='message').flatMap((item:{content: {type:string;text?:string}[]})=>item.content ?? []).filter((part:{type:string})=>part.type==='output_text').map((part:{text:string})=>part.text).join('\n').trim();
      if(result.status!=='completed'||!summary||summary.length>12000)throw new HttpError(502,'OpenAI returned an incomplete response. Try a lower reasoning effort or a shorter page.');
      if(controller.signal.aborted||this.credential()?.generation!==credential.generation||this.preferenceRevision!==preferenceRevision)throw new HttpError(409,'The credential or AI settings changed, or the key expired. Please try again.');
      // Defense in depth against accidental credential echo by an upstream service.
      return summary.split(credential.key).join('[redacted]').replace(/sk-[A-Za-z0-9_-]{16,}/g,'[redacted]');
    }catch(error) {
      if(error instanceof HttpError)throw error;
      throw new HttpError(502,'The AI request failed or timed out. Please try again.');
    }finally {clearTimeout(timer);if(this.active===controller)this.active=null;}
  }
}
