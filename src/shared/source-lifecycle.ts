export interface SourceLifecycle {
  id:string;
  name:string;
  archivedAt:string|null;
  linkedPageCount:number;
  temporalEvidenceCount?:number;
  blockedReason:string|null;
}
