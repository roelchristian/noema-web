export const entityTypes = ['person', 'place', 'event', 'creativework', 'organization', 'source'] as const;
export type EntityType = typeof entityTypes[number];
export const entityLabels: Record<EntityType, string> = {
  person: 'Person', place: 'Place', event: 'Event', creativework: 'Creative work', organization: 'Organization', source: 'Source',
};
export const blockTypes = ['paragraph', 'heading1', 'heading2', 'bullet', 'quote', 'todo'] as const;
export type BlockType = typeof blockTypes[number];
export type Segment = { text: string; entityId?: never } | { entityId: string; text?: never };
export interface Block { id: string; type: BlockType; checked: boolean; content: Segment[] }
export interface Vault { id: string; name: string; locked: boolean; protected: boolean; updated_at: string }
export interface PageSummary { id: string; title: string; updated_at: string }
export interface Page extends PageSummary { vault_id: string; blocks: Block[]; sourceIds: string[]; revision: number }
export interface PageInput { title: string; blocks: Block[]; sourceIds?: string[]; revision?: number }
export interface Entity { id: string; vault_id: string; name: string; type: EntityType; description: string; updated_at: string }
export interface EntityInput { name: string; type: EntityType; description?: string }
export interface Property { id: string; entity_id: string; name: string; value: string | null; target_id: string | null }
export interface Relationship { id: string; source_id: string; label: string; target_id: string }
export interface EntityDetail extends Entity { properties: Property[]; relationships: Relationship[]; incomingProperties: Property[] }

export type PropertyInput = {name: string} & ({value: string; target_id?: never} | {target_id: string; value?: never});
export interface RelationshipInput {label: string; target_id: string}

export type ItemKind = 'page' | 'entity';
export interface Collection { id: string; name: string }
export interface Folder { id: string; name: string; collection_id: string | null; parent_id: string | null }
export interface ItemLocation { kind: ItemKind; item_id: string; collection_id: string; folder_id: string | null }
export interface Favourite { kind: ItemKind; item_id: string }
export interface Organization { collections: Collection[]; folders: Folder[]; locations: ItemLocation[]; favourites: Favourite[] }

export interface RecentItem { kind: ItemKind; item_id: string; opened_at: string }
export interface OrganizationContext { collection: string; folder: string }
