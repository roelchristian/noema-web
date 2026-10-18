// Curated Responses API text models, checked against official OpenAI docs on 2026-10-16.
// /v1/models does not describe reasoning compatibility; keep the allowlist explicit.
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface IntelligencePreferences { model: string; reasoningEffort: ReasoningEffort }
export interface IntelligenceConfiguration extends IntelligencePreferences {manualRequestsPerMinute: number}
export const defaultManualRequestsPerMinute = 5;
export const maxManualRequestsPerMinute = 120;
export function validManualRequestLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= maxManualRequestsPerMinute;
}
interface ModelOption { id: string; label: string; efforts: readonly ReasoningEffort[] }
const standard = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const withNone = ['none', ...standard] as const;
export const intelligenceModels: readonly ModelOption[] = [
  {id:'gpt-6-luna',label:'GPT-6 Luna',efforts:withNone},
  {id:'gpt-6.1-sol',label:'GPT-6.1 Sol',efforts:standard},
  {id:'gpt-6-astra',label:'GPT-6 Astra',efforts:standard},
  {id:'gpt-6-sol',label:'GPT-6 Sol',efforts:withNone},
  {id:'gpt-5.6-luna',label:'GPT-5.6 Luna',efforts:withNone},
  {id:'gpt-5.6-terra',label:'GPT-5.6 Terra',efforts:withNone},
  {id:'gpt-5.6-sol',label:'GPT-5.6 Sol',efforts:withNone},
  {id:'gpt-5-mini',label:'GPT-5 Mini (existing default)',efforts:['minimal','low','medium','high']},
];
export const defaultIntelligencePreferences: IntelligencePreferences = {model:'gpt-5-mini',reasoningEffort:'low'};
export function supportedIntelligencePreferences(value: unknown): value is IntelligencePreferences {
  if(!value || typeof value!=='object')return false;
  const {model,reasoningEffort}=value as Record<string,unknown>;
  return typeof model==='string' && typeof reasoningEffort==='string' && !!intelligenceModels.find(option=>option.id===model)?.efforts.includes(reasoningEffort as ReasoningEffort);
}

export interface AIActivity extends IntelligencePreferences {
  id: string; action: 'source_enrichment' | 'block_explanation' | 'page_title' | 'page_summary' | 'entity_scan' | 'note_embedding' | 'search_embedding' | 'connection_test' | 'create_page_from_source';
  status: 'running' | 'completed' | 'failed' | 'interrupted' | 'skipped';
  startedAt: string; finishedAt: string | null; durationMs: number | null; httpStatus: number | null;
  vaultId: string | null; vaultName: string | null; objectKind: 'page' | 'entity' | null;
  objectId: string | null; objectTitle: string | null; revision: number | null;
  available: boolean; promptBytes: number | null;
  inputTokens: number | null; outputTokens: number | null;
  cachedInputTokens: number | null; cacheWriteTokens: number | null;
  debugRecorded: boolean;
}
export interface AIActivityPage { items: AIActivity[]; nextCursor: number | null }
export interface AIDebugSettings {enabled: boolean}
export interface AIActivityDebug {
  activityId: string; status: AIActivity['status']; endpoint: string | null; request: string | null;
  responseBody: string; response: string | null; responseStatus: number | null;
  responseHeaders: string | null; error: string | null; updatedAt: string;
  events: {sequence: number; receivedAt: string; type: string; data: string}[];
}

export const aiActivityLabels: Record<AIActivity['action'], string> = {
  source_enrichment:'Source enrichment', block_explanation:'AI Explanation', page_title:'Page title & category', page_summary:'Page summary', entity_scan:'Entity scan',
  create_page_from_source:'Create page from source', note_embedding:'Note embedding', search_embedding:'Search embedding', connection_test:'Connection test',
};
