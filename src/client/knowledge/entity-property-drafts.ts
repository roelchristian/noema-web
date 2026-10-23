import type {EntityType} from '../../shared/domain';
export interface ReferenceCreationDraft {open:boolean;name:string;type:EntityType;uncertain:boolean}
export interface EntityPropertyDraft {kind: 'text' | 'entity'; value: string; target: string; baseline: string; error?: string; uncertainCreate?: boolean; legacy?:boolean; referenceCreation?:ReferenceCreationDraft}
const drafts = new Map<string, EntityPropertyDraft>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
const key = (vault: string, entity: string, property: string) => JSON.stringify([vault, entity, property]);
const notify = () => listeners.forEach(listener => listener());
export function subscribePropertyDrafts(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}
export function getPropertyDraft(vault: string, entity: string, property: string) {return drafts.get(key(vault, entity, property));}
export function setPropertyDraft(vault: string, entity: string, property: string, draft: EntityPropertyDraft) {drafts.set(key(vault, entity, property), draft); notify();}
export function clearPropertyDraft(vault: string, entity: string, property: string, expected?: EntityPropertyDraft) {
  const id = key(vault, entity, property);
  if (expected && drafts.get(id) !== expected) return false;
  const removed = drafts.delete(id); if (removed) notify(); return removed;
}
export function propertyDraftSignature(draft: Pick<EntityPropertyDraft, 'kind'|'value'|'target'>) {return JSON.stringify([draft.kind, draft.kind === 'text' ? draft.value : draft.target, 'legacy' in draft?draft.legacy:false]);}
export function hasUnsavedPropertyDrafts() {return [...drafts.values()].some(draft => propertyDraftSignature(draft) !== draft.baseline||!!draft.referenceCreation&&(!!draft.referenceCreation.name.trim()||draft.referenceCreation.uncertain));}
export function clearPropertyDrafts(vault: string, validEntityIds?: Iterable<string>) {
  const valid = validEntityIds && new Set(validEntityIds);
  let changed = false;
  for (const id of drafts.keys()) {const [owner, entity] = JSON.parse(id) as [string,string]; if (owner === vault && (!valid || !valid.has(entity))) {drafts.delete(id); changed = true;}}
  for(const id of advancedSelections.keys()){const [owner,entity]=JSON.parse(id) as [string,string];if(owner===vault&&(!valid||!valid.has(entity)))advancedSelections.delete(id);}
  if (changed) notify();
}

export function propertySavePending(vault: string, entity: string, property: string) {return pending.has(key(vault,entity,property));}
export function beginPropertySave(vault: string, entity: string, property: string) {const id=key(vault,entity,property);if(pending.has(id))return false;pending.add(id);notify();return true;}
export function endPropertySave(vault: string, entity: string, property: string) {pending.delete(key(vault,entity,property));notify();}

const mutationQueues = new Map<string, Promise<unknown>>();
/** Serialize full-detail mutations so a later field cannot be replaced by an older response. */
export async function runPropertyMutation<T>(vault: string, entity: string, work: () => Promise<T>): Promise<T> {
  const id=JSON.stringify([vault,entity]);
  const previous=mutationQueues.get(id) ?? Promise.resolve();
  const current=previous.catch(()=>undefined).then(work);
  mutationQueues.set(id,current);
  try {return await current;} finally {if(mutationQueues.get(id)===current)mutationQueues.delete(id);}
}

interface AdvancedPropertySelection {edit?:string;name:string}
const advancedSelections=new Map<string,AdvancedPropertySelection>();
export function getAdvancedPropertySelection(vault:string,entity:string) {return advancedSelections.get(JSON.stringify([vault,entity]));}
export function setAdvancedPropertySelection(vault:string,entity:string,selection?:AdvancedPropertySelection) {const id=JSON.stringify([vault,entity]);if(selection)advancedSelections.set(id,selection);else advancedSelections.delete(id);}
