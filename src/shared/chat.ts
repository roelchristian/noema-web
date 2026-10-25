import type {PageReference} from './embeddings.js';
import type {SourceReference} from './domain.js';
export type ChatScope={kind:'vault'}|{kind:'page'|'source'|'entity';id:string};
export interface ChatMention {id:string;name:string}
export type ChatEvidenceKind='source'|'own_note'|'entity_fact'|'entity_overview';
export interface ChatEvidence {origin?:'authored'|'ai_generated'|'mixed';id:string;kind:ChatEvidenceKind;objectId:string;title:string;excerpt:string;fingerprint:string;locator:string;reference?:SourceReference;pageReference?:PageReference;factId?:string;revision?:number;status:'current'|'stale'|'deleted';}
export interface ChatClaim {text:string;attribution:'supported'|'inferred'|'unestablished';citationIds:string[]}
export interface ChatMessage {id:string;role:'user'|'assistant';text:string;createdAt:string;claims?:ChatClaim[];evidence?:ChatEvidence[];mentions?:ChatMention[];status?:'completed'|'interrupted'|'failed'}
export interface ChatThread {id:string;vaultId:string;title:string;scope:ChatScope;createdAt:string;updatedAt:string;messages:ChatMessage[]}
export interface ChatSubmit {question:string;scope:ChatScope;mentions?:ChatMention[];contextMentions?:ChatMention[];threadId?:string;temporary?:boolean;deep?:boolean;previousQuestions?:string[];requestId:string}
export interface ChatResult {message:ChatMessage;threadId?:string;diagnostics:{passes:number;evidenceCount:number;depth:'standard'|'deep'};activityId?:string;usage?:{inputTokens:number|null;outputTokens:number|null;estimatedCost:number|null;pricingVersion:string|null}}
export type ChatEvent={type:'evidence';evidence:ChatEvidence[]}|{type:'answer';result:ChatResult}|{type:'error';message:string};
