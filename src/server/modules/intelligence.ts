import {defaultNarrationPreferences,parseNarrationPreferences,type NarrationPreferences} from '../../shared/narration.js';
import {transformNarration} from '../../shared/narration-text.js';
import {appendSpeechSilence} from './speech-silence.js';
import {geminiApiKeyMaxLength,defaultSpeechVoice,defaultSpeechProvider,defaultSpeechVoiceFor,isSpeechProvider,isSpeechVoice,speechModelFor,type SpeechProvider,type SpeechVoice} from '../../shared/intelligence.js';
import {cleanSpeechText} from '../../shared/speech-text.js';
import {realtimeSpeech,createSpeechSocket,speechEndpoint as openAISpeechEndpoint,type SpeechSocketFactory} from './realtime-speech.js';
import {geminiSpeech,geminiSpeechEndpoint} from './gemini-speech.js';
import {kokoroSpeech} from './kokoro-speech.js';
export const speechEndpoint='local://kokoro-82m';
export type SpeechSynthesizer=(text:string,signal:AbortSignal,voice:SpeechVoice,pace?:number)=>Promise<Buffer>;
import {defaultPersonaId,isPersonaId,defaultPersonaExpression,parsePersonaExpression,type PersonaExpression,type BuiltinPersonaId} from '../../shared/ai-personas.js';
import {resolvePersona} from './ai-personas.js';
import {generationPolicy,type GenerationRequest} from './generation-request.js';
import {EntityScanBatchReady} from './entity-scan-stream.js';
export type {GenerationRequest} from './generation-request.js';
import type { AIDebugTrace, AIRequestObserver } from './ai-debug.js';
import { readOpenAIResponse, redactedTrace, responseOutputText } from './openai-response.js';
import { pageEnrichmentPrompt, parsePageEnrichment, type PageEnrichmentOptions } from './page-enrichment-prompt.js';
import type {SourceAuthor} from './source-authors.js';
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
/** Central admission rejected the request before any provider transport. */
export class GenerationAdmissionError extends HttpError {
  readonly code='local_admission';
  constructor(message:string) {super(429,message);this.name='GenerationAdmissionError';}
}
/** Preserve the provider HTTP outcome without retaining its body or credentials. */
export class GenerationProviderError extends HttpError {
  readonly code='provider_http';
  constructor(public providerStatus:number,message:string) {super(providerStatus===429?429:502,message);this.name='GenerationProviderError';}
}
/** A received provider response failed to produce usable output; distinct from settings errors. */
export class GenerationResponseError extends HttpError {
  readonly outcomeUncertain=false;
  constructor(public code:'provider_incomplete_output'|'provider_output_limit'|'provider_empty_output'|'provider_content_filter'|'provider_response_failed'|'provider_output_too_large') {
    super(502,{
      provider_incomplete_output:'The AI provider returned an incomplete response. Retry unfinished work.',
      provider_output_limit:'The AI response reached its output token limit before finishing. Retry unfinished work to use a larger response budget.',
      provider_empty_output:'The AI returned no usable text. Retry unfinished work.',
      provider_content_filter:'The AI provider stopped this response because of its content filter.',
      provider_response_failed:'The AI provider did not complete this response.',
      provider_output_too_large:'The AI response exceeded the local output size limit.',
    }[code]);this.name='GenerationResponseError';
  }
}
/** A transport interruption cannot prove whether the provider completed/billed work. */
export class GenerationTransportError extends HttpError {
  readonly outcomeUncertain=true;
  constructor(public code:'timeout'|'provider_transport') {super(502,code==='timeout'?'The AI transport deadline elapsed. The provider outcome is unknown.':'The AI connection failed. The provider outcome is unknown.');this.name='GenerationTransportError';}
}
/** Cancelling locally does not establish whether dispatched provider work completed or billed. */
export class GenerationCancellationError extends HttpError {
  readonly code='cancelled';
  constructor(public outcomeUncertain:boolean) {super(409,outcomeUncertain?'AI generation was stopped after dispatch. The provider outcome is unknown.':'AI generation was stopped before sending the request.');this.name='GenerationCancellationError';}
}

