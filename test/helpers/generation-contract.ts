import type {GenerationRequest} from '../../src/server/modules/intelligence.js';

const input='Synthetic note: a garden plan with $x^2$.',signal=new AbortController().signal;
const stream={signal,onDelta:(_delta:string)=>{}};
/** Synthetic, labeled modes captured against main before replacing the positional API. */
export const generationContracts = [
  {label:'summary',request:{kind:'summary',input}},
  {label:'validation',request:{kind:'validation'}},
  {label:'title fallback',request:{kind:'title',input}},
  {label:'utility',request:{kind:'utility',input,domains:[],currentTitle:'Garden'}},
  {label:'entity discovery',request:{kind:'entityDiscovery',input}},
  {label:'entity scan',request:{kind:'entityScan',input}},
  {label:'entity stream',request:{kind:'entityScan',input,...stream}},
  {label:'explanation',request:{kind:'explanation',input}},
  {label:'reading explanation',request:{kind:'explanation',input,options:{language:'fr',familiarity:'beginner'},signal}},
  {label:'review',request:{kind:'review',input}},
  {label:'source page',request:{kind:'sourcePage',input:JSON.stringify({options:{language:'en'},untrusted_source:{text:input}}),...stream}},
  {label:'source math',request:{kind:'sourceMath',input,background:true,...stream}},
  {label:'source enrichment',request:{kind:'sourceEnrichment',input,background:true}},
  {label:'source scholarly',request:{kind:'sourceScholarly',input,signal}},
  {label:'source authors',request:{kind:'sourceAuthors',input,background:true}},
  {label:'enrichment summary',request:{kind:'pageEnrichment',input,options:{requestedFields:['summary']}}},
  {label:'enrichment metadata',request:{kind:'pageEnrichment',input,background:true,options:{requestedFields:['title','domains','language'],domains:[],currentTitle:'Garden'}}},
  {label:'editorial',request:{kind:'editorial',input,instructions:'Synthetic editorial instruction.',signal,background:true}},
  {label:'collection rules',request:{kind:'collectionRules',input,instructions:'Synthetic collection rule instruction.'}},
] satisfies {label:string;request:GenerationRequest}[];

// Compile-only regressions: flags cannot create mixed intents or leak feature options.
function checkedRequest(_request:GenerationRequest) {}
function invalidRequests() {
  // @ts-expect-error Summaries cannot opt into personas.
  checkedRequest({kind:'summary',input,personaId:'conyo'});
  // @ts-expect-error Source preprocessing cannot opt into personas.
  checkedRequest({kind:'editorial',input,instructions:'Normalize',signal,personaId:'conyo'});
  // @ts-expect-error Math preprocessing cannot opt into personas.
  checkedRequest({kind:'sourceMath',input,signal,personaId:'conyo'});
  // @ts-expect-error Positional API has no request representation.
  checkedRequest('page');
  // @ts-expect-error Validation never carries user content.
  checkedRequest({kind:'validation',input});
  // @ts-expect-error Review cannot also select source-page policy.
  checkedRequest({kind:'review',input,onDelta:()=>{}});
  // @ts-expect-error Source pages need the authoritative delta receiver.
  checkedRequest({kind:'sourcePage',input,signal});
  // @ts-expect-error Editorial requests need trusted instructions.
  checkedRequest({kind:'editorial',input,signal});
  // @ts-expect-error Only source pages expose preliminary previews.
  checkedRequest({kind:'sourceMath',input,signal,onPreviewDelta:()=>{}});
  // @ts-expect-error Generated collection rules cannot select a persona.
  checkedRequest({kind:'collectionRules',input,instructions:'Synthetic rules',personaId:'conyo'});
}
void invalidRequests;

// Adding a request kind requires a labeled provider contract, too.
type CoveredKind = typeof generationContracts[number]['request']['kind'];
const allKindsCovered:Record<Exclude<GenerationRequest['kind'],CoveredKind>,never>={};
void allKindsCovered;
