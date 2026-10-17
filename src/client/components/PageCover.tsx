import {imageURL} from '../api';

/** A decorative cover; the page title remains the accessible navigation label. */
export function PageCover({vaultId,imageId}: {vaultId:string;imageId?:string|null}) {
  if(!imageId)return null;
  return <span className="organization-card-cover" aria-hidden="true"><img src={imageURL(vaultId,imageId)} alt="" loading="lazy" decoding="async" draggable={false}/></span>;
}