interface Credential { key: string; expiresAt: string; generation: string }
function parseSourceAuthors(value:unknown):SourceAuthor[] {
 if(!Array.isArray(value)||value.length>100||value.some((author:unknown)=>!author||typeof author!=='object'||!('name' in author)||typeof author.name!=='string'||!author.name.trim()||author.name.length>200||/[\x00-\x1f\x7f]/.test(author.name)||!('type' in author)||!['person','organization'].includes(String(author.type))))throw new HttpError(502,'AI returned invalid source authors. Retry enrichment.');
 return (value as SourceAuthor[]).map(author=>({name:author.name.trim().replace(/\s+/g,' '),type:author.type}));
}
export interface SecretStore { read(): Credential | null; write(value: Credential): void; remove(): void }
// The credential never enters SQLite, browser storage, command arguments, or logs.
export class MacKeychain implements SecretStore {
  constructor(private account: string, private execute: typeof spawnSync=spawnSync,private provider:'openai'|'gemini'='openai') {
    if(!/^[a-f0-9-]{36}$/.test(account))throw new Error('Invalid intelligence account');
  }
  private run(args: string[], input?: string) {
    if(process.platform !== 'darwin')throw new HttpError(503,'Secure key storage requires macOS Keychain. Intelligence is disabled on this system.');
    const result=this.execute('/usr/bin/security',args,{input,encoding:'utf8',timeout:15000,maxBuffer:16384});
    if(result.error || result.signal || (result.status!==0 && result.status!==44))throw new HttpError(503,'Keychain is unavailable. Unlock your login keychain and try again.');
    return result;
  }
  read(): Credential | null {
    const result=this.run(['find-generic-password','-a',this.account,'-s',`app.noema.${this.provider}`,'-w']);
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
    const result=this.run(['-i'],`add-generic-password -U -a ${this.account} -s app.noema.${this.provider} -w ${encoded}\n`);
    if(/error|failed|SecKeychain/i.test(result.stderr)||this.read()?.generation!==value.generation)throw new HttpError(503,'Could not save the credential in Keychain.');
  }
  remove() { this.run(['delete-generic-password','-a',this.account,'-s',`app.noema.${this.provider}`]); }
}
export function keychainFor(store: Store,provider:'openai'|'gemini'='openai') {
  let account=store.get<{value:string}>("SELECT value FROM metadata WHERE key='intelligence_account'")?.value;
  if(!account) {account=randomUUID();store.run("INSERT INTO metadata(key,value) VALUES ('intelligence_account',?)",account);}
  if(!/^[a-f0-9-]{36}$/.test(account))throw new Error('Invalid intelligence account');
  return new MacKeychain(account,spawnSync,provider);
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
  // Editorial shares exclusion with the exclusive slot, but admits two sibling excerpts.
  private editorialRequests=new Set<AbortController>();
  private speechRequests=new Set<AbortController>();
  private speechPreviews=new Map<AbortController,SpeechProvider>();
  private previewAttempts:number[]=[];
  private ttsEnabled=false;
  private narration:NarrationPreferences=structuredClone(defaultNarrationPreferences);
  private narrationRevision=0;
  private ttsProvider:SpeechProvider=defaultSpeechProvider;
  private ttsVoice:SpeechVoice=defaultSpeechVoice;
  private generationRequests=new Set<AbortController>();
  private embeddingRequests=new Set<AbortController>();
  private embeddingAttempts: number[]=[];
  private backgroundEmbeddingAttempts: number[]=[];
  private backgroundEmbeddingRequests=new Set<AbortController>();
  private attempts: number[]=[];
  private manualRequestsPerMinute=defaultManualRequestsPerMinute;
  private preferences: IntelligencePreferences={...defaultIntelligencePreferences};
  private preferenceRevision=0;
  private personaId:BuiltinPersonaId=defaultPersonaId;
  private personaExpression:PersonaExpression=defaultPersonaExpression;
  personaSelection(id:unknown=this.personaId,version?:number,expression?:unknown) {
    let parsed:PersonaExpression|undefined;try{parsed=expression===undefined?undefined:parsePersonaExpression(expression);}catch{throw new HttpError(400,'Choose a supported persona expression.');}
    return resolvePersona(id,version,parsed??this.personaExpression);
  }
  private enrichmentPreferences: IntelligencePreferences={...defaultPageEnrichmentPreferences};
  constructor(private secrets: SecretStore, private transport: typeof fetch=fetch, private clock=()=>Date.now(), private preferenceStore?: PreferencesStore,private speechSynthesizer:SpeechSynthesizer=kokoroSpeech,private speechSocketFactory:SpeechSocketFactory=createSpeechSocket,private geminiSecrets?:SecretStore) {
    const saved=preferenceStore?.read();
    if(supportedIntelligencePreferences(saved)) {
      if('narration' in saved){try{this.narration=parseNarrationPreferences(saved.narration);}catch{/* Invalid persisted options reset to conservative defaults. */}}
      if('ttsProvider' in saved&&isSpeechProvider(saved.ttsProvider))this.ttsProvider=saved.ttsProvider;
      this.ttsVoice=defaultSpeechVoiceFor(this.ttsProvider);
      if('ttsVoice' in saved&&isSpeechVoice(saved.ttsVoice,this.ttsProvider))this.ttsVoice=saved.ttsVoice;
      if('ttsEnabled' in saved && typeof saved.ttsEnabled==='boolean')this.ttsEnabled=saved.ttsEnabled;
      if('personaExpression' in saved){try{this.personaExpression=parsePersonaExpression(saved.personaExpression);}catch{/* Keep new-generation default for invalid preferences. */}}
      if('personaId' in saved&&isPersonaId(saved.personaId))this.personaId=saved.personaId;
      if('personaId' in saved&&saved.personaId==='conyo') {
        this.personaId='divinity_student';
        // Migrate only current preferences; never rewrite generated metadata.
        preferenceStore?.write({...saved,personaId:this.personaId} as IntelligenceConfiguration);
      }
      this.preferences={model:saved.model,reasoningEffort:saved.reasoningEffort};
      if ('pageEnrichment' in saved && supportedIntelligencePreferences(saved.pageEnrichment)) this.enrichmentPreferences={model:saved.pageEnrichment.model,reasoningEffort:saved.pageEnrichment.reasoningEffort};
      if ('manualRequestsPerMinute' in saved && validManualRequestLimit(saved.manualRequestsPerMinute)) this.manualRequestsPerMinute=saved.manualRequestsPerMinute;
    }
  }
  selection(): IntelligencePreferences {return {...this.preferences};}
  editorialImageCapability(){return intelligenceModels.find(model=>model.id===this.selection().model)?.imageInput===true;}
  editorialSelection():IntelligencePreferences {
    const selection=this.selection();
    if(!supportedIntelligencePreferences(selection))throw new HttpError(400,'Choose a supported editorial model and reasoning effort in Settings → Intelligence.');
    return selection;
  }
  savePreferences(body: Record<string,unknown>) {
    if(!supportedIntelligencePreferences(body))throw new HttpError(400,'Choose a supported model and reasoning effort.');
    const manualRequestsPerMinute=body.manualRequestsPerMinute === undefined ? this.manualRequestsPerMinute : body.manualRequestsPerMinute;
    if (!validManualRequestLimit(manualRequestsPerMinute)) throw new HttpError(400,`Choose between 1 and ${maxManualRequestsPerMinute} manual AI requests per minute.`);
    if(body.pageEnrichment!==undefined&&!supportedIntelligencePreferences(body.pageEnrichment))throw new HttpError(400,'Choose a supported page enrichment model and reasoning effort.');
    const pageEnrichment=body.pageEnrichment===undefined?this.enrichmentSelection():body.pageEnrichment as IntelligencePreferences;
    const requestedPersona=body.personaId==='conyo'?'divinity_student':body.personaId;
    if(requestedPersona!==undefined&&!isPersonaId(requestedPersona))throw new HttpError(400,'Choose a supported AI persona.');
    const personaId=requestedPersona===undefined?this.personaId:requestedPersona as BuiltinPersonaId;
    let personaExpression=this.personaExpression;try{if(body.personaExpression!==undefined)personaExpression=parsePersonaExpression(body.personaExpression);}catch{throw new HttpError(400,'Choose a supported persona expression.');}
    if(body.ttsEnabled!==undefined&&typeof body.ttsEnabled!=='boolean')throw new HttpError(400,'Choose whether text to speech is enabled.');
    const ttsEnabled=body.ttsEnabled===undefined?this.ttsEnabled:body.ttsEnabled as boolean;
    if(body.ttsProvider!==undefined&&!isSpeechProvider(body.ttsProvider))throw new HttpError(400,'Choose a supported speech provider.');
    const ttsProvider=body.ttsProvider===undefined?this.ttsProvider:body.ttsProvider as SpeechProvider;
    if(body.ttsVoice!==undefined&&!isSpeechVoice(body.ttsVoice,ttsProvider))throw new HttpError(400,'Choose a supported voice for the speech provider.');
    const providerChanged=ttsProvider!==this.ttsProvider;
    const ttsVoice=body.ttsVoice===undefined?(providerChanged?defaultSpeechVoiceFor(ttsProvider):this.ttsVoice):body.ttsVoice as SpeechVoice;
    const voiceChanged=ttsVoice!==this.ttsVoice;
    const narration=body.narration===undefined?this.narration:this.parseNarration(body.narration);
    const narrationChanged=JSON.stringify(narration)!==JSON.stringify(this.narration);
    const value={personaId,personaExpression,ttsEnabled,ttsProvider,ttsVoice,narration,model:body.model,reasoningEffort:body.reasoningEffort,manualRequestsPerMinute,pageEnrichment};
    this.preferenceStore?.write(value);
    const modelChanged=value.model!==this.preferences.model || value.reasoningEffort!==this.preferences.reasoningEffort||pageEnrichment.model!==this.enrichmentPreferences.model||pageEnrichment.reasoningEffort!==this.enrichmentPreferences.reasoningEffort;
    this.preferences={model:value.model,reasoningEffort:value.reasoningEffort};
    this.enrichmentPreferences={model:pageEnrichment.model,reasoningEffort:pageEnrichment.reasoningEffort};
    this.personaId=personaId;
    this.personaExpression=personaExpression;
    this.ttsEnabled=ttsEnabled;
    this.ttsProvider=ttsProvider;
    this.ttsVoice=ttsVoice;
    this.narration=narration;if(narrationChanged)this.narrationRevision++;
    if(!ttsEnabled||voiceChanged||providerChanged||narrationChanged)for(const request of this.speechRequests)request.abort();
    this.manualRequestsPerMinute=manualRequestsPerMinute;
    if (modelChanged) {this.preferenceRevision++;for(const request of this.generationRequests)request.abort();}
    return {...this.selection(),personaId:this.personaId,personaExpression:this.personaExpression,ttsEnabled:this.ttsEnabled,ttsProvider:this.ttsProvider,ttsVoice:this.ttsVoice,narration:structuredClone(this.narration),manualRequestsPerMinute:this.manualRequestsPerMinute,pageEnrichment:this.enrichmentSelection()};
  }
  /** Merge against live state synchronously: two category updates cannot erase one another. */
  saveCategoryPreferences(category:'ai'|'voice',body:Record<string,unknown>) {
    const fields=category==='ai'?['model','reasoningEffort','personaId','personaExpression','manualRequestsPerMinute','pageEnrichment']:['ttsEnabled','ttsProvider','ttsVoice','narration'];
    if(Object.keys(body).some(field=>!fields.includes(field)))throw new HttpError(400,'Preferences contain fields from another category.');
    return this.savePreferences({...this.selection(),...body});
  }
  private abortCloudPreviews(provider:SpeechProvider) {for(const [request,selected] of this.speechPreviews)if(selected===provider)request.abort();}
  private credential() {
    const value=this.secrets.read();
    if(value && Date.parse(value.expiresAt)<=this.clock()) {this.remove();return null;}
    return value;
  }
  status(): IntelligenceStatus {
    const value=this.credential();
    return {configured:!!value,expiresAt:value?.expiresAt ?? null,manualRequestsPerMinute:this.manualRequestsPerMinute,personaId:this.personaId,personaExpression:this.personaExpression,ttsEnabled:this.ttsEnabled,ttsProvider:this.ttsProvider,ttsVoice:this.ttsVoice,narration:structuredClone(this.narration),...this.selection(),pageEnrichment:this.enrichmentSelection()};
  }
  save(body: Record<string,unknown>) {
    if(typeof body.apiKey!=='string'||!/^sk-[A-Za-z0-9_-]{16,500}$/.test(body.apiKey))throw new HttpError(400,'Enter a valid OpenAI API key.');
    const days=body.days === undefined ? 30 : body.days;
    if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>365)throw new HttpError(400,'Choose a lifetime between 1 and 365 days.');
    this.abortCloudPreviews('openai');
    for(const request of this.generationRequests)request.abort();
    for(const request of this.embeddingRequests)request.abort();
    if(this.ttsProvider==='openai')for(const request of this.speechRequests)request.abort();
    this.secrets.write({key:body.apiKey,expiresAt:new Date(this.clock()+days*86400000).toISOString(),generation:randomUUID()});
    return this.status();
  }
  remove() {this.abortCloudPreviews('openai');if(this.ttsProvider==='openai')for(const request of this.speechRequests)request.abort();for(const request of this.generationRequests)request.abort();for(const request of this.embeddingRequests)request.abort();this.secrets.remove();return {configured:false,expiresAt:null,manualRequestsPerMinute:this.manualRequestsPerMinute,personaId:this.personaId,personaExpression:this.personaExpression,ttsEnabled:this.ttsEnabled,ttsProvider:this.ttsProvider,ttsVoice:this.ttsVoice,narration:structuredClone(this.narration),...this.selection(),pageEnrichment:this.enrichmentSelection()};}
  private geminiCredential() {
    const value=this.geminiSecrets?.read();
    if(value&&Date.parse(value.expiresAt)<=this.clock()){this.geminiSecrets!.remove();this.abortCloudPreviews('gemini');if(this.ttsProvider==='gemini')for(const request of this.speechRequests)request.abort();return null;}
    return value??null;
  }
  geminiStatus() {const value=this.geminiCredential();return {configured:!!value,expiresAt:value?.expiresAt??null};}
  saveGemini(body:Record<string,unknown>) {
    const apiKey=typeof body.apiKey==='string'?body.apiKey.trim():'';
    // Google issues both standard and authorization keys. Treat them as opaque
    // header values rather than assuming the legacy AIza prefix and length.
    if(apiKey.length<16||apiKey.length>geminiApiKeyMaxLength||!/^[\x21-\x7e]+$/.test(apiKey))throw new HttpError(400,'Enter a valid Gemini API key.');
    const days=body.days===undefined?30:body.days;
    if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>365)throw new HttpError(400,'Choose a lifetime between 1 and 365 days.');
    if(!this.geminiSecrets)throw new HttpError(503,'Secure Gemini key storage is unavailable.');
    if(this.ttsProvider==='gemini')for(const request of this.speechRequests)request.abort();
    this.abortCloudPreviews('gemini');
    this.geminiSecrets.write({key:apiKey,expiresAt:new Date(this.clock()+days*86400000).toISOString(),generation:randomUUID()});
    return this.geminiStatus();
  }
  removeGemini() {
    if(!this.geminiSecrets)throw new HttpError(503,'Secure Gemini key storage is unavailable.');
    if(this.ttsProvider==='gemini')for(const request of this.speechRequests)request.abort();
    this.abortCloudPreviews('gemini');
    this.geminiSecrets.remove();return {configured:false,expiresAt:null};
  }
  async validateGemini() {
    const credential=this.geminiCredential();
    if(!credential)throw new HttpError(409,'Add a Gemini API key first.');
    this.reserveManualRequest();
    const controller=new AbortController();this.speechPreviews.set(controller,'gemini');
    const timer=setTimeout(()=>controller.abort(),Math.min(15000,Date.parse(credential.expiresAt)-this.clock()));
    try {
      const response=await this.transport('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(speechModelFor('gemini')),{method:'GET',redirect:'error',signal:controller.signal,headers:{'x-goog-api-key':credential.key}});
      await response.body?.cancel();
      if(controller.signal.aborted||this.geminiCredential()?.generation!==credential.generation)throw new HttpError(409,'Gemini validation was stopped or its credential changed.');
      if(!response.ok)throw new HttpError(response.status===429?429:409,'Gemini could not validate the saved key and speech model access.');
      return {ok:true as const};
    }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(502,'Gemini connection validation failed or timed out.');}
    finally{clearTimeout(timer);this.speechPreviews.delete(controller);}
  }
  purgeExpired() {try{this.credential();}finally{this.geminiCredential();}}
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
  speechEnabled(){return this.ttsEnabled;}
  speechProviderSelection():SpeechProvider{return this.ttsProvider;}
  speechVoiceSelection():SpeechVoice{return this.ttsVoice;}
  narrationSelection(){return structuredClone(this.narration);}
  speechRevision(){return this.narrationRevision;}
  parseNarration(value:unknown){try{return parseNarrationPreferences(value);}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid narration preferences.');}}
  async previewSpeech(body:Record<string,unknown>,signal?:AbortSignal,onRequest?:AIRequestObserver):Promise<Buffer> {
    if(Object.keys(body).some(field=>!['text','provider','voice','narration'].includes(field)))throw new HttpError(400,'Unsupported speech preview input.');
    if(!isSpeechProvider(body.provider)||!isSpeechVoice(body.voice,body.provider))throw new HttpError(400,'Choose a supported speech provider and voice.');
    if(typeof body.text!=='string'||body.text.length>500)throw new HttpError(400,'Speech previews require at most 500 characters.');
    const narration=this.parseNarration(body.narration);
    const now=this.clock();this.previewAttempts=this.previewAttempts.filter(time=>time>now-60000);
    if(this.previewAttempts.length>=5)throw new HttpError(429,'Speech previews are limited to five per minute.');
    // Count attempts, including cancelled work, to bound repeated audition flows.
    this.previewAttempts.push(now);
    return this.speech(body.text,signal,onRequest,{narration,preview:{provider:body.provider,voice:body.voice}});
  }
  async speech(text:unknown,signal?:AbortSignal,onRequest?:AIRequestObserver,options:{narration?:NarrationPreferences;pauseAfterMs?:number;protectedText?:boolean;preview?:{provider:SpeechProvider;voice:SpeechVoice}}={}):Promise<Buffer> {
    if(!options.preview&&!this.ttsEnabled)throw new HttpError(409,'Enable text to speech in Settings → Intelligence.');
    if(typeof text!=='string')throw new HttpError(400,'Speech requires text of at most 4,096 characters.');
    const narration=options.narration===undefined?this.narration:this.parseNarration(options.narration),revision=this.narrationRevision;
    const pauseAfterMs=options.pauseAfterMs??0;
    if(!Number.isInteger(pauseAfterMs)||pauseAfterMs<0||pauseAfterMs>3000)throw new HttpError(400,'Pause must be between 0 and 3,000 milliseconds.');
    if(text.length>4096)throw new HttpError(400,'Speech requires text of at most 4,096 characters.');
    let narratedText:string;try{narratedText=options.protectedText?text:transformNarration(text,narration);}catch{throw new HttpError(400,'Reading rules expanded this section too far. Select a shorter section or shorten pronunciations.');}
    const cleanText=cleanSpeechText(narratedText),voice=options.preview?.voice??this.ttsVoice,provider=options.preview?.provider??this.ttsProvider,model=speechModelFor(provider);
    if(!cleanText||cleanText.length>4096)throw new HttpError(400,'Speech requires text of at most 4,096 characters.');
    if(options.preview&&cleanText.length>500)throw new HttpError(400,'Speech previews require at most 500 characters after reading rules.');
    if(this.speechRequests.size||this.speechPreviews.size)throw new HttpError(429,'Another speech request is running. Please wait.');
    if(signal?.aborted)throw new HttpError(409,'Speech request cancelled.');
    const credential=provider==='gemini'?this.geminiCredential():provider==='openai'?this.credential():null;
    if(provider==='openai'&&!credential)throw new HttpError(409,'Add an API key in Settings → Intelligence to use OpenAI speech. It may have expired.');
    if(provider==='gemini'&&!credential)throw new HttpError(409,'Add a Gemini API key in Settings → Intelligence to use Gemini speech. It may have expired.');
    if(provider!=='kokoro')this.reserveManualRequest();
    const controller=new AbortController();if(options.preview)this.speechPreviews.set(controller,provider);else this.speechRequests.add(controller);
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,credential?Math.min(60000,Date.parse(credential.expiresAt)-this.clock()):180000);
    let trace:AIDebugTrace|undefined;
    try {
      const observer=onRequest?.(Buffer.byteLength(cleanText,'utf8'));
      trace=redactedTrace(observer,credential?.key??'');
      // Audio payloads and selected text never enter debug storage, including full mode.
      trace?.request(provider==='gemini'?geminiSpeechEndpoint:provider==='openai'?openAISpeechEndpoint:speechEndpoint,{model,provider,voice,response_format:'wav',inputCharacters:cleanText.length});
      const audio=provider==='gemini'
        ?await geminiSpeech(cleanText,credential!.key,controller.signal,this.transport,voice,observer||undefined,narration)
        :provider==='openai'
        ?await realtimeSpeech(cleanText,credential!.key,controller.signal,this.speechSocketFactory,observer||undefined,voice,narration)
        :await this.speechSynthesizer(cleanText,controller.signal,voice,narration.pace);
      if(controller.signal.aborted||(!options.preview&&(revision!==this.narrationRevision||!this.ttsEnabled||this.ttsVoice!==voice||this.ttsProvider!==provider))||(credential&&(provider==='gemini'?this.geminiCredential():this.credential())?.generation!==credential.generation))throw new HttpError(409,'Speech was stopped or its settings changed.');
      trace?.response({model,provider,format:'wav',audioBytes:audio.length});
      return appendSpeechSilence(audio,pauseAfterMs);
    } catch(error) {
      trace?.error(error instanceof HttpError?error.message:'Speech request failed or timed out.');
      if(error instanceof HttpError)throw error;
      throw new HttpError(controller.signal.aborted?409:502,controller.signal.aborted?'Speech request stopped or timed out.':'The speech request failed. Please try again.');
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);this.speechRequests.delete(controller);this.speechPreviews.delete(controller);}
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
      // Float JSON grows with the number of returned dimensions, not input bytes.
      // Allow 32 bytes per number plus envelope overhead, bounded by the batch cap.
      const maxJsonBytes=Math.max(128000,16000+inputs.length*1536*32);
      const result=await readOpenAIResponse(response,trace,undefined,undefined,observer?.usage,{maxJsonBytes});
      if(result.model!=='text-embedding-3-small'||!Array.isArray(result.data)||result.data.length!==inputs.length){trace?.event('validation',{stage:'embedding',valid:false,category:'shape',expectedCount:inputs.length,actualCount:Array.isArray(result.data)?result.data.length:null});throw new HttpError(502,'OpenAI returned invalid embeddings.');}
      const embeddings:number[][]=new Array(inputs.length),seen=new Set<number>();
      for(const item of result.data) {
        const index=item?.index,vector=item?.embedding;
        if(!Number.isSafeInteger(index)||index<0||index>=inputs.length||seen.has(index)||!Array.isArray(vector)||vector.length!==1536||vector.some((value:unknown)=>typeof value!=='number'||!Number.isFinite(value))||!vector.some((value:number)=>value!==0)){trace?.event('validation',{stage:'embedding',valid:false,category:'vector',index:Number.isSafeInteger(index)?index:null,actualDimensions:Array.isArray(vector)?vector.length:null,expectedDimensions:1536});throw new HttpError(502,'OpenAI returned invalid embeddings.');}
        seen.add(index);embeddings[index]=vector;
      }
      if(controller.signal.aborted||this.credential()?.generation!==credential.generation)throw new HttpError(409,'The credential changed or expired. Please try again.');
      trace?.event('validation',{stage:'embedding',valid:true,vectorCount:embeddings.length,dimensions:1536});
      return {embeddings,tokens:Number.isSafeInteger(result.usage?.total_tokens)&&result.usage.total_tokens>=0?result.usage.total_tokens:0};
    }catch(error){trace?.error(error instanceof Error?error.message:'Embedding request failed.');if(error instanceof HttpError)throw error;throw new HttpError(502,'The embedding request failed or timed out. Please try again.');}
    finally{clearTimeout(timer);this.embeddingRequests.delete(controller);this.backgroundEmbeddingRequests.delete(controller);}
  }
  enrichmentSelection(): IntelligencePreferences {return {...this.enrichmentPreferences};}
  async generatePageEnrichment(input:string,options:PageEnrichmentOptions,onRequest?:AIRequestObserver,background=false) {
    // Build/validate field selection before reserving a request or reading credentials.
    pageEnrichmentPrompt(input,options);
    const {signal,...fields}=options;
    return this.validatedGeneration({kind:'pageEnrichment',input,options:fields,onRequest,background,signal},output=>parsePageEnrichment(output,options));
  }
  titleSelection(): IntelligencePreferences {
    const model=intelligenceModels.find(option=>option.id===this.preferences.model)?.efforts.includes('none') ? this.preferences.model : 'gpt-6-luna';
    return {model,reasoningEffort:'none'};
  }
  async generateTitle(input: string, onRequest?: AIRequestObserver) {
    return this.validatedGeneration({kind:'title',input,onRequest},title=>{
    if(title.length>120 || /[\r\n]/.test(title) || title==='Untitled')throw new HttpError(502,'OpenAI returned an invalid page title.');
    return title;
    });
  }
  async generatePageUtility(input:string,domains:{id:string;name:string}[],currentTitle:string,onRequest?:AIRequestObserver,background=false) {
    return this.validatedGeneration({kind:'utility',input,domains,currentTitle,onRequest,background},output=>{
    let value:unknown;try{value=JSON.parse(output);}catch{throw new HttpError(502,'AI returned invalid title and subject data.');}
    if(!value||typeof value!=='object'||!('title' in value)||typeof value.title!=='string'||!value.title.trim()||value.title.length>(currentTitle.trim()&&currentTitle.trim()!=='Untitled'?500:120)||/[\r\n]/.test(value.title)||value.title==='Untitled'||!('primaryDomainId' in value)||!(value.primaryDomainId===null||typeof value.primaryDomainId==='string'&&domains.some(domain=>domain.id===value.primaryDomainId))||!('secondaryDomainIds' in value)||!Array.isArray(value.secondaryDomainIds)||value.secondaryDomainIds.length>2||value.secondaryDomainIds.some(id=>typeof id!=='string'||!domains.some(domain=>domain.id===id)))throw new HttpError(502,'AI returned invalid title and subject data.');
    return {title:currentTitle.trim()&&currentTitle.trim()!=='Untitled'?currentTitle:value.title.trim(),primaryDomainId:value.primaryDomainId as string|null,secondaryDomainIds:[...new Set(value.secondaryDomainIds as string[])].filter(id=>id!==value.primaryDomainId)};
    });
  }
  async enrichSource(input:string,onRequest?:AIRequestObserver) {
    return this.validatedGeneration({kind:'sourceEnrichment',input,onRequest,background:true},output=>{
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
    });
  }
  async extractSourceAuthors(input:string,onRequest?:AIRequestObserver) {
    return this.validatedGeneration({kind:'sourceAuthors',input,onRequest,background:true},output=>{
    try{return parseSourceAuthors(JSON.parse(output)?.authors);}
    catch{throw new HttpError(502,'AI returned invalid source authors. Retry enrichment.');}
    });
  }
  async reeditSource(input:string,instructions:string,signal:AbortSignal,onRequest?:AIRequestObserver,responseShape?:'blocks'|'blocksWithFurniture'|'blocksWithMetadata'|'blocksWithCorrections'|'blocksWithApparatus'|'synthesis'|'synthesisReview',evidenceImages?:import('./generation-request.js').EditorialEvidenceImage[],externalEvidenceConsent=false,outputTokenBudget?:16000|32000|64000) {
    return this.generate({kind:'editorial',input,instructions,signal,onRequest,responseShape,evidenceImages,externalEvidenceConsent,outputTokenBudget,background:true});
  }
  private async validatedGeneration<T>(request:GenerationRequest,parse:(output:string)=>T):Promise<T> {
    let trace:AIDebugTrace|undefined;
    const key=this.credential()?.key;
    const output=await this.generate({...request,onRequest:bytes=>{
      const observer=request.onRequest?.(bytes);
      if(key)trace=redactedTrace(observer,key);
      return observer;
    }});
    try {
      const value=parse(output);
      trace?.event('validation',{stage:request.kind,valid:true});
      return value;
    } catch(error) {
      let category='schema';
      if(request.kind!=='title')try{JSON.parse(output);}catch{category='malformed_json';}
      trace?.event('validation',{stage:request.kind,valid:false,category});
      trace?.error(error instanceof Error?error.message:'AI output validation failed.');
      throw error;
    }
  }
  async generate(request:GenerationRequest) {
    const credential=this.credential(),preferenceRevision=this.preferenceRevision;
    if(!credential)throw new HttpError(409,'Add an API key in Settings → Intelligence. It may have expired.');
    const policy=generationPolicy(request,{personaId:this.personaId,personaExpression:this.personaExpression,standard:this.selection(),title:this.titleSelection(),enrichment:this.enrichmentSelection()});
    if(policy.admission.activeSlot==='exclusive'&&(this.active||this.editorialRequests.size))throw new GenerationAdmissionError('Another AI request is running. Please wait.');
    if(policy.admission.activeSlot==='editorial'&&(this.active||this.editorialRequests.size>=2))throw new GenerationAdmissionError('Editorial AI capacity is busy. Wait for the active requests to finish.');
    if (policy.admission.manual) this.reserveManualRequest();
    const controller=new AbortController();this.generationRequests.add(controller);if(policy.admission.activeSlot==='exclusive')this.active=controller;if(policy.admission.activeSlot==='editorial')this.editorialRequests.add(controller);
    const abort=()=>controller.abort();
    const requestSignal=request.signal;
    requestSignal?.addEventListener('abort',abort,{once:true});
    if(requestSignal?.aborted)controller.abort();
    let timedOut=false,transportStarted=false;
    const credentialRemainingMs=Date.parse(credential.expiresAt)-this.clock();
    const timer=setTimeout(()=>{timedOut=policy.timeoutMs<=credentialRemainingMs;controller.abort();},Math.min(policy.timeoutMs,credentialRemainingMs));
    let trace: AIDebugTrace | undefined;
    try {
      const prompt=policy.prompt(),selection=policy.selection;
      const inputText=typeof prompt.input==='string'?prompt.input:prompt.input.flatMap(item=>item.content.map(part=>'text' in part?part.text:part.image_url)).join('');
      const observer=request.onRequest?.(Buffer.byteLength(prompt.instructions+inputText,'utf8'));
      trace=redactedTrace(observer,credential.key);
      const payload={model:selection.model,store:false,max_output_tokens:policy.maxOutputTokens,reasoning:{effort:selection.reasoningEffort},tools:[],tool_choice:'none',...prompt,...(trace||policy.stream?{stream:true}:{})};
      trace?.request('https://api.openai.com/v1/responses',request.kind==='editorial'&&request.evidenceImages?.length?{...payload,input:[{role:'user',content:[{type:'input_text',text:request.input},...request.evidenceImages.map(image=>({type:'input_image',page:image.page,sha256:image.sha256,image_url:'[redacted original-page image]'}))]}]}:payload);
      trace?.event('prompt',{template:request.kind,version:1,...(policy.persona?{persona:{id:policy.persona.id,version:policy.persona.version,origin:policy.persona.origin,...(policy.persona.expression?{expression:policy.persona.expression}:{})}}:{})});
      if(controller.signal.aborted)throw request.kind==='editorial'?new GenerationCancellationError(false):new HttpError(409,'AI generation was stopped before sending the request.');
      const pendingResponse=this.transport('https://api.openai.com/v1/responses',{
        method:'POST',redirect:'error',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential.key}`},
        body:JSON.stringify(payload),
      });
      transportStarted=true;
      const response=await pendingResponse;
      if(!response.ok) {
        if(trace)await readOpenAIResponse(response,trace).catch(()=>{});else await response.body?.cancel();
        throw new GenerationProviderError(response.status,response.status===401?'OpenAI rejected the API key. Replace it in Settings.':response.status===429?'OpenAI quota or rate limit reached. Check your OpenAI account.':'OpenAI could not complete the request. Check API permissions, model access, and billing.');
      }
      const safeDelta=(delta:string,receive:(delta:string)=>void)=>{
        if(request.kind==='editorial'&&timedOut&&!requestSignal?.aborted&&this.credential()?.generation===credential.generation&&this.preferenceRevision===preferenceRevision)throw new GenerationTransportError('timeout');
        if(controller.signal.aborted||this.clock()>=Date.parse(credential.expiresAt)||this.preferenceRevision!==preferenceRevision)throw new HttpError(409,'AI generation was stopped or its settings changed.');
        receive(delta.split(credential.key).join('[redacted]').replace(/sk-[A-Za-z0-9_-]{16,}/g,'[redacted]'));
      };
      const result=await readOpenAIResponse(response,trace,policy.onDelta?delta=>safeDelta(delta,policy.onDelta!):undefined,
        policy.preview?{onDelta:delta=>safeDelta(delta,policy.preview!.onDelta),onReset:policy.preview.onReset}:undefined,observer?.usage);
      const summary=responseOutputText(result).trim();
      if(result.status!=='completed'){
        const reason=result.incomplete_details?.reason;
        if(result.status==='incomplete')throw new GenerationResponseError(reason==='max_output_tokens'?'provider_output_limit':reason==='content_filter'?'provider_content_filter':'provider_incomplete_output');
        if(result.status==='failed'||result.status==='cancelled')throw new GenerationResponseError('provider_response_failed');
        throw new GenerationTransportError('provider_transport');
      }
      if(!summary)throw new GenerationResponseError('provider_empty_output');
      if(summary.length>policy.maxOutputLength)throw new GenerationResponseError('provider_output_too_large');
      if(request.kind==='editorial'&&timedOut&&!requestSignal?.aborted&&this.credential()?.generation===credential.generation&&this.preferenceRevision===preferenceRevision)throw new GenerationTransportError('timeout');
      if(controller.signal.aborted||this.credential()?.generation!==credential.generation||this.preferenceRevision!==preferenceRevision)throw new HttpError(409,'The credential or AI settings changed, or the key expired. Please try again.');
      // Defense in depth against accidental credential echo by an upstream service.
      return summary.split(credential.key).join('[redacted]').replace(/sk-[A-Za-z0-9_-]{16,}/g,'[redacted]');
    }catch(error) {
      if(request.kind==='entityScan'&&error instanceof EntityScanBatchReady) {
        if(controller.signal.aborted||this.credential()?.generation!==credential.generation||this.preferenceRevision!==preferenceRevision)throw new HttpError(409,'AI generation was stopped or its settings changed.');
        controller.abort();
        trace?.event('validation',{stage:'entityScan',valid:true,category:'batch_checkpoint'});
        return error.output;
      }
      trace?.error(error instanceof Error?error.message:'AI request failed.');
      if(request.kind==='editorial'&&!(error instanceof GenerationTransportError)&&!(error instanceof GenerationCancellationError)&&
        (requestSignal?.aborted||controller.signal.aborted&&!timedOut||this.credential()?.generation!==credential.generation||this.preferenceRevision!==preferenceRevision))throw new GenerationCancellationError(transportStarted);
      if(error instanceof HttpError)throw error;
      if(request.kind==='editorial') {
        if(transportStarted)throw new GenerationTransportError(timedOut?'timeout':'provider_transport');
      }
      throw new HttpError(502,'The AI request failed or timed out. Please try again.');
    }finally {clearTimeout(timer);requestSignal?.removeEventListener('abort',abort);this.generationRequests.delete(controller);this.editorialRequests.delete(controller);if(this.active===controller)this.active=null;}
  }
}
