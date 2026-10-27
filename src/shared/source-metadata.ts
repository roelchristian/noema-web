/** Storage-independent Source metadata. Keys identify canonical owners, never projections. */
export type SourceMetadataPolicy='review'|'fill_validated_empty';
export interface MetadataEvidence {
 fileId:string;runId:string;version:'canonical'|'editorial';revision:string;
 excerpt:string;start:number;end:number;evidenceHash:string;
 validated:boolean;validationReason:string;
}
export type MetadataRegistration=MetadataProposal & {registrationOutcome:'changed'|'satisfied'|'pending'|'ignored'};
export interface MetadataCandidate extends MetadataEvidence {fieldKey:string;value:string}
export interface MetadataProposal {
 id:string;fieldKey:string;value:string|null;targetId:string|null;acceptedValue?:string;
 status:'pending'|'accepted'|'rejected'|'corroborated'|'superseded';
 fingerprint:string;stale:boolean;staleReason:string|null;compatible:boolean;
 evidence:MetadataEvidence[];details:string;createdAt:string;updatedAt:string;
}
export interface MetadataField {
 key:string;label:string;owner:'source'|'bibliography'|'property'|'attachment';
 value:string|null;targetId?:string|null;targetName?:string;displayValues?:string[];editable:boolean;fingerprint:string;
 proposals:MetadataProposal[];history:MetadataProposal[];
 preservedValues?:{id:string;name:string;value:string|null;target_id:string|null}[];
 confirmedHistory?:{value:string;origin:string;at:string;details?:string}[];
}
export interface SourceMetadataSnapshot {
 sourceId:string;policy:SourceMetadataPolicy;fields:MetadataField[];
 counts:{confirmed:number;suggested:number;conflicts:number};
}
export interface MetadataReviewInput {proposalId:string;fingerprint:string;action:'accept'|'reject';value?:string;targetId?:string;replace?:boolean;preserveAuthoredValues?:boolean}
export interface MetadataBatchInput {proposals:{proposalId:string;fingerprint:string}[]}
export interface MetadataBatchResult {changed:string[];satisfied:string[];attention:string[];snapshot:SourceMetadataSnapshot}

/** Publication aliases share the same editing owner across metadata and exchange. */
export const sourceMetadataCanonicalField=(field:string)=>({year:'date',journaltitle:'journal',number:'issue'}[field]??field);
export const sourceMetadataBibliographicOwner=(fields:Record<string,string>,field:string)=>{const key=sourceMetadataCanonicalField(field);return ({date:['date','year'],journal:['journal','journaltitle'],issue:['issue','number']}[key]??[key]).find(item=>Object.hasOwn(fields,item))??key;};
/** Map reviewed incoming facts to existing owners; divergent aliases need correction first. */
export function sourceMetadataBibliographicUpdates(current:Record<string,string>,incoming:Record<string,string>):Record<string,string> {
 const mapped:Record<string,string>={};
 for(const [key,value] of Object.entries(incoming)){const owner=sourceMetadataBibliographicOwner(current,key);if(Object.hasOwn(mapped,owner)&&mapped[owner]!==value)throw new Error('Conflicting publication aliases for '+sourceMetadataCanonicalField(key)+'. Use one value before importing.');mapped[owner]=value;}
 return mapped;
}
export function applySourceMetadataBibliographicFields(current:Record<string,string>,incoming:Record<string,string>):Record<string,string> {return {...current,...sourceMetadataBibliographicUpdates(current,incoming)};}
