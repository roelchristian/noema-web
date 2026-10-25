import type {BuiltinPersonaId,PersonaExpression} from './ai-personas.js';
// Curated Responses API text models, checked against official OpenAI docs on 2026-10-16.
// /v1/models does not describe reasoning compatibility; keep the allowlist explicit.
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type SpeechProvider = 'kokoro' | 'openai' | 'gemini';
export const defaultSpeechProvider:SpeechProvider = 'kokoro';
export const speechModel = 'kokoro-82m-v1.0';
export const geminiSpeechModel = 'gemini-3.8-flash-lite-tts';
export const geminiSpeechStyle = 'Warm, relaxed, conversational narration with a lightly upbeat tone, smooth phrasing, clear diction, and a steady, unhurried pace.';
export const geminiApiKeyMaxLength = 4096;
export const geminiSpeechVoices = ['Zephyr','Puck','Charon','Kore','Fenrir','Leda','Orus','Aoede','Callirrhoe','Autonoe','Enceladus','Iapetus','Umbriel','Algieba','Despina','Erinome','Algenib','Rasalgethi','Laomedeia','Achernar','Alnilam','Schedar','Gacrux','Pulcherrima','Achird','Zubenelgenubi','Vindemiatrix','Sadachbia','Sadaltager','Sulafat'] as const;
export interface SpeechCredentialStatus {configured:boolean;expiresAt:string|null}
export const openAISpeechModel = 'gpt-realtime-2.1-mini';
export const speechVoices = ['puck','echo','lewis','daniel'] as const;
export const openAISpeechVoices = ['marin','cedar','alloy','ash','ballad','coral','echo','sage','shimmer','verse'] as const;
export type SpeechVoice = typeof speechVoices[number] | typeof openAISpeechVoices[number] | typeof geminiSpeechVoices[number];
export const defaultSpeechVoice:SpeechVoice = 'puck';
export function isSpeechProvider(value:unknown):value is SpeechProvider {return value==='kokoro'||value==='openai'||value==='gemini';}
export function speechVoicesFor(provider:SpeechProvider):readonly SpeechVoice[] {return provider==='gemini'?geminiSpeechVoices:provider==='openai'?openAISpeechVoices:speechVoices;}
export function defaultSpeechVoiceFor(provider:SpeechProvider):SpeechVoice {return provider==='gemini'?'Puck':provider==='openai'?'marin':defaultSpeechVoice;}
export function isSpeechVoice(value:unknown,provider:SpeechProvider='kokoro'):value is SpeechVoice {return typeof value==='string'&&speechVoicesFor(provider).some(voice=>voice===value);}
export function speechModelFor(provider:SpeechProvider):string {return provider==='gemini'?geminiSpeechModel:provider==='openai'?openAISpeechModel:speechModel;}
export interface IntelligencePreferences { model: string; reasoningEffort: ReasoningEffort }
export interface IntelligenceConfiguration extends IntelligencePreferences {personaId?:BuiltinPersonaId;personaExpression?:PersonaExpression;ttsEnabled:boolean;narration?:import('./narration.js').NarrationPreferences;ttsProvider?:SpeechProvider;ttsVoice:SpeechVoice;manualRequestsPerMinute: number; pageEnrichment?: IntelligencePreferences}
/** Category updates deliberately exclude the other category's fields. */
export type AIPreferences = Pick<IntelligenceConfiguration,'model'|'reasoningEffort'|'personaId'|'personaExpression'|'manualRequestsPerMinute'|'pageEnrichment'>;
export type VoicePreferences = Pick<IntelligenceConfiguration,'ttsEnabled'|'ttsProvider'|'ttsVoice'|'narration'>;
export const defaultPageEnrichmentPreferences: IntelligencePreferences = {model:'gpt-6-luna',reasoningEffort:'none'};
export const defaultManualRequestsPerMinute = 5;
export const maxManualRequestsPerMinute = 120;
export function validManualRequestLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= maxManualRequestsPerMinute;
}
interface ModelOption { id: string; label: string; efforts: readonly ReasoningEffort[]; structuredOutputs:boolean;imageInput:boolean }
const standard = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const withNone = ['none', ...standard] as const;
export const intelligenceModels: readonly ModelOption[] = [
  // Image input explicitly verified for gpt-5-mini at https://developers.openai.com/api/docs/models/gpt-5-mini on 2026-10-24.
  // Other curated models fail closed until their image contracts are independently enabled.
  // Structured-output support checked on each official /api/docs/models/<id> page, 2026-10-24.
  {id:'gpt-6-luna',label:'GPT-6 Luna',efforts:withNone,structuredOutputs:true,imageInput:false},
  {id:'gpt-6.1-sol',label:'GPT-6.1 Sol',efforts:standard,structuredOutputs:true,imageInput:false},
  {id:'gpt-6-astra',label:'GPT-6 Astra',efforts:standard,structuredOutputs:true,imageInput:false},
  {id:'gpt-6-sol',label:'GPT-6 Sol',efforts:withNone,structuredOutputs:true,imageInput:false},
  {id:'gpt-5.6-luna',label:'GPT-5.6 Luna',efforts:withNone,structuredOutputs:true,imageInput:false},
  {id:'gpt-5.6-terra',label:'GPT-5.6 Terra',efforts:withNone,structuredOutputs:true,imageInput:false},
  {id:'gpt-5.6-sol',label:'GPT-5.6 Sol',efforts:withNone,structuredOutputs:true,imageInput:false},
  {id:'gpt-5-mini',label:'GPT-5 Mini (existing default)',efforts:['minimal','low','medium','high'],structuredOutputs:true,imageInput:true},
];
export const defaultIntelligencePreferences: IntelligencePreferences = {model:'gpt-5-mini',reasoningEffort:'low'};
export function supportedIntelligencePreferences(value: unknown): value is IntelligencePreferences {
  if(!value || typeof value!=='object')return false;
  const {model,reasoningEffort}=value as Record<string,unknown>;
  return typeof model==='string' && typeof reasoningEffort==='string' && !!intelligenceModels.find(option=>option.id===model)?.efforts.includes(reasoningEffort as ReasoningEffort);
}

