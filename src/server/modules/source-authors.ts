import {randomUUID} from 'node:crypto';
import {normalizeEntityName} from '../../shared/auto-entities.js';
import type {Entity} from '../../shared/domain.js';
import {Store} from '../store.js';
import {Knowledge} from './knowledge.js';

export interface SourceAuthor {name:string;type:'person'|'organization'}
const normalized=(name:string)=>normalizeEntityName(name.normalize('NFC'));

/** Called in the enrichment transaction, so new authors and their links save together. */
export function saveSourceAuthors(store:Store,vault:string,sourceId:string,authors:SourceAuthor[]):boolean {
 const knowledge=new Knowledge(store);
 const entities=knowledge.list(vault).filter(entity=>!entity.inactive&&(entity.type==='person'||entity.type==='organization'));
 const unique=[...new Map(authors.map(author=>[`${author.type}:${normalized(author.name)}`,author])).values()];
 const properties=store.all<{id:string;value:string|null;target_id:string|null}>("SELECT id,value,target_id FROM properties WHERE entity_id=? AND name COLLATE NOCASE='author'",sourceId);
 const linked=new Set(properties.flatMap(property=>property.target_id?[property.target_id]:[]));
 const textCredits=new Set(properties.flatMap(property=>property.value?.split(';').map(normalized).filter(Boolean)??[]));
 let changed=false;
 const resolve=(author:SourceAuthor):Entity|undefined=>{
  const key=normalized(author.name),candidates=entities.filter(entity=>entity.type===author.type);
  const canonical=candidates.filter(entity=>normalized(entity.name)===key);
  const matches=canonical.length?canonical:candidates.filter(entity=>entity.aliases?.some(alias=>normalized(alias)===key));
  if(matches.length===1)return matches[0];
  // An ambiguous name stays as text instead of choosing a person arbitrarily.
  if(matches.length>1)return;
  const created=knowledge.create(vault,{type:author.type,name:author.name,subtypes:[]});
  entities.push(created);return created;
 };
 const put=(author:SourceAuthor,propertyId?:string,convertingText=false)=>{
  if(!propertyId&&!convertingText&&textCredits.has(normalized(author.name)))return;
  const target=resolve(author);
  if(target&&linked.has(target.id)) {
   if(propertyId){store.run('DELETE FROM properties WHERE id=? AND entity_id=?',propertyId,sourceId);changed=true;}
   return;
  }
  const value=target?null:author.name,targetId=target?.id??null;
  if(propertyId)store.run('UPDATE properties SET value=?,target_id=? WHERE id=? AND entity_id=?',value,targetId,propertyId,sourceId);
  else store.run('INSERT INTO properties (id,entity_id,name,value,target_id) VALUES (?,?,?,?,?)',randomUUID(),sourceId,'author',value,targetId);
  if(target)linked.add(target.id);changed=true;
 };
 const populated=properties.filter(property=>property.target_id||property.value?.trim());
 if(populated.length) {
  // Match existing text credits against explicit authors or known names/aliases.
  // Semicolons separate coauthors; commas can be part of names.
  for(const property of populated) {
   if(property.target_id||!property.value)continue;
   const names=property.value.split(';').map(name=>normalized(name)).filter(Boolean);
   const matches=names.map(name=>{
    const explicit=unique.filter(author=>normalized(author.name)===name);
    if(explicit.length)return explicit;
    const canonical=entities.filter(entity=>normalized(entity.name)===name);
    const known=canonical.length?canonical:entities.filter(entity=>entity.aliases?.some(alias=>normalized(alias)===name));
    return known.length===1?[{name:known[0]!.name,type:known[0]!.type as SourceAuthor['type']}]:[];
   });
   if(!names.length||matches.some(match=>match.length!==1))continue;
   matches.forEach((match,index)=>put(match[0]!,index===0?property.id:undefined,true));
  }
  // Retain existing links while adding explicitly credited coauthors that are
  // not yet represented. Unmatched user-entered text is never discarded.
  for(const author of unique)put(author);
  return changed;
 }
 if(!unique.length)return false;
 for(const property of properties)store.run('DELETE FROM properties WHERE id=? AND entity_id=?',property.id,sourceId);
 for(const author of unique)put(author);
 return changed;
}
