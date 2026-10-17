import type { PageIconId } from './page-icons.js';
import type { IntelligencePreferences } from './intelligence.js';
export const entityTypes = ['person', 'place', 'event', 'creativework', 'organization', 'source'] as const;
export type EntityType = typeof entityTypes[number];
export const entityLabels: Record<EntityType, string> = {
  person: 'Person', place: 'Place', event: 'Event', creativework: 'Creative work', organization: 'Organization', source: 'Source',
};
export const blockTypes = ['paragraph', 'heading1', 'heading2', 'bullet', 'quote', 'todo', 'table', 'image', 'math'] as const;
export type BlockType = typeof blockTypes[number];
export interface TextStyle { math?: boolean; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean; href?: string }
export type Segment = TextStyle & ( { text: string; entityId?: never } | { entityId: string; text?: never });
export interface Block { id: string; type: BlockType; checked: boolean; content: Segment[]; rows?: Segment[][][]; imageId?: string; alt?: string }
export interface Vault { id: string; name: string; locked: boolean; protected: boolean; updated_at: string }
export interface PageSummary { id: string; title: string; icon?: PageIconId | null; updated_at: string }
export interface TrashedPage extends PageSummary { deleted_at: string; expires_at: string }
export interface Page extends PageSummary { vault_id: string; blocks: Block[]; sourceIds: string[]; revision: number }
export interface PageInput { icon?: PageIconId | null; title: string; blocks: Block[]; sourceIds?: string[]; revision?: number }
export interface Entity { id: string; vault_id: string; name: string; type: EntityType; subtypes: string[]; description: string; updated_at: string }
export interface EntityInput { name: string; type: EntityType; subtypes?: string[]; subtype?: string | null; description?: string }
export interface Property { id: string; entity_id: string; name: string; value: string | null; target_id: string | null }
export interface Relationship { id: string; source_id: string; label: string; target_id: string }
export interface EntityDetail extends Entity { propertyNames: string[]; properties: Property[]; relationships: Relationship[]; incomingProperties: Property[] }

export type PropertyInput = {name: string} & ({value: string; target_id?: never} | {target_id: string; value?: never});
export interface RelationshipInput {label: string; target_id: string}

export type ItemKind = 'page' | 'entity';
export interface Collection { id: string; name: string }
export interface Folder { id: string; name: string; parent_id: string | null }
export interface ItemLocation { kind: ItemKind; item_id: string; folder_id: string | null }
export interface CollectionMembership { kind: ItemKind; item_id: string; collection_id: string }
export type FavouriteKind = ItemKind | 'folder';
export interface Favourite { kind: FavouriteKind; item_id: string }
export interface Organization { collections: Collection[]; folders: Folder[]; locations: ItemLocation[]; memberships: CollectionMembership[]; favourites: Favourite[] }

export interface RecentItem { kind: ItemKind; item_id: string; opened_at: string }
export interface OrganizationContext { collection: string; folder: string }

export interface IntelligenceStatus extends IntelligencePreferences { configured: boolean; expiresAt: string | null }

export interface AIEnrichment extends IntelligencePreferences {
  kind: string; data: Record<string, unknown>; revision: number; updated_at: string;
}
export interface AISummary extends IntelligencePreferences { summary: string; revision: number }

export function blockSegments(block: Block): Segment[] { return block.type === 'table' ? (block.rows ?? []).flat(2) : block.content; }
export function safeHref(value: string): string | undefined { return /^(https?:|mailto:)/i.test(value.trim()) ? value.trim() : undefined; }
