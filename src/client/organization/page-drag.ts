import type { DragEvent } from 'react';

const pageType = 'application/x-noema-page';

export function startPageDrag(event: DragEvent, vaultId: string, pageId: string) {
  event.dataTransfer.setData(pageType, JSON.stringify({vaultId, pageId}));
  event.dataTransfer.effectAllowed = 'copyMove';
}

export function isPageDrag(event: DragEvent) {
  return event.dataTransfer.types.includes(pageType);
}

export function readPageDrop(event: DragEvent, vaultId: string): string | null {
  try {
    const value = JSON.parse(event.dataTransfer.getData(pageType));
    return value?.vaultId === vaultId && typeof value.pageId === 'string' ? value.pageId : null;
  } catch { return null; }
}
