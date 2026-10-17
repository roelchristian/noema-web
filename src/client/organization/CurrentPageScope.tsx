import {useState, type ReactNode} from 'react';
import type {Organization, PageSummary} from '../../shared/domain';
import {Icon} from '../components/Icon';
import {folderBreadcrumbs} from './breadcrumbs';

export function CurrentPageScope({page,pages,data,disabled,onOpenFolder,renderPage}:{
  page:PageSummary;pages:PageSummary[];data:Organization;disabled:boolean;
  onOpenFolder:(id:string)=>void;renderPage:(page:PageSummary)=>ReactNode;
}) {
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const locations=new Map(data.locations.filter(item=>item.kind==='page').map(item=>[item.item_id,item.folder_id]));
  const folderId=locations.get(page.id)??null;
  const path=folderBreadcrumbs(data.folders,folderId);
  const scope=path.at(-1);
  function toggle(id:string) {
    setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});
  }
  function tree(parent:string|null,depth:number,ancestors:Set<string>):ReactNode {
    return <>
      {data.folders.filter(folder=>folder.parent_id===parent&&!ancestors.has(folder.id)).map(folder=>{
        const open=expanded.has(folder.id);
        return <div key={folder.id}>
          <div className="sidebar-item-row organization-branch" style={{paddingLeft:Math.min(depth,5)*12}}>
            <button className="branch-toggle" disabled={disabled} aria-label={(open?'Collapse ':'Expand ')+folder.name} aria-expanded={open} onClick={()=>toggle(folder.id)}>
              <span className="branch-container-icon"><Icon name="folder"/></span><span className="branch-chevron"><Icon name="chevron"/></span>
            </button>
            <button className="nav container-link" disabled={disabled} title={folder.name} onClick={()=>onOpenFolder(folder.id)}><span>{folder.name}</span></button>
          </div>
          {open&&tree(folder.id,depth+1,new Set([...ancestors,folder.id]))}
        </div>;
      })}
      {pages.filter(item=>(locations.get(item.id)??null)===parent).map(item=><div key={item.id} style={{paddingLeft:Math.min(depth,5)*12}}>{renderPage(item)}</div>)}
    </>;
  }
  return <nav className="sidebar-group current-page-scope" aria-label="Current page location">
    <div className="organization-sidebar-label">Current scope</div>
    <div className="scope-path">
      <button disabled={disabled} onClick={()=>onOpenFolder('')}>Library</button>
      {path.slice(0,-1).map(crumb=><span key={crumb.key}><Icon name="chevron"/><button disabled={disabled} onClick={()=>onOpenFolder(crumb.target!.folder)}>{crumb.label}</button></span>)}
    </div>
    {scope&&<button className="page-link scope-folder" disabled={disabled} onClick={()=>onOpenFolder(folderId!)}><Icon name="folder"/><span className="page-link-title">{scope.label}</span></button>}
    {tree(folderId,0,new Set(path.map(crumb=>crumb.target!.folder)))}
  </nav>;
}
