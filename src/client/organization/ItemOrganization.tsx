import {t as uiText} from '../i18n';
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
  const automatic = (collection: string) => data.memberships.some(item => item.kind === kind && item.item_id === itemId && item.collection_id === collection && item.automatic && data.collections.find(c=>c.id===collection)?.kind!=='smart');
  const folderPath = (id: string) => {
    const names: string[] = [];
    let folder = data.folders.find(item => item.id === id);
    while (folder) { names.unshift(folder.name); folder = data.folders.find(item => item.id === folder!.parent_id); }
    return names.join(' / ');
  };
  const collections = data.collections.filter(collection => collection.name.toLowerCase().includes(search.trim().toLowerCase()));
  const count = data.collections.filter(collection => membership(collection.id)).length;
  return <fieldset disabled={pending} className="item-organization" aria-busy={pending}>
    <legend className="sr-only">{uiText("Folder location and collection memberships")}</legend>
    <div className="membership-heading"><strong>{uiText("Folder")}</strong><span>{uiText("One location")}</span></div>
    <label className="membership-folder"><Icon name="folder"/><Select aria-label={uiText("Move to folder")} value={location?.folder_id || ''} onChange={event => onMove('', event.target.value || null)}><option value="">{uiText("Inbox (unfiled)")}</option>{data.folders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder.id)}</option>)}</Select></label>
    <p className="organization-hint">{uiText("Moving changes the location. Collections stay the same.")}</p>
    <div className="membership-heading"><strong>{uiText("Collections")}</strong><span>{count ? uiText("In {value0} {value1}",{value0: count,value1: count === 1 ? 'collection' : 'collections'}) : uiText("Choose one or more")}</span></div>
    <p className="organization-hint">{uiText("Curate related ideas without moving them.")}</p>
    {!!data.collections.length && <label className="membership-search"><Icon name="search"/><input aria-label={uiText("Find a collection")} placeholder={uiText("Find a collection…")} value={search} onChange={event => setSearch(event.target.value)}/></label>}
    <div className="membership-list">{collections.map(collection => <div className={'membership-row ' + (membership(collection.id) ? 'is-member' : '')} key={collection.id}>
      <label className="membership-choice"><input type="checkbox" checked={membership(collection.id)} disabled={automatic(collection.id)} onChange={event => onMove(collection.id, null, !event.target.checked)}/><span className="membership-check"><Icon name="check"/></span><span className="destination-icon"><Icon name="collection"/></span><span className="membership-name">{collection.name}<small>{collection.kind==='smart' ? (membership(collection.id)?'Smart · Uncheck to exclude':'Smart · Check to always include') : automatic(collection.id) ? uiText("Added automatically") : membership(collection.id) ? uiText("Remove membership without moving") : uiText("Add without moving")}</small></span></label>
    </div>)}</div>
    {!collections.length && <div className="membership-empty"><Icon name={search ? 'search' : 'collection'}/><p>{search ? uiText("No collections found.") : uiText("No collections yet.")}</p><small>{search ? uiText("Try a different name.") : uiText("Create a collection from the sidebar to bring related ideas together.")}</small></div>}
  </fieldset>;
}
