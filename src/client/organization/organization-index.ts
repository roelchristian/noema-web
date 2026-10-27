import type {Organization, PageSummary} from '../../shared/domain';

/** Derived once per organization/page inventory, shared by every visible row. */
export function organizationIndex(data:Organization,pages:PageSummary[]) {
  const pagesById=new Map(pages.map(page=>[page.id,page]));
  const foldersById=new Map(data.folders.map(folder=>[folder.id,folder]));
  const collectionsById=new Map(data.collections.map(collection=>[collection.id,collection]));
  const locations=new Map(data.locations.map(location=>[location.kind+':'+location.item_id,location]));
  const favourites=new Set(data.favourites.map(item=>item.kind+':'+item.item_id));
  const memberships=new Map<string,Organization['memberships']>();
  for(const member of data.memberships) {
    const key=member.kind+':'+member.item_id,rows=memberships.get(key);
    if(rows)rows.push(member);else memberships.set(key,[member]);
  }
  const collectionItems=new Map<string,Set<string>>();
  for(const member of data.memberships) {
    let items=collectionItems.get(member.collection_id);
    if(!items){items=new Set();collectionItems.set(member.collection_id,items);}
    items.add(member.kind+':'+member.item_id);
  }
  const linkedFolders=new Map<string,Set<string>>();
  for(const link of data.folderLinks??[]) {
    let folders=linkedFolders.get(link.collection_id);
    if(!folders){folders=new Set();linkedFolders.set(link.collection_id,folders);}
    folders.add(link.folder_id);
  }
  const folderPages=new Map<string,number>(),folderChildren=new Map<string,number>();
  for(const location of data.locations)if(location.kind==='page'&&location.folder_id&&pagesById.has(location.item_id))folderPages.set(location.folder_id,(folderPages.get(location.folder_id)??0)+1);
  for(const folder of data.folders)if(folder.parent_id)folderChildren.set(folder.parent_id,(folderChildren.get(folder.parent_id)??0)+1);
  return {pagesById,foldersById,collectionsById,locations,favourites,memberships,collectionItems,linkedFolders,folderPages,folderChildren};
}
