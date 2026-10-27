/** Page-scoped projection shared by the evidence endpoint and comparison panel. */
export interface SourceIngestionPageEvidence {
 provider:'openai'|'gemini';model:string;page?:number;
 pageState?:'content'|'blank'|'image-only'|'unreadable';role?:'owned'|'context';canRecoverPage?:boolean;
 text:string;uncertainty?:string[];
 /** Placement/structure diagnostics are separate from source-text uncertainty. */
 layoutWarnings?:string[];
 coverage?:string;independentEvidence?:string;
}

/** Read-only projection for older results; do not rewrite immutable source IR. */
export function sourceIngestionBlockNotes(block:{uncertainty:string|null;layoutWarnings?:string[];diagram?:{uncertainty:string|null}|null}):{uncertainty:string|null;layoutWarnings:string[]} {
 const legacy='An out-of-bounds provider location hint was omitted. Inspect the original PDF for visual placement.';
 let uncertainty=block.uncertainty;const layoutWarnings=[...(block.layoutWarnings??[])];
 if(block.diagram?.uncertainty)layoutWarnings.push('Diagram connections require review: '+block.diagram.uncertainty);
 if(uncertainty?.includes(legacy)){uncertainty=uncertainty.split(legacy).join('').trim()||null;layoutWarnings.push(legacy);}
 return {uncertainty,layoutWarnings:[...new Set(layoutWarnings)]};
}
