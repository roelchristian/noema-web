import {sourceMathInstructions} from './source-math.js';
import { sourcePagePrompt } from './source-page-prompt.js';
import type { AIDebugTrace, AIRequestObserver } from './ai-debug.js';
import { readOpenAIResponse, redactedTrace, responseOutputText } from './openai-response.js';
import { explanationPrompt } from './explanation-prompt.js';
import { entityScanPrompt } from './entity-scan.js';
import { titlePrompt } from './title-prompt.js';
import { summaryPrompt } from './summary-prompt.js';
import { pageEnrichmentPrompt, parsePageEnrichment, type PageEnrichmentOptions } from './page-enrichment-prompt.js';
import type {SourceAuthor} from './source-authors.js';
import { sourceEnrichmentPrompt, sourceAuthorsPrompt } from './source-enrichment-prompt.js';
import { limitSummaryWords } from '../../shared/summary-text.js';
import { pageLanguage } from './page-language.js';
import { defaultIntelligencePreferences, defaultPageEnrichmentPreferences, defaultManualRequestsPerMinute, maxManualRequestsPerMinute, validManualRequestLimit, intelligenceModels, type IntelligenceConfiguration, supportedIntelligencePreferences, type IntelligencePreferences } from '../../shared/intelligence.js';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {sourceStructureKinds,type IntelligenceStatus,type SourceStructureNode} from '../../shared/domain.js';
import {isSectionKind,semanticBlockLabel} from './source-structure.js';
import { Store } from '../store.js';
import { HttpError } from '../validation.js';

