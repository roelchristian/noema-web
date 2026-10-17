import { useState } from 'react';
import type { ItemKind, Organization } from '../../shared/domain';
import { Select } from '../components/Select';
import { Icon } from '../components/Icon';

export function ItemOrganization({data, kind, itemId, pending, onMove}: {
  data: Organization; kind: ItemKind; itemId: string; pending: boolean;
  onMove: (collection: string, folder: string | null, remove?: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const location = data.locations.find(item => item.kind === kind && item.item_id === itemId);
  const membership = (collection: string) => data.memberships.some(item => item.kind === kind && item.item_id === itemId && item.collection_id === collection);
  const folderPath = (id: string) => {
    const names: string[] = [];
    let folder = data.folders.find(item => item.id === id);
    while (folder) { names.unshift(folder.name); folder = data.folders.find(item => item.id === folder!.parent_id); }
    return names.join(' / ');
  };
  const collections = data.collections.filter(collection => collection.name.toLowerCase().includes(search.trim().toLowerCase()));
  const count = data.collections.filter(collection => membership(collection.id)).length;
  return <fieldset disabled={pending} className="item-organization" aria-busy={pending}>
    <legend className="sr-only">Folder location and collection memberships</legend>
    <div className="membership-heading"><strong>Folder</strong><span>One location</span></div>
    <label className="membership-folder"><Icon name="folder"/><Select aria-label="Move to folder" value={location?.folder_id || ''} onChange={event => onMove('', event.target.value || null)}><option value="">Inbox (unfiled)</option>{data.folders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder.id)}</option>)}</Select></label>
    <p className="organization-hint">Moving changes the location. Collections stay the same.</p>
    <div className="membership-heading"><strong>Collections</strong><span>{count ? `In ${count} ${count === 1 ? 'collection' : 'collections'}` : 'Choose one or more'}</span></div>
    <p className="organization-hint">Curate related ideas without moving them.</p>
    {!!data.collections.length && <label className="membership-search"><Icon name="search"/><input aria-label="Find a collection" placeholder="Find a collection…" value={search} onChange={event => setSearch(event.target.value)}/></label>}
    <div className="membership-list">{collections.map(collection => <div className={'membership-row ' + (membership(collection.id) ? 'is-member' : '')} key={collection.id}>
      <label className="membership-choice"><input type="checkbox" checked={membership(collection.id)} onChange={event => onMove(collection.id, null, !event.target.checked)}/><span className="membership-check"><Icon name="check"/></span><span className="destination-icon"><Icon name="collection"/></span><span className="membership-name">{collection.name}<small>{membership(collection.id) ? 'Remove membership without moving' : 'Add without moving'}</small></span></label>
    </div>)}</div>
    {!collections.length && <div className="membership-empty"><Icon name={search ? 'search' : 'collection'}/><p>{search ? 'No collections found.' : 'No collections yet.'}</p><small>{search ? 'Try a different name.' : 'Create a collection from the sidebar to bring related ideas together.'}</small></div>}
  </fieldset>;
}
