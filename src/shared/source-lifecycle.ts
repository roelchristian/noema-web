export interface SourceLifecycle {
  id:string;
  name:string;
  archivedAt:string|null;
  linkedPageCount:number;
  blockedReason:string|null;
}
