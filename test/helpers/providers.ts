import type {Intelligence} from '../../src/server/modules/intelligence.js';

/** Only the interface consumed by PageEnrichment; signature drift fails typecheck. */
export function enrichmentProvider(
  generate: Intelligence['generatePageEnrichment'],
  selection: ReturnType<Intelligence['enrichmentSelection']>={model:'gpt-6-luna',reasoningEffort:'none'},
): Pick<Intelligence,'enrichmentSelection'|'generatePageEnrichment'> {
  return {enrichmentSelection:()=>selection,generatePageEnrichment:generate};
}

/** Transport doubles honor the selective schema rather than returning obsolete plain text. */
export function completedResponse(value:string|Record<string,unknown>):Response {
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:typeof value==='string'?value:JSON.stringify(value)}]}]});
}
export function enrichmentResponse(body:string,values:Awaited<ReturnType<Intelligence['generatePageEnrichment']>>):Response {
  const required=JSON.parse(body).text.format.schema.required as string[];
  const output=Object.fromEntries(required.map(key=>{
    if(!Object.hasOwn(values,key))throw new Error(`Provider fixture is missing requested field: ${key}`);
    return [key,values[key as keyof typeof values]];
  }));
  return completedResponse(output);
}
