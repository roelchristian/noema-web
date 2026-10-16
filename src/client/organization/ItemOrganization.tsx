import { useState } from 'react';
import type { ItemKind, Organization } from '../../shared/domain';
import { Select } from '../components/Select';
import { Icon } from '../components/Icon';

export function ItemOrganization({data, kind, itemId, pending, onMove}: {
  data: Organization; kind: ItemKind; itemId: string; pending: boolean;
  onMove: (collection: string, folder: string | null, remove?: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const location = (collection: string) => data.locations.find(item => item.kind === kind && item.item_id === itemId && item.collection_id === collection);
  const folderPath = (id: string) => {
    const names: string[] = [];
    let folder = data.folders.find(item => item.id === id);
    while (folder) { names.unshift(folder.name); folder = data.folders.find(item => item.id === folder!.parent_id); }
    return names.join(' / ');
  };
  const folderOptions = (collection: string) => data.folders.filter(folder => (folder.collection_id || '') === collection)
    .map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder.id)}</option>);
  const collections = data.collections.filter(collection => collection.name.toLowerCase().includes(search.trim().toLowerCase()));
  const memberships = data.collections.filter(collection => location(collection.id)).length;
  return <fieldset disabled={pending} className="item-organization" aria-busy={pending}>
    <legend className="sr-only">Folders & collection membership</legend>
    <div className="membership-heading"><strong>Collections</strong><span>{memberships ? `In ${memberships} ${memberships === 1 ? 'collection' : 'collections'}` : 'Choose one or more'}</span></div>
    {!!data.collections.length && <label className="membership-search"><Icon name="search"/><input aria-label="Find a collection" placeholder="Find a collection…" value={search} onChange={event => setSearch(event.target.value)}/></label>}
    <div className="membership-list">{collections.map(collection => {
      const membership = location(collection.id);
      return <div className={'membership-row ' + (membership ? 'is-member' : '')} key={collection.id}>
        <label className="membership-choice"><input type="checkbox" checked={!!membership} onChange={event => onMove(collection.id, null, !event.target.checked)}/><span className="membership-check"><Icon name="check"/></span><span className="destination-icon"><Icon name="collection"/></span><span className="membership-name">{collection.name}<small>{membership ? 'Added to collection' : 'Add to collection'}</small></span></label>
        {membership && data.folders.some(folder => folder.collection_id === collection.id) && <div className="membership-folder"><Icon name="folder"/><Select aria-label={'Folder in ' + collection.name} value={membership.folder_id || ''} onChange={event => onMove(collection.id, event.target.value)}><option value="">Collection root</option>{folderOptions(collection.id)}</Select></div>}
      </div>;
    })}</div>
    {!collections.length && <div className="membership-empty"><Icon name={search ? 'search' : 'collection'}/><p>{search ? 'No collections found.' : 'No collections yet.'}</p><small>{search ? 'Try a different name.' : 'Create a collection from the sidebar to bring related ideas together.'}</small></div>}
  </fieldset>;
}
