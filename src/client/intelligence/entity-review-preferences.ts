export type ReviewDocumentView='full'|'excerpts';
export interface ReviewDocumentPreference {scanId:string|null;view:ReviewDocumentView;lastOpenedAt:number}
export const reviewDocumentExpiry=24*60*60*1000;

export function restoreReviewDocumentView(saved:unknown,scanId:string|null,now=Date.now()):ReviewDocumentView {
  if(!saved||typeof saved!=='object')return 'excerpts';
  const value=saved as Partial<ReviewDocumentPreference>;
  return value.scanId===scanId&&(value.view==='full'||value.view==='excerpts')&&typeof value.lastOpenedAt==='number'&&Number.isFinite(value.lastOpenedAt)&&now>=value.lastOpenedAt&&now-value.lastOpenedAt<reviewDocumentExpiry?value.view:'excerpts';
}
