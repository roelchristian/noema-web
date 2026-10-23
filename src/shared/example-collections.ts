/** Example discovery uses stable page identities and existing local embeddings. */
export interface ExampleCollectionDefinition {
 version:1;positivePageIds:string[];negativePageIds:string[];threshold:number;minCoverage:number;negativeMargin:number;
}
export function parseExampleCollection(input:unknown):ExampleCollectionDefinition {
 const invalid=(message:string):never=>{throw new Error(`Invalid example collection: ${message}`);};
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return invalid('expected an object');
 const value=input as Record<string,unknown>;
 if(Object.keys(value).some(key=>!['version','positivePageIds','negativePageIds','threshold','minCoverage','negativeMargin'].includes(key))||value.version!==1)return invalid('unsupported definition');
 const ids=(input:unknown,min:number,max:number,label:string):string[]=>{
  if(!Array.isArray(input)||input.length<min||input.length>max)return invalid(`${label} needs ${min}–${max} pages`);
  const result=Array.from(input,value=>{if(typeof value!=='string'||!value.trim()||value.length>200||/[\u0000-\u001f\u007f]/.test(value))return invalid('invalid page identity');return value;});
  if(new Set(result).size!==result.length)return invalid('duplicate example page');return result;
 };
 const positivePageIds=ids(value.positivePageIds,2,5,'Positive examples'),negativePageIds=ids(value.negativePageIds??[],0,5,'Negative examples');
 if(negativePageIds.some(id=>positivePageIds.includes(id)))return invalid('a page cannot be both positive and negative');
 const threshold=value.threshold??.55,minCoverage=value.minCoverage??.5,negativeMargin=value.negativeMargin??.05;
 if(typeof threshold!=='number'||!Number.isFinite(threshold)||threshold<.2||threshold>.95||typeof minCoverage!=='number'||!Number.isFinite(minCoverage)||minCoverage<.1||minCoverage>1||typeof negativeMargin!=='number'||!Number.isFinite(negativeMargin)||negativeMargin<0||negativeMargin>.5)return invalid('invalid matching thresholds');
 return {version:1,positivePageIds,negativePageIds,threshold,minCoverage,negativeMargin};
}
