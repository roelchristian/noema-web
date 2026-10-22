/** Saved server state only; pending browser drafts are deliberately outside this inventory. */
export interface EntityImpact {
  id:string; name:string; archivedAt:string|null; version:string;
  pages:{id:string;title:string;trashed:boolean;references:number}[];
  counts:{activePages:number;trashedPages:number;blockReferences:number;properties:number;incomingProperties:number;relationships:number;attachments:number;citations:number;highlights:number;readingNotes:number;bookmarks:number;pendingSourceDrafts:number};
  remainsAccessible:string[];
  hiddenByDefault:string[];
  draftPolicy:string;
  deleteBlockedReason:string|null;
}
