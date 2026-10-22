import type {EntityNeighborhood,EntityNeighborhoodEdge} from '../../shared/entity-neighborhood.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Knowledge} from './knowledge.js';
import {Vaults} from './vaults.js';

export const NEIGHBORHOOD_NODE_LIMIT=40,NEIGHBORHOOD_EDGE_LIMIT=100;
const CANDIDATE_LIMIT=240;
/** Traverse persisted directed edges in either direction, keeping their original identity and direction. */
export function entityNeighborhood(store:Store,vault:string,id:string,options:{depth:1|2;relationType?:string}):EntityNeighborhood {
 new Vaults(store).requireOpen(vault);
 if(options.depth!==1&&options.depth!==2)throw new HttpError(400,'Choose one or two hops');
 const knowledge=new Knowledge(store),root=knowledge.require(vault,id);
 let truncated=false;
 const candidates=new Map<string,EntityNeighborhoodEdge>(),allIds=new Set([id]);
 let frontier=[id];
 for(let hop=0;hop<options.depth&&frontier.length;hop++) {
  const marks=frontier.map(()=>'?').join(',');
  const rows=store.all<EntityNeighborhoodEdge>(`SELECT * FROM (
   SELECT 'relationship:'||r.id AS id,r.source_id AS sourceId,r.target_id AS targetId,r.label AS label,'relationship' AS kind
   FROM relationships r JOIN entities s ON s.id=r.source_id JOIN entities t ON t.id=r.target_id
   WHERE s.vault_id=? AND t.vault_id=? AND (r.source_id IN (${marks}) OR r.target_id IN (${marks}))
   UNION ALL
   SELECT 'property:'||p.id AS id,p.entity_id AS sourceId,p.target_id AS targetId,p.name AS label,'property' AS kind
   FROM properties p JOIN entities s ON s.id=p.entity_id JOIN entities t ON t.id=p.target_id
   WHERE s.vault_id=? AND t.vault_id=? AND (p.entity_id IN (${marks}) OR p.target_id IN (${marks}))
  ) ORDER BY kind,label,sourceId,targetId,id LIMIT ?`,vault,vault,...frontier,...frontier,vault,vault,...frontier,...frontier,CANDIDATE_LIMIT+1);
  if(rows.length>CANDIDATE_LIMIT)truncated=true;
  const next=new Set<string>();
  for(const edge of rows.slice(0,CANDIDATE_LIMIT)) {
   candidates.set(edge.id,edge);
   for(const target of [edge.sourceId,edge.targetId])if(!allIds.has(target)){allIds.add(target);next.add(target);}
  }
  // Limit expansion as well as the response; a dense vault cannot generate an unbounded IN clause.
  frontier=[...next].sort().slice(0,NEIGHBORHOOD_NODE_LIMIT-1);
  if(next.size>frontier.length)truncated=true;
 }
 const allEdges=[...candidates.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||a.label.localeCompare(b.label)||a.sourceId.localeCompare(b.sourceId)||a.targetId.localeCompare(b.targetId)||a.id.localeCompare(b.id));
 const relationTypes=[...new Set(allEdges.filter(edge=>edge.kind==='relationship').map(edge=>edge.label))].sort();
 const eligible=allEdges.filter(edge=>edge.kind==='property'||!options.relationType||edge.label===options.relationType);
 const nodes=[root],selected=new Set([id]),edges:EntityNeighborhoodEdge[]=[];
 let visibleFrontier=new Set([id]);
 for(let hop=0;hop<options.depth;hop++) {
  const next=new Set<string>();
  for(const edge of eligible) {
   if(!visibleFrontier.has(edge.sourceId)&&!visibleFrontier.has(edge.targetId))continue;
   if(edges.some(item=>item.id===edge.id))continue;
   const additions=[...new Set([edge.sourceId,edge.targetId])].filter(target=>!selected.has(target));
   if(nodes.length+additions.length>NEIGHBORHOOD_NODE_LIMIT||edges.length>=NEIGHBORHOOD_EDGE_LIMIT){truncated=true;continue;}
   for(const target of additions){nodes.push(knowledge.require(vault,target));selected.add(target);next.add(target);}
   edges.push(edge);
  }
  visibleFrontier=next;
 }
 return {rootId:id,nodes,edges,relationTypes,truncated};
}
