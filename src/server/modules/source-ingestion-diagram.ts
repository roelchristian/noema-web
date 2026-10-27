/** Optional diagram interpretation. The original figure text/image remains evidence;
 * a structurally consistent graph is not independently verified mathematics. */
import type {SourceIngestionDiagram} from '../../shared/source-ingestion.js';
export type {SourceIngestionDiagram} from '../../shared/source-ingestion.js';
const text={type:'string'};
const nullableText={anyOf:[text,{type:'null'}]};
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
export const SOURCE_INGESTION_DIAGRAM_SCHEMA=object({
 nodes:{type:'array',items:object({id:text,label:text,quote:text})},
 edges:{type:'array',items:object({from:text,to:text,direction:{type:'string',enum:['undirected','directed']},label:nullableText,quote:nullableText})},
 uncertainty:nullableText,
});
export const sourceIngestionDiagramPrompt=' For a visible mathematical diagram use kind=figure and retain its complete printed labels in block.text. Set diagram=null for all non-figure blocks and for figures whose topology cannot be read. A diagram is an approximate interpretation of visible printed connections, not a native geometric or mathematical verification. Give every visible node a local ID, its literal printed label and an exact nonempty quote from block.text containing that label. Add only directly visible connections: direction=undirected for a plain line without arrowheads; direction=directed for an explicitly printed arrow, from its tail to its head. Never infer a transitive edge, reverse an arrow from mathematical convention, or add an arrowhead to a plain inclusion line. Preserve printed edge labels with exact quotes; use label=null and quote=null for unlabelled connections. Do not derive connections just because labels appear near each other. If an endpoint, connector or arrowhead is ambiguous, omit that edge and explain the ambiguity in diagram.uncertainty; do not guess the graph. Use at most 64 nodes and 128 edges. Keep the original page image as the placement evidence.';
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,expected:string[])=>Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
const bounded=(value:unknown,max:number):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\uD800-\uDFFF]/u.test(value)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
/** Throws for invalid supplied graphs; absent/null diagrams support legacy IR.
 * Quote checks establish source-text anchoring only, not optical correctness. */
export function validateSourceIngestionDiagram(value:unknown,block:{kind:string;text:string}):SourceIngestionDiagram|null {
 if(value===undefined||value===null)return null;
 if(block.kind!=='figure')throw new Error('Diagram interpretation requires a figure block');
 if(!record(value)||!keys(value,['nodes','edges','uncertainty'])||!Array.isArray(value.nodes)||value.nodes.length<1||value.nodes.length>64||!Array.isArray(value.edges)||value.edges.length>128||value.uncertainty!==null&&(!bounded(value.uncertainty,2000)))throw new Error('Invalid or oversized diagram interpretation');
 const ids=new Set<string>();
 for(const node of value.nodes){
  if(!record(node)||!keys(node,['id','label','quote'])||!bounded(node.id,128)||!bounded(node.label,1000)||!bounded(node.quote,2000)||ids.has(node.id)||!node.quote.includes(node.label)||!block.text.includes(node.quote))throw new Error('Diagram node requires a unique ID and exact printed-label quotation');
  ids.add(node.id);
 }
 const connections=new Set<string>();
 for(const edge of value.edges){
  if(!record(edge)||!keys(edge,['from','to','direction','label','quote'])||typeof edge.from!=='string'||typeof edge.to!=='string'||!ids.has(edge.from)||!ids.has(edge.to)||!['undirected','directed'].includes(String(edge.direction)))throw new Error('Diagram connection requires existing endpoints and explicit printed direction');
  if(edge.label===null?edge.quote!==null:!bounded(edge.label,1000)||!bounded(edge.quote,2000)||!edge.quote.includes(edge.label)||!block.text.includes(edge.quote))throw new Error('Diagram edge label requires an exact printed-label quotation');
  // Plain lines have no orientation: reversing one is the same connection.
  const endpoints=edge.direction==='undirected'?[edge.from,edge.to].sort():[edge.from,edge.to];
  const key=JSON.stringify([edge.direction,...endpoints,edge.label]);
  if(connections.has(key))throw new Error('Duplicate diagram connection');
  connections.add(key);
 }
 return structuredClone(value) as unknown as SourceIngestionDiagram;
}
