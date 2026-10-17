import {useState} from 'react';
import {imageURL} from '../api';
import {Icon} from './Icon';

/** Reserve the same cover space for images, missing images, and icon placeholders. */
export function PageCover({vaultId,imageId,icon='page'}: {vaultId:string;imageId?:string|null;icon?:string}) {
  const [failed,setFailed]=useState<string|null>(null);
  return <span className="organization-card-cover" aria-hidden="true">{imageId && failed!==imageId
    ? <img src={imageURL(vaultId,imageId)} alt="" loading="lazy" decoding="async" draggable={false} onError={()=>setFailed(imageId)}/>
    : <Icon name={icon}/>}</span>;
}
