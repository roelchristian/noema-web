import {normalizeEntityName} from '../../shared/auto-entities.js';
import type {SourceFile} from '../../shared/domain.js';
import {Store} from '../store.js';
import {proposeValue,rawSourceHash} from './property-provenance.js';

export interface SourceAuthor {name:string;type:'person'|'organization'}
export interface SourceAuthorContext {file?:Pick<SourceFile,'id'|'text'>;workflow?:string}
const normalized=(name:string)=>normalizeEntityName(name.normalize('NFC'));
type Candidate={id:string;name:string;type:SourceAuthor['type'];aliases:string;inactive:number;archived_at:string|null};

/** Extraction is evidence, not permission to rewrite authored credits or create identities.
 * Callers may resolve these proposals deliberately through property review. */
export function saveSourceAuthors(store:Store,vault:string,sourceId:string,authors:SourceAuthor[],context:SourceAuthorContext={}):boolean {
 const source=store.get('SELECT 1 FROM entities WHERE id=? AND vault_id=? AND type=? AND archived_at IS NULL',sourceId,vault,'source');
 if(!source)return false;
 const candidates=store.all<Candidate>("SELECT id,name,type,aliases,inactive,archived_at FROM entities WHERE vault_id=? AND type IN ('person','organization')",vault);
 const properties=store.all<{id:string;value:string|null;target_id:string|null}>("SELECT id,value,target_id FROM properties WHERE entity_id=? AND name COLLATE NOCASE='author'",sourceId);
 const unique=[...new Map(authors.filter(author=>author.name.trim()).map(author=>[`${author.type}:${normalized(author.name)}`,author])).values()];
 const attached=context.file?store.get<{id:string;text:string}>('SELECT id,text FROM source_files WHERE id=? AND vault_id=? AND entity_id=?',context.file.id,vault,sourceId):undefined;
 if(context.file&&!attached)return false;
 const files=attached?[attached]:store.all<{id:string;text:string}>('SELECT id,text FROM source_files WHERE vault_id=? AND entity_id=? ORDER BY created_at,id LIMIT 2',vault,sourceId);
 // Legacy multi-file callers cannot attribute an extraction to one attachment safely.
 const file=attached??(files.length===1?files[0]:undefined);
 const sourceHash=file?rawSourceHash(context.file?.text??file.text):null;
 const prior=new Set(store.all<{id:string}>('SELECT id FROM property_proposals WHERE entity_id=? AND vault_id=?',sourceId,vault).map(row=>row.id));
 let changed=false;
 for(const author of unique) {
  const key=normalized(author.name),eligible=candidates.filter(entity=>entity.type===author.type);
  const canonical=eligible.filter(entity=>normalized(entity.name)===key);
  const matches=canonical.length?canonical:eligible.filter(entity=>{try{return (JSON.parse(entity.aliases) as string[]).some(alias=>normalized(alias)===key);}catch{return false;}});
  const target=matches.length===1&&!matches[0]!.inactive&&!matches[0]!.archived_at?matches[0]:undefined;
  if(target&&properties.some(property=>property.target_id===target.id))continue;
  if(!target&&properties.some(property=>property.target_id===null&&property.value===author.name))continue;
  const related=properties.find(property=>property.value===author.name)??properties.find(property=>property.value?.trim()||property.target_id);
  const proposal=proposeValue(store,vault,{entity_id:sourceId,kind:'property',property_name:'author',property_id:related?.id??null,value:target?null:author.name,target_id:target?.id??null,origin:'ai',source_file_id:file?.id??null,source_hash:sourceHash,details:`${context.workflow??'source_author_reconciliation'}: extracted ${author.type} credit ${author.name}. ${target?'Unique existing identity offered for review.':'Unresolved credit; identity is missing, ambiguous or archived.'} Existing authored credits are retained.`});
  if(!prior.has(proposal.id)){changed=true;prior.add(proposal.id);}
 }
 return changed;
}
