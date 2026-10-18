import type { PageIconId } from './page-icons.js';
import type { IntelligencePreferences } from './intelligence.js';
export const entityTypes = ['person', 'place', 'event', 'creativework', 'organization', 'organism', 'culture', 'source', 'concept'] as const;
export type EntityType = typeof entityTypes[number];
export const entityLabels: Record<EntityType, string> = {
  person: 'Person', place: 'Place', event: 'Event', creativework: 'Creative work', organization: 'Organization', organism: 'Organism', culture: 'Culture', source: 'Source', concept: 'Concept',
};
export const blockTypes = ['paragraph', 'heading1', 'heading2', 'bullet', 'numbered', 'divider', 'code', 'quote', 'todo', 'columns', 'table', 'image', 'math'] as const;
export type BlockType = typeof blockTypes[number];
export interface SourceReference {sourceNumber?:number;id:string;sourceId:string;fileId:string;startLine:number;endLine:number;sourceHash:string;excerpt:string}
export interface TextStyle { sourceReference?: SourceReference; math?: boolean; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean; href?: string; skipAutoTag?: boolean }
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
export interface PageSummary { language?: string | null; aiStatus?: import('./page-ai-status.js').PageAIStatus; featuredImageId?: string | null; id: string; title: string; icon?: PageIconId | null; updated_at: string }
export interface TrashedPage extends PageSummary { deleted_at: string; expires_at: string }
export interface ConceptClassification { subtypeIds: string[]; contentHash: string }
export interface Page extends PageSummary { editLocked?: boolean; editProtected?: boolean; conceptClassification?: ConceptClassification; conceptContentHash?: string; vault_id: string; blocks: Block[]; sourceIds: string[]; revision: number; summaryContentHash?: string; entityMatchCache?: import('./entity-match-cache.js').EntityMatchCache }
export interface PageInput { language?: string | null; featuredImageId?: string | null; icon?: PageIconId | null; title: string; blocks: Block[]; sourceIds?: string[]; revision?: number }
export type EntityMentionCase = 'canonical' | 'lowercase';
export interface Entity { sourceStatus?: SourceFile['status'] | null; inactive?: boolean; id: string; vault_id: string; name: string; aliases?: string[]; mentionCase?: EntityMentionCase; type: EntityType; subtypes: string[]; description: string; updated_at: string }
export interface EntityInput { name: string; aliases?: string[]; mentionCase?: EntityMentionCase; type: EntityType; subtypes?: string[]; subtype?: string | null; description?: string; attachmentIds?: string[] }
export function entityMentionName(entity: Pick<Entity,'name'|'mentionCase'> | undefined): string | undefined {
  return entity?.mentionCase === 'lowercase' ? entity.name.toLowerCase() : entity?.name;
}
export interface Property { id: string; entity_id: string; name: string; value: string | null; target_id: string | null }
export interface Relationship { id: string; source_id: string; label: string; target_id: string }
export interface SourceFile { admitted: 0 | 1; format: 'txt' | 'md' | 'pdf' | 'html' | 'url'; pdf_flattened: 0 | 1; import_method: 'upload' | 'url'; source_url: string | null; id: string; vault_id: string; entity_id: string | null; name: string; size: number; status: 'queued' | 'processing' | 'ready' | 'failed'; text: string; error: string | null; progress: number; pages: number; ocr_pages: number; created_at: string }
export interface EntityPageMention extends PageSummary { mentionCount: number; excerpt: string }
export interface EntityDetail extends Entity { pageMentions?: EntityPageMention[]; attachments?: SourceFile[]; propertyNames: string[]; properties: Property[]; relationships: Relationship[]; incomingProperties: Property[] }

export type PropertyInput = {name: string} & ({value: string; target_id?: never} | {target_id: string; value?: never});
export interface RelationshipInput {label: string; target_id: string}

export type ItemKind = 'page' | 'entity';
export interface Collection { id: string; name: string }
export interface Folder { id: string; name: string; parent_id: string | null }
export interface ItemLocation { kind: ItemKind; item_id: string; folder_id: string | null }
export interface CollectionMembership { kind: ItemKind; item_id: string; collection_id: string }
export type FavouriteKind = ItemKind | 'folder';
export interface Favourite { kind: FavouriteKind; item_id: string }
export interface CollectionFolderLink {folder_id: string; collection_id: string}
export interface Organization { folderLinks?: CollectionFolderLink[]; collections: Collection[]; folders: Folder[]; locations: ItemLocation[]; memberships: CollectionMembership[]; favourites: Favourite[] }

export interface RecentItem { kind: ItemKind; item_id: string; opened_at: string }
export interface OrganizationContext { collection: string; folder: string }

export interface IntelligenceStatus extends IntelligencePreferences {
  manualRequestsPerMinute: number; configured: boolean; expiresAt: string | null }

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
