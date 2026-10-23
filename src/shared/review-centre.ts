export type ReviewCategory='scan'|'discovery'|'editorial'|'source';
export type ReviewGroup='decisions'|'operations'|'activity';
export interface ReviewItem {
 id:string; category:ReviewCategory; originId:string; title:string; fileId?:string; runId?:string;
 group:ReviewGroup; state:string; decision:string; count:number; updatedAt:string;
}
export interface ReviewQueue {items:ReviewItem[]; errors:string[]; more:ReviewCategory[]}
