import type { PageIconId } from './page-icons.js';
import type { IntelligencePreferences } from './intelligence.js';
export const entityTypes = ['person', 'place', 'event', 'creativework', 'organization', 'organism', 'culture', 'source', 'concept'] as const;
export type EntityType = typeof entityTypes[number];
export const entityLabels: Record<EntityType, string> = {
  person: 'Person', place: 'Place', event: 'Event', creativework: 'Creative work', organization: 'Organization', organism: 'Organism', culture: 'Culture', source: 'Source', concept: 'Concept',
};
export const blockTypes = ['paragraph', 'heading1', 'heading2', 'bullet', 'numbered', 'divider', 'code', 'quote', 'todo', 'columns', 'table', 'image', 'math'] as const;
export type BlockType = typeof blockTypes[number];
export interface SourceReference {userLocator?:string;appLocator?:string;nodeId?:string;contextLabel?:string;generationId?:string;passageId?:string;stale?:boolean;startOffset?:number;endOffset?:number;startPage?:number;endPage?:number;sourceNumber?:number;id:string;sourceId:string;fileId:string;startLine:number;endLine:number;sourceHash:string;excerpt:string}
export interface TextStyle { sourceReference?: SourceReference; math?: boolean; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean; href?: string; /** Text: never auto-tag. Entity: occurrence-only; exclude from page-context inference. */ skipAutoTag?: boolean }
export type Segment = TextStyle & ( { text: string; entityId?: never; mentionText?: never } | { entityId: string; text?: never; mentionText?: string });
/** Formatting never limits entity matching; semantic content and explicit exclusions do. */
export function isEntityTaggingText(segment: Segment): segment is Extract<Segment, {text: string}> {
  return !segment.entityId && !segment.math && !segment.sourceReference && !segment.skipAutoTag;
}
export interface Block { column?: {id: string; index: 0 | 1}; semantic?: import('./semantic-blocks.js').SemanticKind; semanticGroup?: import('./semantic-blocks.js').SemanticGroup; id: string; type: BlockType; checked: boolean; content: Segment[]; rows?: Segment[][][]; imageId?: string; alt?: string }
export interface Vault { id: string; name: string; locked: boolean; protected: boolean; updated_at: string }
export interface VaultDeletionPreview {
  vault:Vault; fingerprint:string; canDelete:boolean; blockers:string[];
  counts:{notes:number;trashedNotes:number;entities:number;sourceFiles:number;images:number;folders:number;collections:number};
}
export interface VaultDeletionConfirmation {name:string;fingerprint:string;acknowledged:boolean;passphrase?:string}
export interface VaultDeletionResult {vaults:Vault[];cleanupPending:boolean}
export interface PageSummary { aiReviewAccepted?:boolean; language?: string | null; aiStatus?: import('./page-ai-status.js').PageAIStatus; featuredImageId?: string | null; id: string; title: string; icon?: PageIconId | null; updated_at: string }
export interface TrashedPage extends PageSummary { deleted_at: string; expires_at: string }
export interface Domain {id:string;parent_id:string|null;label:string;lcc_refs?:string[];scope_note?:string;sort_order:number}
export interface PageDomains {classifiedContentHash?:string;lastAssessedContentHash?:string;classificationVersion?:string;classificationOrigin?:'manual'|'inferred';lastClassifiedAt?:string;freshnessReason?:string;primaryDomainId:string|null;secondaryDomainIds:string[];origin:'manual'|'inferred';status:'manual'|'inferred'|'unclassified'|'needs_refresh';contentHash?:string;taxonomyVersion:string;revision:number}
export interface ConceptClassification { subtypeIds: string[]; contentHash: string }
export interface Page extends PageSummary { titleEdited?:boolean; generationMetadata?: import('./page-generation.js').PageGenerationMetadata | null; readingNote?: import('./source-reading.js').ReadingNoteMetadata; enrichmentPending?:boolean; enrichmentPendingFields?:Array<'title'|'domains'|'language'|'summary'>; enrichmentFields?:Partial<Record<'title'|'domains'|'language'|'summary',{origin:'manual'|'inferred'|'unknown';updatedAt?:string;suppressed?:boolean;stale?:boolean}>>; created_at?: string | null; editLocked?: boolean; editProtected?: boolean; pageDomains?: PageDomains; conceptClassification?: ConceptClassification; conceptContentHash?: string; vault_id: string; blocks: Block[]; sourceIds: string[]; revision: number; summaryContentHash?: string; entityMatchCache?: import('./entity-match-cache.js').EntityMatchCache }
export interface PageInput { titleEdited?:boolean; aiReviewAccepted?:boolean; language?: string | null; featuredImageId?: string | null; icon?: PageIconId | null; title: string; blocks: Block[]; sourceIds?: string[]; revision?: number }
export type PageEnrichmentMetadata = Pick<Page,'id'|'vault_id'|'title'|'revision'|'pageDomains'|'summaryContentHash'|'enrichmentPending'|'enrichmentPendingFields'|'enrichmentFields'|'language'>;
export type EntityMentionCase = 'canonical' | 'lowercase';
export interface Entity { archived_at?: string | null; domainIds?: string[]; sourceEnrichmentStatus?: SourceFile['enrichment_status'] | null; sourceStatus?: SourceFile['status'] | null; inactive?: boolean; id: string; vault_id: string; name: string; aliases?: string[]; mentionCase?: EntityMentionCase; type: EntityType; subtypes: string[]; description: string; updated_at: string }
export interface EntityInput { domainIds?: string[]; name: string; aliases?: string[]; mentionCase?: EntityMentionCase; type: EntityType; subtypes?: string[]; subtype?: string | null; description?: string; attachmentIds?: string[] }
export function entityMentionName(entity: Pick<Entity,'name'|'mentionCase'> | undefined): string | undefined {
  return entity?.mentionCase === 'lowercase' ? entity.name.toLowerCase() : entity?.name;
}
export interface Property { id: string; entity_id: string; name: string; value: string | null; target_id: string | null }
export interface Relationship { id: string; source_id: string; label: string; target_id: string }
export const sourceStructureKinds=['heading','chapter','section','subsection','theorem','lemma','proposition','corollary','definition','proof','example','remark'] as const;
export type SourceStructureKind=typeof sourceStructureKinds[number];
/** Semantic markers address stored source lines; physical pages are mapped separately. */
export interface SourceStructureNode { text: string; startLine: number; endLine?: number; level?: number; kind?: SourceStructureKind }
export interface SourceFile {
  contains_math:0|1;
  processing_detail?:import('./source-progress.js').SourceProcessingProgress; structural_nodes?: string; original_filename: string; generated_name: string | null; language: string | null; summary: string | null; enrichment_status: 'pending' | 'running' | 'completed' | 'failed'; enrichment_error: string | null; enrichment_attempts: number; enrichment_next_attempt_at: string; page_start_lines?: string; admitted: 0 | 1; format: 'txt' | 'md' | 'pdf' | 'html' | 'url'; pdf_flattened: 0 | 1; import_method: 'upload' | 'url'; source_url: string | null; id: string; vault_id: string; entity_id: string | null; name: string; size: number; status: 'queued' | 'processing' | 'ready' | 'failed'; text: string; error: string | null; progress: number; pages: number; ocr_pages: number; created_at: string }
