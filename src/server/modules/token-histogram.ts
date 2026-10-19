/** Stable bounded local token evidence. Version 1 stores a retained raw vocabulary;
 * version 2 accounts for every token in 4,096 deterministic hash buckets. */
export interface TokenHistogram {version?:1|2;tokenCounts:Record<string,number>;tokenCount:number}
export interface TokenHistogramComparison {score:number;overlap:number;retainedFraction:number}
export function validTokenHistogram(value:unknown):value is TokenHistogram {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const histogram=value as Partial<TokenHistogram>;
 if(histogram.version!==undefined&&histogram.version!==1&&histogram.version!==2)return false;
 if(!Number.isSafeInteger(histogram.tokenCount)||histogram.tokenCount! < 0||!histogram.tokenCounts||typeof histogram.tokenCounts!=='object'||Array.isArray(histogram.tokenCounts))return false;
 const entries=Object.entries(histogram.tokenCounts);
 if(entries.length>4096)return false;
 let mass=0;
 for(const [key,count] of entries) {
  if(!Number.isSafeInteger(count)||count<=0)return false;
  if(histogram.version===2&&(!/^b(?:0|[1-9]\d{0,3})$/.test(key)||Number(key.slice(1))>=4096))return false;
  mass+=count;
  if(!Number.isSafeInteger(mass)||mass>histogram.tokenCount!)return false;
 }
 if(histogram.tokenCount! > 0&&mass===0)return false;
 return histogram.version!==2||mass===histogram.tokenCount;
}
function tokenBucket(token:string):string {
 let hash=2166136261;
 for(let i=0;i<token.length;i++)hash=Math.imul(hash^token.charCodeAt(i),16777619);
 // Mix high bits before selecting a bucket, so shared suffixes remain well distributed.
 hash^=hash>>>16;hash=Math.imul(hash,0x85ebca6b);hash^=hash>>>13;
 return `b${hash&4095}`;
}
export function tokenHistogram(tokens:Iterable<string>):Record<string,number> {
 const counts:Record<string,number>={};
 for(const token of tokens) {
  const key=tokenBucket(token);
  counts[key]=(counts[key]??0)+1;
 }
 return counts;
}
/** Upgrade only when every token is represented; omitted legacy vocabulary cannot be recovered. */
export function upgradeTokenHistogram(value:unknown):TokenHistogram|undefined {
 if(!validTokenHistogram(value))return undefined;
 if(value.version===2)return value;
 const entries=Object.entries(value.tokenCounts);
 if(entries.reduce((mass,[,count])=>mass+count,0)!==value.tokenCount)return undefined;
 const tokenCounts:Record<string,number>={};
 for(const [token,count] of entries) {
  const key=tokenBucket(token);
  tokenCounts[key]=(tokenCounts[key]??0)+count;
 }
 return {version:2,tokenCounts,tokenCount:value.tokenCount};
}
export function compareTokenHistograms(current:TokenHistogram,baseline:TokenHistogram):TokenHistogramComparison {
 const currentComplete=upgradeTokenHistogram(current),baselineComplete=upgradeTokenHistogram(baseline);
 // Missing vocabulary makes both overlap and stability unknowable. Callers may
 // separately accept an exact source fingerprint, but cannot infer zero drift.
 if(!currentComplete||!baselineComplete)return {score:1,overlap:0,retainedFraction:0};
 let overlap=0;
 for(const [key,count] of Object.entries(currentComplete.tokenCounts))overlap+=Math.min(count,Object.hasOwn(baselineComplete.tokenCounts,key)?baselineComplete.tokenCounts[key]!:0);
 const mass=Math.max(baselineComplete.tokenCount,currentComplete.tokenCount);
 return {score:mass?1-overlap/mass:0,overlap,retainedFraction:baselineComplete.tokenCount?overlap/baselineComplete.tokenCount:currentComplete.tokenCount?0:1};
}
