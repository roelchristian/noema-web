import {clearPropertyDrafts, hasUnsavedPropertyDrafts} from './entity-property-drafts';
import type {ReferentStatus, EntityDetail, EntityMentionCase, EntityType} from '../../shared/domain';
import {parseAliases} from './AliasInput';

export interface EntityDraftValues {
  referentStatus?: ReferentStatus; name: string; type: EntityType; description: string; subtypes: string[]; domainIds: string[]; aliases: string; mentionCase: EntityMentionCase;
}
export interface EntityDraft {baseline: EntityDraftValues; values: EntityDraftValues}
const drafts = new Map<string, Map<string, EntityDraft>>();
export interface EntityOverviewDraft {content: string; baseline: string; revision: number}
const overviewDrafts = new Map<string, Map<string, EntityOverviewDraft>>();
export function getEntityOverviewDraft(vaultId: string, entityId: string) {return overviewDrafts.get(vaultId)?.get(entityId);}
export function setEntityOverviewDraft(vaultId: string, entityId: string, draft: EntityOverviewDraft) {
  if (draft.content === draft.baseline) {clearEntityOverviewDraft(vaultId, entityId); return;}
  const vault = overviewDrafts.get(vaultId) ?? new Map<string, EntityOverviewDraft>();
  vault.set(entityId, draft); overviewDrafts.set(vaultId, vault); notify();
}
export function clearEntityOverviewDraft(vaultId: string, entityId: string, expected?: EntityOverviewDraft) {
  const vault = overviewDrafts.get(vaultId);
  if (!vault || expected && vault.get(entityId) !== expected) return false;
  const removed = vault.delete(entityId); if (!vault.size) overviewDrafts.delete(vaultId); if (removed) notify(); return removed;
}
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export function subscribeEntityDrafts(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}
export function getEntityDraft(vaultId: string, entityId: string) {return drafts.get(vaultId)?.get(entityId);}
export function hasEntityDraft(vaultId: string, entityId: string) {return !!getEntityDraft(vaultId, entityId);}
export function entityDraftValues(entity: EntityDetail): EntityDraftValues {
  return {referentStatus:entity.referentStatus??'unspecified',name: entity.name, type: entity.type, description: entity.description, subtypes: [...entity.subtypes], domainIds: [...(entity.domainIds ?? [])], aliases: (entity.aliases ?? []).join('\n'), mentionCase: entity.mentionCase ?? 'canonical'};
}
function sameField(key: keyof EntityDraftValues, left: EntityDraftValues, right: EntityDraftValues) {
  if (key === 'subtypes' || key === 'domainIds') return JSON.stringify([...(left[key] ?? [])].sort()) === JSON.stringify([...(right[key] ?? [])].sort());
  return left[key] === right[key];
}
export function entityDraftDirty(values: EntityDraftValues, baseline: EntityDraftValues) {
  return (Object.keys(values) as (keyof EntityDraftValues)[]).some(key => key === 'aliases' ? JSON.stringify(parseAliases(values.aliases)) !== JSON.stringify(parseAliases(baseline.aliases)) : !sameField(key, values, baseline));
}
/** Untouched fields follow server refreshes; fields changed by the user retain their draft. */
export function mergeEntityDraft(draft: EntityDraft | undefined, server: EntityDraftValues): EntityDraftValues {
  if (!draft) return server;
  return Object.fromEntries((Object.keys(server) as (keyof EntityDraftValues)[]).map(key => [key, sameField(key, draft.values, draft.baseline) ? server[key] : draft.values[key]])) as unknown as EntityDraftValues;
}
export function setEntityDraft(vaultId: string, entityId: string, baseline: EntityDraftValues, values: EntityDraftValues) {
  // Preserve raw alias whitespace while typing, including the newline before a new alias.
  if ((Object.keys(values) as (keyof EntityDraftValues)[]).every(key => sameField(key, values, baseline))) {clearEntityDraft(vaultId, entityId); return;}
  const vault = drafts.get(vaultId) ?? new Map<string, EntityDraft>();
  vault.set(entityId, {baseline, values}); drafts.set(vaultId, vault); notify();
}
/** A completed older save must never discard edits made after it started. */
export function clearEntityDraft(vaultId: string, entityId: string, expected?: EntityDraft) {
  const vault = drafts.get(vaultId);
  if (!vault || expected && vault.get(entityId) !== expected) return false;
  const removed = vault.delete(entityId);
  if (!vault.size) drafts.delete(vaultId);
  if (removed) notify();
  return removed;
}
export function clearEntityDrafts(vaultId: string) {clearPropertyDrafts(vaultId); const removed = drafts.delete(vaultId); const overviewRemoved = overviewDrafts.delete(vaultId); if (removed || overviewRemoved) notify();}
export function pruneEntityDrafts(vaultId: string, validEntityIds: Iterable<string>) {
  const valid = new Set(validEntityIds);
  clearPropertyDrafts(vaultId, valid);
  const overviews = overviewDrafts.get(vaultId);
  if (overviews) for (const id of overviews.keys()) if (!valid.has(id)) clearEntityOverviewDraft(vaultId, id);
  const vault = drafts.get(vaultId); if (!vault) return;
  let changed = false;
  for (const id of vault.keys()) if (!valid.has(id)) {vault.delete(id); changed = true;}
  if (!vault.size) drafts.delete(vaultId);
  if (changed) notify();
}

export function hasUnsavedEntityDrafts() {
  return hasUnsavedPropertyDrafts() || overviewDrafts.size > 0 || [...drafts.values()].some(vault=>[...vault.values()].some(draft=>entityDraftDirty(draft.values,draft.baseline)));
}
