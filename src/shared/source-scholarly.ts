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
export const scholarlyEnrichmentVersion='source-scholarly-v2';

/** Stored as an ordinary review proposal; acceptance is a canonical taxonomy action. */
export const scholarlyDisciplineProperty='scholarly discipline';
export interface ScholarlyDisciplineProposal {
 domainId:string;
 label:string;
 taxonomyVersion:string;
 bibliographicRevision:number|null;
}
export function parseScholarlyDiscipline(value:string|null):ScholarlyDisciplineProposal|null {
 try {
  const parsed:unknown=JSON.parse(value??'null');
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
  const result=parsed as Record<string,unknown>;
  if(typeof result.domainId!=='string'||typeof result.label!=='string'||typeof result.taxonomyVersion!=='string'||!(result.bibliographicRevision===null||typeof result.bibliographicRevision==='number'&&Number.isSafeInteger(result.bibliographicRevision)&&result.bibliographicRevision>=1))return null;
  return {domainId:result.domainId,label:result.label,taxonomyVersion:result.taxonomyVersion,bibliographicRevision:result.bibliographicRevision};
 }catch{return null;}
}

export function isScholarlyDisciplineProposal(proposal:{kind:string;property_name:string|null;origin:string;details:string}):boolean {
 return proposal.kind==='property'&&proposal.property_name===scholarlyDisciplineProperty&&proposal.origin==='ai'&&/^source-scholarly-v[0-9]+:[a-f0-9]{64}\n/.test(proposal.details);
}
