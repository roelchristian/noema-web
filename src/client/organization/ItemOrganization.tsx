import type { ItemKind, Organization } from '../../shared/domain';
import { Select } from '../components/Select';

export function ItemOrganization({data, kind, itemId, pending, onMove}: {
  data: Organization; kind: ItemKind; itemId: string; pending: boolean;
  onMove: (collection: string, folder: string | null, remove?: boolean) => void;
}) {
  const location = (collection: string) => data.locations.find(item => item.kind === kind && item.item_id === itemId && item.collection_id === collection);
  const folderPath = (id: string) => {
    const names: string[] = [];
    let folder = data.folders.find(item => item.id === id);
    while (folder) { names.unshift(folder.name); folder = data.folders.find(item => item.id === folder!.parent_id); }
    return names.join(' / ');
  };
  const folderOptions = (collection: string) => data.folders.filter(folder => (folder.collection_id || '') === collection)
    .map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder.id)}</option>);
  return <fieldset disabled={pending} className="item-organization">
    <legend>Folders & collection membership</legend>
    <label>Vault folder<Select value={location('')?.folder_id || ''} onChange={event => onMove('', event.target.value)}><option value="">No folder</option>{folderOptions('')}</Select></label>
    {data.collections.map(collection => {
      const membership = location(collection.id);
      return <div className="membership-row" key={collection.id}><label><input type="checkbox" checked={!!membership} onChange={event => onMove(collection.id, null, !event.target.checked)}/>{collection.name}</label>{membership && <Select aria-label={'Folder in ' + collection.name} value={membership.folder_id || ''} onChange={event => onMove(collection.id, event.target.value)}><option value="">Collection root</option>{folderOptions(collection.id)}</Select>}</div>;
    })}
    {!data.collections.length && <small>Create a collection to group this item with related content.</small>}
  </fieldset>;
}
