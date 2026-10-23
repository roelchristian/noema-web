import type {Block,Page} from './domain.js';
export type PageVersionKind='baseline'|'created'|'edit'|'ai_acceptance'|'import'|'checkpoint'|'restore';
export interface PageHistorySnapshot {
  version:1; title:string; blocks:Block[]; icon:string|null; featuredImageId:string|null; language:string|null;
  sourceIds:string[]; aiStatus:string; aiReviewAccepted:boolean; generationMetadata:Page['generationMetadata']|null;
  creationMethod:Page['creationMethod'];
  readingNote?:{sourceId:string|null;fileId:string|null;sourceHash:string;startOffset:number;endOffset:number;excerpt:string;reference:Record<string,unknown>;createdAt:string};
  manualDomains:{domain_id:string;role:string;origin:string;updated_at:string}[];
  fieldOrigins:Partial<Record<'title'|'language'|'domains','manual'|'inferred'|'unknown'>>;
}
export interface PageVersion {
  id:string;pageId:string;pageRevision:number;createdAt:string;kind:PageVersionKind;name:string|null;pinned:boolean;
  contentHash:string;restoredFromVersionId:string|null;
}
export interface PageVersionDetail extends PageVersion {snapshot:PageHistorySnapshot}
