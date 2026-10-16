// Curated Responses API text models, checked against official OpenAI docs on 2026-10-16.
// /v1/models does not describe reasoning compatibility; keep the allowlist explicit.
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface IntelligencePreferences { model: string; reasoningEffort: ReasoningEffort }
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
  id: string; action: 'page_title' | 'page_summary' | 'entity_scan' | 'connection_test';
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  startedAt: string; finishedAt: string | null; durationMs: number | null; httpStatus: number | null;
  vaultId: string | null; vaultName: string | null; objectKind: 'page' | 'entity' | null;
  objectId: string | null; objectTitle: string | null; revision: number | null;
  available: boolean; promptBytes: number | null;
}
export interface AIActivityPage { items: AIActivity[]; nextCursor: number | null }