export interface AIActivity extends IntelligencePreferences {
  id: string; action: 'chat' | 'persona_preview' | 'bibliographic_lookup' | 'text_to_speech' | 'collection_rules' | 'entity_discovery' | 'page_enrichment' | 'source_enrichment' | 'source_math_preprocessing' | 'source_reprocessing' | 'text_review' | 'block_explanation' | 'page_title' | 'page_summary' | 'entity_scan' | 'note_embedding' | 'search_embedding' | 'connection_test' | 'create_page_from_source';
  status: 'running' | 'completed' | 'failed' | 'interrupted' | 'skipped';
  startedAt: string; finishedAt: string | null; durationMs: number | null; httpStatus: number | null;
  vaultId: string | null; vaultName: string | null; objectKind: 'page' | 'entity' | null;
  objectId: string | null; objectTitle: string | null; revision: number | null;
  available: boolean; promptBytes: number | null;
  inputTokens: number | null; outputTokens: number | null;
  cachedInputTokens: number | null; cacheWriteTokens: number | null;
  reasoningTokens?: number | null; estimatedCost?: number | null; pricingVersion?: string | null;
  debugRecorded: boolean;
}
export interface PageEnrichmentMetrics {
  decisions: number; requestsAvoided: number; providerRequests: number; completedPages: number;
  estimatedCost: number | null; costPerCompletedPage: number | null;
  reasons: {reason:string;count:number}[];
}
export interface AIModelPricing {
  version: string; currency: 'USD';
  models: Record<string,{inputPerMillion:number;outputPerMillion:number;cachedInputPerMillion?:number;cacheWritePerMillion?:number;longContextThreshold?:number;audioInputPerMillion?:number;audioOutputPerMillion?:number;cachedAudioInputPerMillion?:number}>;
}
export interface AIActivityPage { items: AIActivity[]; nextCursor: number | null; enrichmentMetrics?: PageEnrichmentMetrics }
export interface AIDebugSettings {enabled: boolean; mode?: 'off'|'compact'|'full'; fullUntil?: string|null}
export interface AIActivityDebug {
  durationMs?: number|null; eventCount?: number;
  mode?: 'legacy'|'compact'|'full'; revision?: number; retainedBytes?: number; truncated?: boolean; unchanged?: boolean; nextEventCursor?: number|null; hasMoreEvents?: boolean;
  activityId: string; status: AIActivity['status']; endpoint: string | null; request: string | null;
  responseBody: string; response: string | null; responseStatus: number | null;
  responseHeaders: string | null; error: string | null; updatedAt: string;
  events: {sequence: number; receivedAt: string; type: string; data: string}[];
}

export const aiActivityLabels: Record<AIActivity['action'], string> = {
  chat:'Knowledge Chat',
  text_to_speech:'Speak',
  collection_rules:'Generate collection rules',
  entity_discovery:'Entity discovery',
  page_enrichment:'Page enrichment',
  bibliographic_lookup:'DOI metadata lookup (no AI)', source_reprocessing:'Source editorial reprocessing', source_enrichment:'Source enrichment', source_math_preprocessing:'Math span preprocessing', persona_preview:'Persona comparison preview', text_review:'AI writing review', block_explanation:'AI Explanation', page_title:'Page title & category', page_summary:'Page summary', entity_scan:'Entity scan',
  create_page_from_source:'Create page from source', note_embedding:'Note embedding', search_embedding:'Search embedding', connection_test:'Connection test',
};
