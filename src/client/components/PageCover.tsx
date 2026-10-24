import {useState} from 'react';
import {imageURL} from '../api';


/** Only genuine images reserve gallery space. Text and container cards own their content. */
export function PageCover({vaultId,imageId,icon: _icon}: {vaultId:string;imageId?:string|null;icon?:string}) {
  const [failed,setFailed]=useState<string|null>(null);
  if (!imageId || failed===imageId) return null;
  return <span className="organization-card-cover" aria-hidden="true">{imageId && failed!==imageId
    ? <img src={imageURL(vaultId,imageId)} alt="" loading="lazy" decoding="async" draggable={false} onError={()=>setFailed(imageId)}/>
    : null}</span>;
}
