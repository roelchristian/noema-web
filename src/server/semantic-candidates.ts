/** Minimal semantic evidence retained while scanning; text and anchors load only for winners. */
export interface SemanticCandidate {id:string;ownerId:string;kind:'page'|'entity';score:number}
export type SemanticSelection={limit?:number;distinctOwners?:boolean};
export function compareSemanticCandidates(a:SemanticCandidate,b:SemanticCandidate,distinctOwners=false) {
 return b.score-a.score||(distinctOwners?a.ownerId.localeCompare(b.ownerId):a.id.localeCompare(b.id))||a.id.localeCompare(b.id);
}
/** A bounded sorted shortlist. Distinct-owner mode keeps each object's strongest passage. */
export class SemanticShortlist {
 private rows:SemanticCandidate[]=[];
 constructor(private limit:number,private distinctOwners=false) {}
 add(row:SemanticCandidate) {
  if(this.limit<=0)return;
  if(this.distinctOwners){
   const existing=this.rows.findIndex(item=>item.kind===row.kind&&item.ownerId===row.ownerId);
   if(existing>=0){if(compareSemanticCandidates(this.rows[existing]!,row,true)<=0)return;this.rows.splice(existing,1);}
  }
  let low=0,high=this.rows.length;
  while(low<high){const middle=(low+high)>>>1;if(compareSemanticCandidates(this.rows[middle]!,row,this.distinctOwners)<=0)low=middle+1;else high=middle;}
  if(low>=this.limit)return;
  this.rows.splice(low,0,row);
  if(this.rows.length>this.limit)this.rows.pop();
 }
 values(){return this.rows;}
}
