/** Vector search boundary. The scan adapter avoids repeated JSON parsing and
 * normalization; an indexed implementation can replace it after measurement. */
export interface VectorSearchAdapter {
 score(key:string,serialized:string,query:number[],dimensions:number):number|undefined;
 clear():void;
}
export class CachedVectorSearch implements VectorSearchAdapter {
 private vectors=new Map<string,{serialized:string;unit:number[]|undefined}>();
 private queries=new WeakMap<number[],number[]|undefined>();
 constructor(private capacity=4096) {}
 private normalize(vector:unknown,dimensions:number):number[]|undefined {
  if(!Array.isArray(vector)||vector.length!==dimensions||Array.from(vector).some(n=>typeof n!=='number'||!Number.isFinite(n)))return;
  const magnitude=Math.sqrt(vector.reduce((sum:number,n:number)=>sum+n*n,0));
  if(!magnitude||!Number.isFinite(magnitude))return;
  return vector.map(n=>n/magnitude);
 }
 score(key:string,serialized:string,query:number[],dimensions:number):number|undefined {
  const cacheKey=`${dimensions}:${key}`;
  let entry=this.vectors.get(cacheKey);
  if(!entry||entry.serialized!==serialized) {
   let parsed:unknown;try{parsed=JSON.parse(serialized);}catch{parsed=undefined;}
   entry={serialized,unit:this.normalize(parsed,dimensions)};
   this.vectors.delete(cacheKey);
   this.vectors.set(cacheKey,entry);
   if(this.vectors.size>this.capacity)this.vectors.delete(this.vectors.keys().next().value!);
  }
  if(!this.queries.has(query))this.queries.set(query,this.normalize(query,dimensions));
  const unitQuery=this.queries.get(query);
  if(!entry.unit||!unitQuery||entry.unit.length!==dimensions||unitQuery.length!==dimensions)return;
  const score=entry.unit.reduce((sum,n,i)=>sum+n*unitQuery[i]!,0);
  return Number.isFinite(score)?Math.max(-1,Math.min(1,score)):undefined;
 }
 clear(){this.vectors.clear();this.queries=new WeakMap();}
}