export interface EntityPageMention extends PageSummary { mentionCount: number; excerpt: string; contexts?: import('./entity-mentions.js').EntityMentionContext[] }
export interface EntityOverview { content: string; revision: number }
export interface EntityPageAssociation extends PageSummary { pinned: boolean; annotation: string; created_at: string }
export interface PageEntityAssociation { entityId: string; pinned: boolean; annotation: string }
export interface EntityDetail extends Entity { overview?: EntityOverview; linkedPages?: EntityPageAssociation[]; pageMentions?: EntityPageMention[]; attachments?: SourceFile[]; propertyNames: string[]; properties: Property[]; relationships: Relationship[]; incomingProperties: Property[] }

export type PropertyInput = {name: string} & ({value: string; target_id?: never} | {target_id: string; value?: never});
export interface RelationshipInput {label: string; target_id: string}

export type ItemKind = 'page' | 'entity';
export interface Collection { id: string; name: string }
export interface Folder { id: string; name: string; parent_id: string | null }
export interface ItemLocation { kind: ItemKind; item_id: string; folder_id: string | null }
export interface CollectionMembership { kind: ItemKind; item_id: string; collection_id: string; automatic?: boolean }
export type FavouriteKind = ItemKind | 'folder';
export interface Favourite { kind: FavouriteKind; item_id: string }
export interface CollectionFolderLink {folder_id: string; collection_id: string}
export interface Organization { folderLinks?: CollectionFolderLink[]; collections: Collection[]; folders: Folder[]; locations: ItemLocation[]; memberships: CollectionMembership[]; favourites: Favourite[] }

export interface RecentItem { kind: ItemKind; item_id: string; opened_at: string }
export interface OrganizationContext { collection: string; folder: string }

export interface IntelligenceStatus extends IntelligencePreferences {
  pageEnrichment?: IntelligencePreferences; manualRequestsPerMinute: number; configured: boolean; expiresAt: string | null }

export interface AIEnrichment extends IntelligencePreferences {
  kind: string; data: Record<string, unknown>; revision: number; updated_at: string; contentHash?: string | null;
}
export interface AISummary extends IntelligencePreferences { summary: string; revision: number; contentHash?: string | null }

export function blockSegments(block: Block): Segment[] { return (block.type === 'table' || block.type === 'columns') ? (block.rows ?? []).flat(2) : block.content; }
export function safeHref(value: string): string | undefined { return /^(https?:|mailto:)/i.test(value.trim()) ? value.trim() : undefined; }

/** Number adjacent list items, restarting across block and semantic group boundaries. */
export function blockListNumber(blocks: Block[], id: string): number {
  const index = blocks.findIndex(block => block.id === id);
  if (index < 0) return 1;
  let start = index;
  while (start > 0 && blocks[start - 1]!.type === 'numbered' && blocks[start - 1]!.semanticGroup?.id === blocks[index]!.semanticGroup?.id && blocks[start - 1]!.column?.id === blocks[index]!.column?.id && blocks[start - 1]!.column?.index === blocks[index]!.column?.index) start--;
  return index - start + 1;
}
