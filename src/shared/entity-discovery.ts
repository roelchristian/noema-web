import type {SourceReference} from './domain.js';
import type {IntelligencePreferences} from './intelligence.js';
export interface EntityDiscoveryEvidence {
  id:string;kind:'page'|'source';title:string;excerpt:string;pageId?:string;reference?:SourceReference;
}
interface Suggestion {id:string;status:'pending'|'accepted'|'rejected';rationale:string;evidenceIds:string[]}
export type EntityDiscoverySuggestion =
  | (Suggestion & {kind:'synthesis';content:string})
  | (Suggestion & {kind:'relationship';targetId:string;targetName:string;label:string})
  | (Suggestion & {kind:'page';pageId:string;pageTitle:string});
export interface EntityDiscovery extends IntelligencePreferences {
  id:string;entityId:string;createdAt:string;overviewRevision:number;stale:boolean;
  evidence:EntityDiscoveryEvidence[];suggestions:EntityDiscoverySuggestion[];
}
export interface EntityDiscoveryReview {
  suggestionId:string;decision:'accepted'|'rejected';expectedOverviewRevision?:number;
}
