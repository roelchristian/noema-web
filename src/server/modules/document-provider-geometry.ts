import type {SourceIngestionSchema} from './source-ingestion-validation.js';

/** Explicit wire units only; never infer a provider's coordinate scale from values. */
export function documentProviderGeometrySchema(provider:'openai'|'gemini',schema:Record<string,unknown>):Record<string,unknown> {
 const result=structuredClone(schema) as SourceIngestionSchema;
 const location=result.properties?.blocks?.items?.properties?.location;
 if(!location)return result as Record<string,unknown>;
 const box=location.anyOf?.find(choice=>choice.type==='object');
 if(box&&provider==='openai'){box.description='Approximate top-left box in normalized 0..1 page coordinates; x/y are left/top and width/height are extents.';for(const key of ['x','y','width','height'])if(box.properties?.[key])box.properties[key]={...box.properties[key],minimum:0,maximum:1};return result as Record<string,unknown>;}
 if(box){for(const key of ['x','y','width','height'])if(box.properties?.[key])box.properties[key]={...box.properties[key],minimum:0,maximum:1000,description:(key==='x'?'Left edge':key==='y'?'Top edge':key==='width'?'Width extent':'Height extent')+' in declared normalized 0..1000 page coordinates.'};box.properties={...box.properties,coordinateSystem:{type:'string',enum:['normalized_1000']},origin:{type:'string',enum:['top-left']}};box.required=Object.keys(box.properties);box.description='Approximate top-left box in explicitly normalized 0..1000 page coordinates. x/y are left/top; width/height are extents, not right/bottom edges.';}
 return result as Record<string,unknown>;
}
export function normalizeDocumentProviderGeometry(provider:'openai'|'gemini',input:unknown):unknown {
 if(provider!=='gemini'||!input||typeof input!=='object'||!Array.isArray((input as {blocks?:unknown}).blocks))return input;
 const result=structuredClone(input) as {blocks:Record<string,unknown>[]};
 for(const block of result.blocks){
  if(!block||typeof block!=='object'||Array.isArray(block))continue;
  const box=block.location;if(box===null||box===undefined)continue;
  const value=box&&typeof box==='object'&&!Array.isArray(box)?box as Record<string,unknown>:null;
  const fields=['x','y','width','height'];
  const valid=value&&Object.keys(value).every(key=>[...fields,'coordinateSystem','origin','accuracy'].includes(key))&&value.coordinateSystem==='normalized_1000'&&value.origin==='top-left'&&value.accuracy==='approximate'&&fields.every(key=>typeof value[key]==='number'&&Number.isFinite(value[key])&&(value[key] as number)>=0&&(value[key] as number)<=1000)&&(value.x as number)+(value.width as number)<=1000&&(value.y as number)+(value.height as number)<=1000;
  if(valid){block.location={x:(value.x as number)/1000,y:(value.y as number)/1000,width:(value.width as number)/1000,height:(value.height as number)/1000,accuracy:'approximate'};}
  else{block.location=null;const message='Provider location omitted: expected a bounded normalized_1000 top-left box with explicit units and extents.';const warnings=Array.isArray(block.layoutWarnings)?block.layoutWarnings:[];block.layoutWarnings=[...new Set([...warnings,message])];}
 }
 return result;
}