export const embeddingBatchMaxInputs=16;
export const embeddingBatchMaxBytes=64000;
/** Local scheduling contention: no provider request was sent. */
export class EmbeddingAdmissionError extends HttpError {
  constructor(message:string,public retryAfterMs:number) {super(429,message);this.name='EmbeddingAdmissionError';}
}

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
  private backgroundEmbeddingAttempts: number[]=[];
  private backgroundEmbeddingRequests=new Set<AbortController>();
  private attempts: number[]=[];
  private manualRequestsPerMinute=defaultManualRequestsPerMinute;
  private preferences: IntelligencePreferences={...defaultIntelligencePreferences};
  private preferenceRevision=0;
  private enrichmentPreferences: IntelligencePreferences={...defaultPageEnrichmentPreferences};
  constructor(private secrets: SecretStore, private transport: typeof fetch=fetch, private clock=()=>Date.now(), private preferenceStore?: PreferencesStore) {
    const saved=preferenceStore?.read();
    if(supportedIntelligencePreferences(saved)) {
      this.preferences={model:saved.model,reasoningEffort:saved.reasoningEffort};
      if ('pageEnrichment' in saved && supportedIntelligencePreferences(saved.pageEnrichment)) this.enrichmentPreferences={model:saved.pageEnrichment.model,reasoningEffort:saved.pageEnrichment.reasoningEffort};
      if ('manualRequestsPerMinute' in saved && validManualRequestLimit(saved.manualRequestsPerMinute)) this.manualRequestsPerMinute=saved.manualRequestsPerMinute;
    }
  }
  selection(): IntelligencePreferences {return {...this.preferences};}
  savePreferences(body: Record<string,unknown>) {
    if(!supportedIntelligencePreferences(body))throw new HttpError(400,'Choose a supported model and reasoning effort.');
    const manualRequestsPerMinute=body.manualRequestsPerMinute === undefined ? this.manualRequestsPerMinute : body.manualRequestsPerMinute;
    if (!validManualRequestLimit(manualRequestsPerMinute)) throw new HttpError(400,`Choose between 1 and ${maxManualRequestsPerMinute} manual AI requests per minute.`);
    if(body.pageEnrichment!==undefined&&!supportedIntelligencePreferences(body.pageEnrichment))throw new HttpError(400,'Choose a supported page enrichment model and reasoning effort.');
    const pageEnrichment=body.pageEnrichment===undefined?this.enrichmentSelection():body.pageEnrichment as IntelligencePreferences;
    const value={model:body.model,reasoningEffort:body.reasoningEffort,manualRequestsPerMinute,pageEnrichment};
    this.preferenceStore?.write(value);
    const modelChanged=value.model!==this.preferences.model || value.reasoningEffort!==this.preferences.reasoningEffort||pageEnrichment.model!==this.enrichmentPreferences.model||pageEnrichment.reasoningEffort!==this.enrichmentPreferences.reasoningEffort;
    this.preferences={model:value.model,reasoningEffort:value.reasoningEffort};
    this.enrichmentPreferences={model:pageEnrichment.model,reasoningEffort:pageEnrichment.reasoningEffort};
    this.manualRequestsPerMinute=manualRequestsPerMinute;
    if (modelChanged) {this.preferenceRevision++;for(const request of this.generationRequests)request.abort();}
    return {...this.selection(),manualRequestsPerMinute:this.manualRequestsPerMinute,pageEnrichment:this.enrichmentSelection()};
  }
  private credential() {
    const value=this.secrets.read();
    if(value && Date.parse(value.expiresAt)<=this.clock()) {this.remove();return null;}
    return value;
  }
  status(): IntelligenceStatus {
    const value=this.credential();
    return {configured:!!value,expiresAt:value?.expiresAt ?? null,manualRequestsPerMinute:this.manualRequestsPerMinute,...this.selection(),pageEnrichment:this.enrichmentSelection()};
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
  remove() {for(const request of this.generationRequests)request.abort();for(const request of this.embeddingRequests)request.abort();this.secrets.remove();return {configured:false,expiresAt:null,manualRequestsPerMinute:this.manualRequestsPerMinute,...this.selection(),pageEnrichment:this.enrichmentSelection()};}
  purgeExpired() {this.credential();}
  private reserveManualRequest(embedding=false) {
    const now=this.clock();
    this.attempts=this.attempts.filter(time=>time>now-60000);
    if (this.attempts.length>=this.manualRequestsPerMinute) {
      const seconds=Math.max(1,Math.ceil((this.attempts[this.attempts.length-this.manualRequestsPerMinute]!+60000-now)/1000));
      const message=`Manual AI requests are limited to ${this.manualRequestsPerMinute} per minute. Try again in ${seconds} seconds.`;
      if(embedding)throw new EmbeddingAdmissionError(message,seconds*1000);
      throw new HttpError(429,message);
    }
    this.attempts.push(now);
  }
  async embed(input: string, onRequest?: AIRequestObserver, background=false): Promise<{embedding:number[];tokens:number}> {
    const result=await this.embedBatch([input],onRequest,background);
    return {embedding:result.embeddings[0]!,tokens:result.tokens};
  }
  async embedBatch(inputs:string[],onRequest?:AIRequestObserver,background=false):Promise<{embeddings:number[][];tokens:number}> {
    if(!Array.isArray(inputs)||inputs.length===0||inputs.length>embeddingBatchMaxInputs)throw new HttpError(400,`Embedding batches must contain between 1 and ${embeddingBatchMaxInputs} inputs.`);
    if(inputs.some(input=>typeof input!=='string'||!input.trim()||Buffer.byteLength(input,'utf8')>8000))throw new HttpError(400,'Embedding input must contain text and be at most 8,000 UTF-8 bytes.');
    const bytes=inputs.reduce((total,input)=>total+Buffer.byteLength(input,'utf8'),0);
    // UTF-8 bytes conservatively bound tokens for both each input and the batch.
    if(bytes>embeddingBatchMaxBytes)throw new HttpError(400,`Embedding batches must be at most ${embeddingBatchMaxBytes.toLocaleString('en-US')} UTF-8 bytes.`);
    const credential=this.credential();
    if(!credential)throw new HttpError(409,'Add an API key in Settings → Intelligence. It may have expired.');
    const now=this.clock();
    this.embeddingAttempts=this.embeddingAttempts.filter(time=>time>now-60000);
    this.backgroundEmbeddingAttempts=this.backgroundEmbeddingAttempts.filter(time=>time>now-60000);
    const rateWait=Math.max(
      this.embeddingAttempts.length>=30?this.embeddingAttempts[0]!+60000-now:0,
      background&&this.backgroundEmbeddingAttempts.length>=25?this.backgroundEmbeddingAttempts[0]!+60000-now:0,
    );
    // Keep five requests per minute and one active slot available to foreground work.
    if(rateWait>0||this.embeddingRequests.size>=2||background&&this.backgroundEmbeddingRequests.size>=1)throw new EmbeddingAdmissionError('Embedding request limit reached. Try again shortly.',Math.max(1000,rateWait));
    if(!background)this.reserveManualRequest(true);
    this.embeddingAttempts.push(now);
    if(background)this.backgroundEmbeddingAttempts.push(now);
    const controller=new AbortController();this.embeddingRequests.add(controller);
    if(background)this.backgroundEmbeddingRequests.add(controller);
    const timer=setTimeout(()=>controller.abort(),Math.min(45000,Date.parse(credential.expiresAt)-this.clock()));
    let trace: AIDebugTrace | undefined;
    try {
      const observer=onRequest?.(bytes);
      trace=redactedTrace(observer,credential.key);
      const payload={model:'text-embedding-3-small',input:inputs,encoding_format:'float',dimensions:1536};
      trace?.request('https://api.openai.com/v1/embeddings',payload);
      const response=await this.transport('https://api.openai.com/v1/embeddings',{
        method:'POST',redirect:'error',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential.key}`},
        body:JSON.stringify(payload),
      });
      if(!response.ok){if(trace)await readOpenAIResponse(response,trace).catch(()=>{});else await response.body?.cancel();throw new HttpError(response.status===429?429:502,response.status===401?'OpenAI rejected the API key. Replace it in Settings.':response.status===429?'OpenAI quota or rate limit reached. Check your OpenAI account.':'OpenAI could not create the embedding. Check API permissions and billing.');}
      const result=await readOpenAIResponse(response,trace,undefined,undefined,observer?.usage);
      if(result.model!=='text-embedding-3-small'||!Array.isArray(result.data)||result.data.length!==inputs.length)throw new HttpError(502,'OpenAI returned invalid embeddings.');
      const embeddings:number[][]=new Array(inputs.length),seen=new Set<number>();
      for(const item of result.data) {
        const index=item?.index,vector=item?.embedding;
        if(!Number.isSafeInteger(index)||index<0||index>=inputs.length||seen.has(index)||!Array.isArray(vector)||vector.length!==1536||vector.some((value:unknown)=>typeof value!=='number'||!Number.isFinite(value))||!vector.some((value:number)=>value!==0))throw new HttpError(502,'OpenAI returned invalid embeddings.');
        seen.add(index);embeddings[index]=vector;
      }
      if(controller.signal.aborted||this.credential()?.generation!==credential.generation)throw new HttpError(409,'The credential changed or expired. Please try again.');
      return {embeddings,tokens:Number.isSafeInteger(result.usage?.total_tokens)&&result.usage.total_tokens>=0?result.usage.total_tokens:0};
    }catch(error){trace?.error(error instanceof Error?error.message:'Embedding request failed.');if(error instanceof HttpError)throw error;throw new HttpError(502,'The embedding request failed or timed out. Please try again.');}
    finally{clearTimeout(timer);this.embeddingRequests.delete(controller);this.backgroundEmbeddingRequests.delete(controller);}
  }
  enrichmentSelection(): IntelligencePreferences {return {...this.enrichmentPreferences};}
  async generatePageEnrichment(input:string,options:PageEnrichmentOptions,onRequest?:AIRequestObserver,background=false) {
    // Build/validate field selection before reserving a request or reading credentials.
    pageEnrichmentPrompt(input,options);
    const output=await this.generate(input,false,onRequest,false,false,false,undefined,background,undefined,false,options);
    return parsePageEnrichment(output,options);
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
  async generatePageUtility(input:string,domains:{id:string;name:string}[],currentTitle:string,onRequest?:AIRequestObserver,background=false) {
    const output=await this.generate(input,false,onRequest,true,false,false,{domains,currentTitle},background);
    let value:unknown;try{value=JSON.parse(output);}catch{throw new HttpError(502,'AI returned invalid title and subject data.');}
    if(!value||typeof value!=='object'||!('title' in value)||typeof value.title!=='string'||!value.title.trim()||value.title.length>(currentTitle.trim()&&currentTitle.trim()!=='Untitled'?500:120)||/[\r\n]/.test(value.title)||value.title==='Untitled'||!('primaryDomainId' in value)||!(value.primaryDomainId===null||typeof value.primaryDomainId==='string'&&domains.some(domain=>domain.id===value.primaryDomainId))||!('secondaryDomainIds' in value)||!Array.isArray(value.secondaryDomainIds)||value.secondaryDomainIds.length>2||value.secondaryDomainIds.some(id=>typeof id!=='string'||!domains.some(domain=>domain.id===id)))throw new HttpError(502,'AI returned invalid title and subject data.');
    return {title:currentTitle.trim()&&currentTitle.trim()!=='Untitled'?currentTitle:value.title.trim(),primaryDomainId:value.primaryDomainId as string|null,secondaryDomainIds:[...new Set(value.secondaryDomainIds as string[])].filter(id=>id!==value.primaryDomainId)};
  }
  async enrichSource(input:string,onRequest?:AIRequestObserver) {
    const output=await this.generate(input,false,onRequest,false,false,false,undefined,true,undefined,true);
    try {
      const value=JSON.parse(output);
      if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.length>200||/[\r\n\x00-\x1f]/.test(value.name)||typeof value.summary!=='string'||!value.summary.trim()||!('language' in value))throw new Error();
      const authors=parseSourceAuthors(value.authors);
      if(!Array.isArray(value.structure)||value.structure.length>100)throw new Error();
      const supplied=new Map([...input.matchAll(/^\[L(\d+)\] (.*)$/gm)].map(match=>[Number(match[1]),match[2]!.trim().replace(/^#{1,6}\s+|\s+#+$/g,'')]));
      const structure:SourceStructureNode[]=[];
      for(const node of value.structure) {
        if(!node||!Number.isSafeInteger(node.startLine)||!sourceStructureKinds.includes(node.kind??'heading'))throw new Error();
        const kind=node.kind??'heading',section=isSectionKind(kind);
        if(section&&(!Number.isInteger(node.level)||node.level<1||node.level>6))throw new Error();
        if(!section&&(!Number.isSafeInteger(node.endLine)||node.endLine<node.startLine))throw new Error();
        // Never accept a range over omitted excerpts or echo text through the model.
        const text=supplied.get(node.startLine);
        if(!text||section&&text.length>240||text.startsWith('<!--')||structure.some(marker=>marker.startLine===node.startLine))continue;
        if(!section) {
          if(node.endLine-node.startLine>=supplied.size)continue;
          let complete=true;
          for(let line=node.startLine;line<=node.endLine;line++)if(!supplied.has(line)){complete=false;break;}
          if(!complete)continue;
        }
        structure.push({text:section?text:semanticBlockLabel(text)?.label??kind,kind,startLine:node.startLine,...(section?{level:node.level}:{endLine:node.endLine})});
      }
      return {name:value.name.trim(),language:pageLanguage(value.language),summary:limitSummaryWords(value.summary),authors,structure};
    }catch {throw new HttpError(502,'AI returned invalid source metadata. Retry enrichment.');}
  }
  async extractSourceAuthors(input:string,onRequest?:AIRequestObserver) {
    const output=await this.generate(input,false,onRequest,false,false,false,undefined,true,undefined,'authors');
    try{return parseSourceAuthors(JSON.parse(output)?.authors);}
    catch{throw new HttpError(502,'AI returned invalid source authors. Retry enrichment.');}
  }
  async generate(input: string, validate=false, onRequest?: AIRequestObserver, title=false, entityScan=false, explain=false, utility?:{domains:{id:string;name:string}[];currentTitle:string}, background=false,sourcePage?:{onDelta:(delta:string)=>void;signal:AbortSignal;onPreviewDelta?:(delta:string)=>void;onPreviewReset?:()=>void;mathPreparation?:boolean},sourceEnrichment:boolean|'authors'=false,enrichment?:PageEnrichmentOptions,entityStream?:{onDelta:(delta:string)=>void;signal:AbortSignal}) {
    const credential=this.credential(),selection=enrichment?this.enrichmentSelection():title?this.titleSelection():this.selection(),preferenceRevision=this.preferenceRevision;
    if(!credential)throw new HttpError(409,'Add an API key in Settings → Intelligence. It may have expired.');
    if(!title&&!entityScan&&!enrichment&&this.active)throw new HttpError(429,'Another AI request is running. Please wait.');
    if (!background) this.reserveManualRequest();
    const controller=new AbortController();this.generationRequests.add(controller);if(!title&&!entityScan&&!enrichment)this.active=controller;
    const abort=()=>controller.abort();
    const requestSignal=entityStream?.signal??sourcePage?.signal??enrichment?.signal;
    requestSignal?.addEventListener('abort',abort,{once:true});
    if(requestSignal?.aborted)controller.abort();
    const timer=setTimeout(()=>controller.abort(),Math.min(sourcePage?180000:45000,Date.parse(credential.expiresAt)-this.clock()));
    let trace: AIDebugTrace | undefined;
    try {
      const prompt=sourcePage?.mathPreparation?{instructions:sourceMathInstructions,input:[{role:'user' as const,content:[{type:'input_text' as const,text:input}]}]}:enrichment?pageEnrichmentPrompt(input,enrichment):sourceEnrichment==='authors'?sourceAuthorsPrompt(input):sourceEnrichment?sourceEnrichmentPrompt(input):sourcePage?sourcePagePrompt(input):validate?{instructions:'Reply with OK.',input:'Connection test.'}:title?titlePrompt(input,utility?.domains,utility?.currentTitle):entityScan?entityScanPrompt(input):explain?explanationPrompt(input):summaryPrompt(input);
      const inputText=typeof prompt.input==='string'?prompt.input:prompt.input.flatMap(item=>item.content.map(part=>part.text)).join('');
      const observer=onRequest?.(Buffer.byteLength(prompt.instructions+inputText,'utf8'));
      trace=redactedTrace(observer,credential.key);
      const payload={model:selection.model,store:false,max_output_tokens:enrichment?(selection.reasoningEffort!=='none'?4096:enrichment.requestedFields.includes('summary')?768:384):title?512:validate?2048:8192,reasoning:{effort:selection.reasoningEffort},tools:[],tool_choice:'none',...prompt,...(trace||sourcePage||entityStream?{stream:true}:{})};
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
      const result=await readOpenAIResponse(response,trace,entityStream?delta=>safeDelta(delta,entityStream.onDelta):sourcePage?delta=>safeDelta(delta,sourcePage.onDelta):undefined,
        sourcePage?.onPreviewDelta?{onDelta:delta=>safeDelta(delta,sourcePage.onPreviewDelta!),onReset:()=>sourcePage.onPreviewReset?.()}:undefined,observer?.usage);
      const summary=responseOutputText(result).trim();
      if(result.status!=='completed'||!summary||summary.length>(sourcePage?60000:sourceEnrichment===true?20000:12000))throw new HttpError(502,'OpenAI returned an incomplete response. Try a lower reasoning effort or a shorter page.');
      if(controller.signal.aborted||this.credential()?.generation!==credential.generation||this.preferenceRevision!==preferenceRevision)throw new HttpError(409,'The credential or AI settings changed, or the key expired. Please try again.');
      // Defense in depth against accidental credential echo by an upstream service.
      return summary.split(credential.key).join('[redacted]').replace(/sk-[A-Za-z0-9_-]{16,}/g,'[redacted]');
    }catch(error) {
      trace?.error(error instanceof Error?error.message:'AI request failed.');
      if(error instanceof HttpError)throw error;
      throw new HttpError(502,'The AI request failed or timed out. Please try again.');
    }finally {clearTimeout(timer);requestSignal?.removeEventListener('abort',abort);this.generationRequests.delete(controller);if(this.active===controller)this.active=null;}
  }
}
