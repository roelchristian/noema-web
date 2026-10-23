import type {Entity,EntityType} from './domain.js';
import {isPageIconId,type PageIconId} from './page-icons.js';

export type SubtypeIcons=Record<string,PageIconId|null>;
export const defaultSubtypeIcons:SubtypeIcons={
  'creativework:book':'book','creativework:song':'music','creativework:album':'music',
  'creativework:film':'camera','creativework:article':'scroll','creativework:journal':'journal',
  'creativework:poem':'feather','creativework:software':'code','creativework:academic-paper':'scroll',
};

export function subtypeIcon(type:EntityType,id:string,overrides:SubtypeIcons={}):PageIconId|null {
  if(Object.hasOwn(overrides,id))return isPageIconId(overrides[id])?overrides[id]:null;
  return id.startsWith(type+':')?defaultSubtypeIcons[id]??null:null;
}

/** The first explicitly assigned subtype wins, then the first subtype default. */
export function resolveEntityIcon(entity:Pick<Entity,'type'|'subtypes'>,overrides:SubtypeIcons={}):PageIconId|null {
  const explicit=entity.subtypes.find(id=>Object.hasOwn(overrides,id));
  if(explicit!==undefined)return subtypeIcon(entity.type,explicit,overrides);
  for(const id of entity.subtypes){const icon=subtypeIcon(entity.type,id,overrides);if(icon)return icon;}
  return null;
}

export function entityIconName(entity:Pick<Entity,'type'|'subtypes'|'icon'>|undefined,overrides?:SubtypeIcons):string {
  if(!entity)return 'knowledge';
  const icon=overrides===undefined&&entity.icon!==undefined?entity.icon:resolveEntityIcon(entity,overrides);
  return icon?'page:'+icon:entity.type;
}
