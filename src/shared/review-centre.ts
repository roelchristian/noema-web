export type ReviewCategory='scan'|'discovery'|'editorial'|'source'|'property'|'temporal';
export type ReviewGroup='decisions'|'operations'|'activity';
export interface ReviewItem {
 id:string; category:ReviewCategory; originId:string; title:string; fileId?:string; runId?:string; proposalId?:string; dateId?:string;
 group:ReviewGroup; state:string; decision:string; count:number; updatedAt:string;
}
export interface ReviewQueue {items:ReviewItem[]; errors:string[]; more:ReviewCategory[]}
