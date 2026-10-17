import type { DragEvent } from 'react';

const folderType = 'application/x-noema-folder';

export function startFolderDrag(event: DragEvent, vaultId: string, folderId: string) {
  event.dataTransfer.setData(folderType, JSON.stringify({vaultId, folderId}));
  event.dataTransfer.effectAllowed = 'move';
}

export function isFolderDrag(event: DragEvent) {
  return event.dataTransfer.types.includes(folderType);
}

export function readFolderDrop(event: DragEvent, vaultId: string): string | null {
  try {
    const value = JSON.parse(event.dataTransfer.getData(folderType));
    return value?.vaultId === vaultId && typeof value.folderId === 'string' ? value.folderId : null;
  } catch { return null; }
}
