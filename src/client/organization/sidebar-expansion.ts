const session = new Map<string, Set<string>>();
const storageKey = (vaultId: string) => 'noema-sidebar-expansion/' + vaultId;
export function readSidebarExpansion(vaultId?: string): Set<string> {
  if (!vaultId) return new Set();
  if (session.has(vaultId)) return new Set(session.get(vaultId));
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(vaultId)) ?? '[]');
    if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === 'string'));
  } catch { /* Keep expansion in memory when storage is unavailable. */ }
  return new Set();
}
export function saveSidebarExpansion(vaultId: string, expanded: Set<string>) {
  session.set(vaultId, new Set(expanded));
  try { localStorage.setItem(storageKey(vaultId), JSON.stringify([...expanded])); }
  catch { /* Session expansion still survives tree remounts. */ }
}
