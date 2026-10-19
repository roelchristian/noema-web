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
export function tokenHistogram(tokens:Iterable<string>):Record<string,number> {
 const counts:Record<string,number>={};
 for(const token of tokens) {
  let hash=2166136261;
  for(let i=0;i<token.length;i++)hash=Math.imul(hash^token.charCodeAt(i),16777619);
  // Mix high bits before selecting a bucket, so shared suffixes remain well distributed.
  hash^=hash>>>16;hash=Math.imul(hash,0x85ebca6b);hash^=hash>>>13;
  const key=`b${hash&4095}`;
  counts[key]=(counts[key]??0)+1;
 }
 return counts;
}
export function compareTokenHistograms(current:TokenHistogram,baseline:TokenHistogram,currentRawTokens?:Iterable<string>):TokenHistogramComparison {
 if(!validTokenHistogram(current)||!validTokenHistogram(baseline))return {score:1,overlap:0,retainedFraction:0};
 let overlap=0;
 const lengthChange=Math.abs(current.tokenCount-baseline.tokenCount)/Math.max(1,current.tokenCount,baseline.tokenCount);
 if(baseline.version===2&&current.version===2) {
  for(const [key,count] of Object.entries(current.tokenCounts))overlap+=Math.min(count,Object.hasOwn(baseline.tokenCounts,key)?baseline.tokenCounts[key]!:0);
  const mass=Math.max(baseline.tokenCount,current.tokenCount);
  return {score:mass?1-overlap/mass:0,overlap,retainedFraction:baseline.tokenCount?overlap/baseline.tokenCount:current.tokenCount?0:1};
 }
 if(baseline.version===2)return {score:lengthChange,overlap:0,retainedFraction:1};
 // Never compare raw vocabulary keys with hash buckets. Recount the full current
 // body within the retained legacy vocabulary; its missing tail is unknowable.
 const retainedCurrent:Record<string,number>=Object.create(null);
 if(current.version!==2) {
  for(const [key,count] of Object.entries(current.tokenCounts))if(Object.hasOwn(baseline.tokenCounts,key))retainedCurrent[key]=count;
 }else if(currentRawTokens) {
  for(const token of currentRawTokens)if(Object.hasOwn(baseline.tokenCounts,token))retainedCurrent[token]=(Object.hasOwn(retainedCurrent,token)?retainedCurrent[token]!:0)+1;
 }else return {score:lengthChange,overlap:0,retainedFraction:1};
 let baselineMass=0,currentMass=0;
 for(const [token,count] of Object.entries(baseline.tokenCounts)){baselineMass+=count;const currentCount=Object.hasOwn(retainedCurrent,token)?retainedCurrent[token]!:0;currentMass+=currentCount;overlap+=Math.min(count,currentCount);}
 const vocabularyChange=baselineMass||currentMass?1-overlap/Math.max(1,baselineMass,currentMass):0;
 return {score:Math.max(lengthChange,vocabularyChange),overlap,retainedFraction:baselineMass?overlap/baselineMass:current.tokenCount?0:1};
}
