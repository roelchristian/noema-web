import type {Entity} from './domain.js';

/** Recognition and displayed mention names depend on this dictionary, not import progress. */
export function entityMatchingDictionary(entities: Entity[], vaultId?: string): string {
  return JSON.stringify(entities.filter(entity=>!vaultId||entity.vault_id===vaultId).map(entity=>[
    entity.vault_id,entity.id,entity.name,[...(entity.aliases??[])].sort(),entity.mentionCase,
    entity.type,[...entity.subtypes].sort(),entity.referentStatus,!!entity.inactive,entity.archived_at??null,
  ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))||String(a[1]).localeCompare(String(b[1]))));
}
