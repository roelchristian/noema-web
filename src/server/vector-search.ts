/** Vector search boundary. The scan adapter avoids repeated JSON parsing and
 * normalization; an indexed implementation can replace it after measurement. */
export interface VectorSearchAdapter {
 score(key:string,serialized:string,query:number[],dimensions:number):number|undefined;
 clear():void;
}
type VectorEntry={serialized:string;unit:Float64Array|undefined;bytes:number};
export class CachedVectorSearch implements VectorSearchAdapter {
 // Keep most residents through a sequential scan. A small admission window lets
 // recurring new working sets replace them, without a capacity+1 scan flushing
 // every entry. Hits in the window are promoted; resident hits refresh recency.
 private residents=new Map<string,VectorEntry>();
 private probation=new Map<string,VectorEntry>();
 private queries=new WeakMap<number[],Float64Array|undefined>();
 private bytes=0;
 private residentBytes=0;
 private residentCapacity:number;
 constructor(private capacity=4096,private maxBytes=256*1024*1024) {
  this.capacity=Math.max(0,Math.floor(capacity));
  this.maxBytes=Math.max(0,maxBytes);
  this.residentCapacity=Math.floor(this.capacity*7/8);
 }
 private normalize(vector:unknown,dimensions:number):Float64Array|undefined {
  if(!Array.isArray(vector)||vector.length!==dimensions||Array.from(vector).some(n=>typeof n!=='number'||!Number.isFinite(n)))return;
  const magnitude=Math.sqrt(vector.reduce((sum:number,n:number)=>sum+n*n,0));
  if(!magnitude||!Number.isFinite(magnitude))return;
  // Double precision preserves the previous normalization and ranking arithmetic.
  const unit=new Float64Array(dimensions);
  for(let index=0;index<dimensions;index++)unit[index]=vector[index]/magnitude;
  return unit;
 }
 private remove(map:Map<string,VectorEntry>,key:string) {
  const entry=map.get(key);
  if(entry){map.delete(key);this.bytes-=entry.bytes;if(map===this.residents)this.residentBytes-=entry.bytes;}
 }
 private trim() {
  while(this.residents.size+this.probation.size>this.capacity||this.bytes>this.maxBytes) {
   const map=this.probation.size?this.probation:this.residents;
   this.remove(map,map.keys().next().value!);
  }
 }
 score(key:string,serialized:string,query:number[],dimensions:number):number|undefined {
  const cacheKey=`${dimensions}:${key}`;
  let entry=this.residents.get(cacheKey)??this.probation.get(cacheKey);
  if(entry&&entry.serialized===serialized) {
   if(this.residents.has(cacheKey)){this.residents.delete(cacheKey);this.residents.set(cacheKey,entry);}
   else if(this.residentCapacity) {
    this.probation.delete(cacheKey);this.residents.set(cacheKey,entry);this.residentBytes+=entry.bytes;
    while(this.residents.size>this.residentCapacity||this.residentBytes>this.maxBytes*7/8) {
     const oldest=this.residents.keys().next().value!,demoted=this.residents.get(oldest)!;
     this.residents.delete(oldest);this.residentBytes-=demoted.bytes;this.probation.set(oldest,demoted);
    }
   }
  }else {
   this.remove(this.residents,cacheKey);this.remove(this.probation,cacheKey);
   let parsed:unknown;try{parsed=JSON.parse(serialized);}catch{parsed=undefined;}
   const unit=this.normalize(parsed,dimensions);
   // Account conservatively for UTF-16 strings, the typed vector, and entry/key
   // overhead. The budget bounds retained payload; engine Map overhead varies.
   entry={serialized,unit,bytes:serialized.length*2+cacheKey.length*2+(unit?.byteLength??0)+128};
   if(this.capacity&&entry.bytes<=this.maxBytes) {
    const map=this.residents.size<this.residentCapacity&&this.residentBytes+entry.bytes<=this.maxBytes*7/8?this.residents:this.probation;
    map.set(cacheKey,entry);this.bytes+=entry.bytes;if(map===this.residents)this.residentBytes+=entry.bytes;this.trim();
   }
  }
  if(!this.queries.has(query))this.queries.set(query,this.normalize(query,dimensions));
  const unitQuery=this.queries.get(query);
  if(!entry.unit||!unitQuery||entry.unit.length!==dimensions||unitQuery.length!==dimensions)return;
  let score=0;
  for(let index=0;index<dimensions;index++)score+=entry.unit[index]!*unitQuery[index]!;
  return Number.isFinite(score)?Math.max(-1,Math.min(1,score)):undefined;
 }
 /** Diagnostics contain counts only, never keys, vectors, or source text. */
 cacheStats(){return {entries:this.residents.size+this.probation.size,residents:this.residents.size,probation:this.probation.size,estimatedBytes:this.bytes,maxBytes:this.maxBytes};}
 clear(){this.residents.clear();this.probation.clear();this.bytes=0;this.residentBytes=0;this.queries=new WeakMap();}
}
