import type {Entity} from './domain.js';
export interface EntityNeighborhoodEdge {
 id:string; sourceId:string; targetId:string; label:string; kind:'relationship'|'property';
}
export interface EntityNeighborhood {
 rootId:string; nodes:Entity[]; edges:EntityNeighborhoodEdge[];
 /** Relationship labels available in the bounded unfiltered neighborhood. */
 relationTypes:string[]; truncated:boolean;
}
