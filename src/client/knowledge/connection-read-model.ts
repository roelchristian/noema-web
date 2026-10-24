import type {EntityConnection} from './EntityDetails';

/** Combine presentation reasons, retaining the underlying records and their editing semantics. */
export function aggregateEntityConnections(items: EntityConnection[]): EntityConnection[] {
  const targets = new Map<string, EntityConnection>();
  const reasons = new Map<string, Set<string>>();
  for (const item of items) {
    if (!targets.has(item.target)) targets.set(item.target, {...item, key: item.target});
    if (!reasons.has(item.target)) reasons.set(item.target, new Set());
    reasons.get(item.target)!.add(item.label);
  }
  return [...targets.values()].map(item => ({...item, label: [...reasons.get(item.target)!].join(' · ')}));
}
