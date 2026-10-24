/** Scholarly interpretations stay separate from publication abstracts and canonical metadata. */
export const scholarlyRelationshipKinds=['translation_of','edition_of','commentary_on','critiques','responds_to','continues','influenced_by'] as const;
export type ScholarlyRelationshipKind=typeof scholarlyRelationshipKinds[number];
export interface ScholarlyEvidence {quote:string}
export interface ScholarlySynopsis extends ScholarlyEvidence {text:string;method:string;conclusions:string}
export interface SourceScholarlyResult {
 synopsis:ScholarlySynopsis;
 disciplines:{domainId:string;quote:string}[];
 concepts:{entityId:string;quote:string}[];
 relationships:{entityId:string;kind:ScholarlyRelationshipKind;quote:string}[];
}
export const scholarlyEnrichmentVersion='source-scholarly-v1';
