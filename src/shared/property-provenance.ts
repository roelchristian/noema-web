export const propertyOrigins = ['manual','imported','ai','derived','legacy_unknown'] as const;
export type PropertyOrigin = typeof propertyOrigins[number];
export interface ProvenanceEvidence {
 origin:PropertyOrigin; source_file_id:string|null; source_hash:string|null; details:string;
 stale:boolean; created_at:string; updated_at:string;
}
export interface PropertyProvenance extends ProvenanceEvidence {property_id:string;vault_id:string}
export interface EntityNameProvenance extends ProvenanceEvidence {entity_id:string;vault_id:string}
export interface PropertyProposal {
 id:string;vault_id:string;entity_id:string;kind:'property'|'entity_name';property_id:string|null;property_name:string|null;
 value:string|null;target_id:string|null;origin:PropertyOrigin;source_file_id:string|null;source_hash:string|null;
 details:string;status:'pending'|'accepted'|'rejected';created_at:string;updated_at:string;
}
export interface ProvenanceInput {origin:PropertyOrigin;source_file_id?:string|null;source_hash?:string|null;details?:string;stale?:boolean}
export interface PropertyProposalInput extends ProvenanceInput {
 entity_id:string;kind?:'property'|'entity_name';property_id?:string|null;property_name?:string|null;value?:string|null;target_id?:string|null;
}
