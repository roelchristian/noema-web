import type { DragEvent } from 'react';
import type { Folder, Organization, PageSummary } from '../../shared/domain';
import { isPageDrag, readPageDrop } from './page-drag';
import { isFolderDrag, readFolderDrop } from './folder-drag';

/** One shared in-flight guard keeps repeated drops from issuing overlapping moves. */
export function folderDropHandlers({folder, vaultId, pages, data, pending, moving, onHover, onStatus, onMove, onMoveFolder, onError}: {
  folder: Folder; vaultId: string; pages: PageSummary[]; data: Organization; pending: boolean;
  moving: {current: boolean}; onHover: (id: string | null) => void; onStatus: (message: string) => void;
  onMove: (pageId: string, folderId: string) => Promise<void>;
  onMoveFolder: (source: Folder, parentId: string) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  return {
    onDragOver(event: DragEvent<HTMLElement>) {
      if (pending || moving.current || (!isPageDrag(event) && !isFolderDrag(event))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      onHover(folder.id);
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHover(null);
    },
    async onDrop(event: DragEvent<HTMLElement>) {
      if (!isPageDrag(event) && !isFolderDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onHover(null);
      if (pending || moving.current) return;
      let move: () => Promise<void>;
      let label: string;
      if (isFolderDrag(event)) {
        const sourceId = readFolderDrop(event, vaultId);
        const source = data.folders.find(item => item.id === sourceId);
        if (!source) return;
        // Walking the destination's ancestors catches self/descendant drops at
        // every depth. The server validates this again against persisted state.
        const visited = new Set<string>();
        let ancestor: Folder | undefined = folder;
        while (ancestor && !visited.has(ancestor.id)) {
          if (ancestor.id === source.id) {
            onStatus('Cannot move a folder into itself or its subfolders.');
            return;
          }
          visited.add(ancestor.id);
          ancestor = data.folders.find(item => item.id === ancestor!.parent_id);
        }
        if (source.parent_id === folder.id) {
          onStatus(`Folder is already in ${folder.name}.`);
          return;
        }
        label = 'Folder';
        move = () => onMoveFolder(source, folder.id);
      } else {
        const pageId = readPageDrop(event, vaultId);
        if (!pageId || !pages.some(page => page.id === pageId)) return;
        if (data.locations.some(location => location.kind === 'page' && location.item_id === pageId && location.folder_id === folder.id)) {
          onStatus(`Note is already in ${folder.name}.`);
          return;
        }
        label = 'Note';
        move = () => onMove(pageId, folder.id);
      }
      moving.current = true;
      onStatus(`Moving ${label.toLowerCase()} to ${folder.name}…`);
      try {
        await move();
        onStatus(`${label} moved to ${folder.name}.`);
      } catch (error) {
        onStatus(`Could not move ${label.toLowerCase()}. Try again.`);
        onError(error);
      } finally { moving.current = false; }
    },
  };
}
