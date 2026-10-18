import registry from './noema-domains-v1.json' with {type:'json'};
import type {Domain} from './domain.js';
export const TAXONOMY_VERSION=registry.version;
export const DOMAINS:readonly Domain[]=registry.domains;
const byId=new Map(DOMAINS.map(domain=>[domain.id,domain]));
export function domainById(id:string):Domain|undefined {return byId.get(id);}
export function domainPath(id:string):Domain[] {
  const path:Domain[]=[];let node=byId.get(id);
  while(node){path.unshift(node);node=node.parent_id?byId.get(node.parent_id):undefined;}
  return path;
}
export function validateDomainRegistry(domains:readonly Domain[]=DOMAINS) {
  const ids=new Map(domains.map(domain=>[domain.id,domain]));
  if(ids.size!==domains.length)throw new Error('Duplicate domain ID');
  for(const domain of domains){
    const seen=new Set<string>();let node:Domain|undefined=domain;
    while(node){if(seen.has(node.id))throw new Error('Cyclic domain ancestry');seen.add(node.id);
      if(node.parent_id&&!ids.has(node.parent_id))throw new Error('Unknown domain parent');node=node.parent_id?ids.get(node.parent_id):undefined;}
  }
}
validateDomainRegistry();
