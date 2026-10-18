import { sourcePagePrompt } from './source-page-prompt.js';
import type { AIDebugTrace, AIRequestObserver } from './ai-debug.js';
import { readOpenAIResponse, redactedTrace, responseOutputText } from './openai-response.js';
import { explanationPrompt } from './explanation-prompt.js';
import { entityScanPrompt } from './entity-scan.js';
import { titlePrompt } from './title-prompt.js';
import { summaryPrompt } from './summary-prompt.js';
import type {SourceAuthor} from './source-authors.js';
import { sourceEnrichmentPrompt, sourceAuthorsPrompt } from './source-enrichment-prompt.js';
import { limitSummaryWords } from '../../shared/summary-text.js';
import { pageLanguage } from './page-language.js';
import { defaultIntelligencePreferences, defaultManualRequestsPerMinute, maxManualRequestsPerMinute, validManualRequestLimit, intelligenceModels, type IntelligenceConfiguration, supportedIntelligencePreferences, type IntelligencePreferences } from '../../shared/intelligence.js';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { IntelligenceStatus } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError } from '../validation.js';

interface Credential { key: string; expiresAt: string; generation: string }
function parseSourceAuthors(value:unknown):SourceAuthor[] {
 if(!Array.isArray(value)||value.length>100||value.some((author:unknown)=>!author||typeof author!=='object'||!('name' in author)||typeof author.name!=='string'||!author.name.trim()||author.name.length>200||/[\x00-\x1f\x7f]/.test(author.name)||!('type' in author)||!['person','organization'].includes(String(author.type))))throw new HttpError(502,'AI returned invalid source authors. Retry enrichment.');
 return (value as SourceAuthor[]).map(author=>({name:author.name.trim().replace(/\s+/g,' '),type:author.type}));
}
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
export interface PreferencesStore { read(): unknown; write(value: IntelligenceConfiguration): void }
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
  private generationRequests=new Set<AbortController>();
  private embeddingRequests=new Set<AbortController>();
  private embeddingAttempts: number[]=[];
  private attempts: number[]=[];
  private manualRequestsPerMinute=defaultManualRequestsPerMinute;
  private preferences: IntelligencePreferences={...defaultIntelligencePreferences};
  private preferenceRevision=0;
  constructor(private secrets: SecretStore, private transport: typeof fetch=fetch, private clock=()=>Date.now(), private preferenceStore?: PreferencesStore) {
    const saved=preferenceStore?.read();
    if(supportedIntelligencePreferences(saved)) {
      this.preferences={model:saved.model,reasoningEffort:saved.reasoningEffort};
      if ('manualRequestsPerMinute' in saved && validManualRequestLimit(saved.manualRequestsPerMinute)) this.manualRequestsPerMinute=saved.manualRequestsPerMinute;
    }
  }
  selection(): IntelligencePreferences {return {...this.preferences};}
  savePreferences(body: Record<string,unknown>) {
    if(!supportedIntelligencePreferences(body))throw new HttpError(400,'Choose a supported model and reasoning effort.');
    const manualRequestsPerMinute=body.manualRequestsPerMinute === undefined ? this.manualRequestsPerMinute : body.manualRequestsPerMinute;
    if (!validManualRequestLimit(manualRequestsPerMinute)) throw new HttpError(400,`Choose between 1 and ${maxManualRequestsPerMinute} manual AI requests per minute.`);
    const value={model:body.model,reasoningEffort:body.reasoningEffort,manualRequestsPerMinute};
    this.preferenceStore?.write(value);
    const modelChanged=value.model!==this.preferences.model || value.reasoningEffort!==this.preferences.reasoningEffort;
    this.preferences={model:value.model,reasoningEffort:value.reasoningEffort};
    this.manualRequestsPerMinute=manualRequestsPerMinute;
    if (modelChanged) {this.preferenceRevision++;for(const request of this.generationRequests)request.abort();}
    return {...this.selection(),manualRequestsPerMinute:this.manualRequestsPerMinute};
  }
  private credential() {
    const value=this.secrets.read();
    if(value && Date.parse(value.expiresAt)<=this.clock()) {this.remove();return null;}
    return value;
  }
  status(): IntelligenceStatus {
    const value=this.credential();
    return {configured:!!value,expiresAt:value?.expiresAt ?? null,manualRequestsPerMinute:this.manualRequestsPerMinute,...this.selection()};
  }
  save(body: Record<string,unknown>) {
    if(typeof body.apiKey!=='string'||!/^sk-[A-Za-z0-9_-]{16,500}$/.test(body.apiKey))throw new HttpError(400,'Enter a valid OpenAI API key.');
    const days=body.days === undefined ? 30 : body.days;
    if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>365)throw new HttpError(400,'Choose a lifetime between 1 and 365 days.');
    for(const request of this.generationRequests)request.abort();
    for(const request of this.embeddingRequests)request.abort();
    this.secrets.write({key:body.apiKey,expiresAt:new Date(this.clock()+days*86400000).toISOString(),generation:randomUUID()});
    return this.status();
  }
  remove() {for(const request of this.generationRequests)request.abort();for(const request of this.embeddingRequests)request.abort();this.secrets.remove();return {configured:false,expiresAt:null,manualRequestsPerMinute:this.manualRequestsPerMinute,...this.selection()};}
  purgeExpired() {this.credential();}
  private reserveManualRequest() {
    const now=this.clock();
    this.attempts=this.attempts.filter(time=>time>now-60000);
    if (this.attempts.length>=this.manualRequestsPerMinute) {
      const seconds=Math.max(1,Math.ceil((this.attempts[this.attempts.length-this.manualRequestsPerMinute]!+60000-now)/1000));
      throw new HttpError(429,`Manual AI requests are limited to ${this.manualRequestsPerMinute} per minute. Try again in ${seconds} seconds.`);
    }
    this.attempts.push(now);
  }
  async embed(input: string, onRequest?: AIRequestObserver, background=false): Promise<{embedding:number[];tokens:number}> {
    if(!input.trim()||Buffer.byteLength(input,'utf8')>8000)throw new HttpError(400,'Embedding input must contain text and be at most 8,000 UTF-8 bytes.');
    const credential=this.credential();
    if(!credential)throw new HttpError(409,'Add an API key in Settings → Intelligence. It may have expired.');
    this.embeddingAttempts=this.embeddingAttempts.filter(time=>time>this.clock()-60000);
    if(this.embeddingAttempts.length>=30||this.embeddingRequests.size>=2)throw new HttpError(429,'Embedding request limit reached. Try again shortly.');
    if (!background) this.reserveManualRequest();
    this.embeddingAttempts.push(this.clock());
    const controller=new AbortController();this.embeddingRequests.add(controller);
    const timer=setTimeout(()=>controller.abort(),Math.min(45000,Date.parse(credential.expiresAt)-this.clock()));
    let trace: AIDebugTrace | undefined;
    try {
      const observer=onRequest?.(Buffer.byteLength(input,'utf8'));
      trace=redactedTrace(observer,credential.key);
      const payload={model:'text-embedding-3-small',input,encoding_format:'float',dimensions:1536};
      trace?.request('https://api.openai.com/v1/embeddings',payload);
      const response=await this.transport('https://api.openai.com/v1/embeddings',{
        method:'POST',redirect:'error',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential.key}`},
        body:JSON.stringify(payload),
      });
      if(!response.ok){if(trace)await readOpenAIResponse(response,trace).catch(()=>{});else await response.body?.cancel();throw new HttpError(response.status===429?429:502,response.status===401?'OpenAI rejected the API key. Replace it in Settings.':response.status===429?'OpenAI quota or rate limit reached. Check your OpenAI account.':'OpenAI could not create the embedding. Check API permissions and billing.');}
      const result=await readOpenAIResponse(response,trace,undefined,undefined,observer?.usage),vector=result.data?.[0]?.embedding;
      if(result.model!=='text-embedding-3-small'||!Array.isArray(vector)||vector.length!==1536||vector.some((value:unknown)=>typeof value!=='number'||!Number.isFinite(value))||!vector.some((value:number)=>value!==0))throw new HttpError(502,'OpenAI returned an invalid embedding.');
      if(controller.signal.aborted||this.credential()?.generation!==credential.generation)throw new HttpError(409,'The credential changed or expired. Please try again.');
      return {embedding:vector,tokens:Number.isSafeInteger(result.usage?.total_tokens)&&result.usage.total_tokens>=0?result.usage.total_tokens:0};
    }catch(error){trace?.error(error instanceof Error?error.message:'Embedding request failed.');if(error instanceof HttpError)throw error;throw new HttpError(502,'The embedding request failed or timed out. Please try again.');}
    finally{clearTimeout(timer);this.embeddingRequests.delete(controller);}
  }
  titleSelection(): IntelligencePreferences {
    const model=intelligenceModels.find(option=>option.id===this.preferences.model)?.efforts.includes('none') ? this.preferences.model : 'gpt-6-luna';
    return {model,reasoningEffort:'none'};
  }
  async generateTitle(input: string, onRequest?: AIRequestObserver) {
    const title=await this.generate(input,false,onRequest,true);
    if(title.length>120 || /[\r\n]/.test(title) || title==='Untitled')throw new HttpError(502,'OpenAI returned an invalid page title.');
    return title;
  }
  async generatePageUtility(input:string,subtypes:{id:string;name:string}[],currentTitle:string,onRequest?:AIRequestObserver,background=false) {
    const output=await this.generate(input,false,onRequest,true,false,false,{subtypes,currentTitle},background);
    let value:unknown;try{value=JSON.parse(output);}catch{throw new HttpError(502,'AI returned invalid title and category data.');}
    if(!value||typeof value!=='object'||!('title' in value)||typeof value.title!=='string'||!value.title.trim()||value.title.length>(currentTitle.trim()&&currentTitle.trim()!=='Untitled'?500:120)||/[\r\n]/.test(value.title)||value.title==='Untitled'||!('conceptSubtypeIds' in value)||!Array.isArray(value.conceptSubtypeIds)||value.conceptSubtypeIds.some(id=>typeof id!=='string'||!subtypes.some(subtype=>subtype.id===id)))throw new HttpError(502,'AI returned invalid title and category data.');
    return {title:currentTitle.trim()&&currentTitle.trim()!=='Untitled'?currentTitle:value.title.trim(),conceptSubtypeIds:[...new Set(value.conceptSubtypeIds as string[])]};
  }
  async enrichSource(input:string,onRequest?:AIRequestObserver) {
    const output=await this.generate(input,false,onRequest,false,false,false,undefined,true,undefined,true);
    try {
      const value=JSON.parse(output);
      if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.length>200||/[\r\n\x00-\x1f]/.test(value.name)||typeof value.summary!=='string'||!value.summary.trim()||!('language' in value))throw new Error();
      const authors=parseSourceAuthors(value.authors);
      return {name:value.name.trim(),language:pageLanguage(value.language),summary:limitSummaryWords(value.summary),authors};
    }catch {throw new HttpError(502,'AI returned invalid source metadata. Retry enrichment.');}
  }
  async extractSourceAuthors(input:string,onRequest?:AIRequestObserver) {
    const output=await this.generate(input,false,onRequest,false,false,false,undefined,true,undefined,'authors');
    try{return parseSourceAuthors(JSON.parse(output)?.authors);}
    catch{throw new HttpError(502,'AI returned invalid source authors. Retry enrichment.');}
  }
  async generate(input: string, validate=false, onRequest?: AIRequestObserver, title=false, entityScan=false, explain=false, utility?:{subtypes:{id:string;name:string}[];currentTitle:string}, background=false,sourcePage?:{onDelta:(delta:string)=>void;signal:AbortSignal;onPreviewDelta?:(delta:string)=>void;onPreviewReset?:()=>void},sourceEnrichment:boolean|'authors'=false) {
    const credential=this.credential(),selection=title?this.titleSelection():this.selection(),preferenceRevision=this.preferenceRevision;
    if(!credential)throw new HttpError(409,'Add an API key in Settings → Intelligence. It may have expired.');
    if(!title&&!entityScan&&this.active)throw new HttpError(429,'Another AI request is running. Please wait.');
    if (!background) this.reserveManualRequest();
    const controller=new AbortController();this.generationRequests.add(controller);if(!title&&!entityScan)this.active=controller;
    const abort=()=>controller.abort();
    sourcePage?.signal.addEventListener('abort',abort,{once:true});
    if(sourcePage?.signal.aborted)controller.abort();
    const timer=setTimeout(()=>controller.abort(),Math.min(sourcePage?180000:45000,Date.parse(credential.expiresAt)-this.clock()));
    let trace: AIDebugTrace | undefined;
    try {
      const prompt=sourceEnrichment==='authors'?sourceAuthorsPrompt(input):sourceEnrichment?sourceEnrichmentPrompt(input):sourcePage?sourcePagePrompt(input):validate?{instructions:'Reply with OK.',input:'Connection test.'}:title?titlePrompt(input,utility?.subtypes,utility?.currentTitle):entityScan?entityScanPrompt(input):explain?explanationPrompt(input):summaryPrompt(input);
      const inputText=typeof prompt.input==='string'?prompt.input:prompt.input.flatMap(item=>item.content.map(part=>part.text)).join('');
      const observer=onRequest?.(Buffer.byteLength(prompt.instructions+inputText,'utf8'));
      trace=redactedTrace(observer,credential.key);
      const payload={model:selection.model,store:false,max_output_tokens:title?512:validate?2048:8192,reasoning:{effort:selection.reasoningEffort},tools:[],tool_choice:'none',...prompt,...(trace||sourcePage?{stream:true}:{})};
      trace?.request('https://api.openai.com/v1/responses',payload);
      const response=await this.transport('https://api.openai.com/v1/responses',{
        method:'POST',redirect:'error',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential.key}`},
        body:JSON.stringify(payload),
      });
      if(!response.ok) {
        if(trace)await readOpenAIResponse(response,trace).catch(()=>{});else await response.body?.cancel();
        throw new HttpError(response.status===429?429:502,response.status===401?'OpenAI rejected the API key. Replace it in Settings.':response.status===429?'OpenAI quota or rate limit reached. Check your OpenAI account.':'OpenAI could not complete the request. Check API permissions, model access, and billing.');
      }
      const safeDelta=(delta:string,receive:(delta:string)=>void)=>{
        if(controller.signal.aborted||this.clock()>=Date.parse(credential.expiresAt)||this.preferenceRevision!==preferenceRevision)throw new HttpError(409,'AI generation was stopped or its settings changed.');
        receive(delta.split(credential.key).join('[redacted]').replace(/sk-[A-Za-z0-9_-]{16,}/g,'[redacted]'));
      };
      const result=await readOpenAIResponse(response,trace,sourcePage?delta=>safeDelta(delta,sourcePage.onDelta):undefined,
        sourcePage?.onPreviewDelta?{onDelta:delta=>safeDelta(delta,sourcePage.onPreviewDelta!),onReset:()=>sourcePage.onPreviewReset?.()}:undefined,observer?.usage);
      const summary=responseOutputText(result).trim();
      if(result.status!=='completed'||!summary||summary.length>(sourcePage?60000:12000))throw new HttpError(502,'OpenAI returned an incomplete response. Try a lower reasoning effort or a shorter page.');
      if(controller.signal.aborted||this.credential()?.generation!==credential.generation||this.preferenceRevision!==preferenceRevision)throw new HttpError(409,'The credential or AI settings changed, or the key expired. Please try again.');
      // Defense in depth against accidental credential echo by an upstream service.
      return summary.split(credential.key).join('[redacted]').replace(/sk-[A-Za-z0-9_-]{16,}/g,'[redacted]');
    }catch(error) {
      trace?.error(error instanceof Error?error.message:'AI request failed.');
      if(error instanceof HttpError)throw error;
      throw new HttpError(502,'The AI request failed or timed out. Please try again.');
    }finally {clearTimeout(timer);sourcePage?.signal.removeEventListener('abort',abort);this.generationRequests.delete(controller);if(this.active===controller)this.active=null;}
  }
}
