import {useId} from 'react';
import type {Page} from '../../shared/domain';
import {imageURL} from '../api';
import {Icon} from '../components/Icon';
import {Modal,ModalHeader} from '../components/Modal';

export function FeaturedImageDialog({page,onChange,onClose}: {page:Page;onChange:(id:string|null)=>void;onClose:()=>void}) {
  const titleId=useId();
  const images=new Map(page.blocks.flatMap(block=>block.type==='image' && block.imageId?[[block.imageId,block.alt || 'Page image'] as const]:[]));
  if(page.featuredImageId && !images.has(page.featuredImageId))images.set(page.featuredImageId,'Current featured image');
  return <Modal className="featured-image-dialog" titleId={titleId} onClose={onClose} dismissOnBackdrop>
    <ModalHeader titleId={titleId}>Featured image</ModalHeader>
    <p>Choose an image for this page. Pasting an image sets it as featured automatically.</p>
    {images.size ? <div className="featured-image-options" role="group" aria-label="Page images">{Array.from(images,([id,alt])=><button type="button" key={id} aria-label={'Use '+alt+' as featured image'} aria-pressed={page.featuredImageId===id} onClick={()=>{onChange(id);onClose();}}>
      <img src={imageURL(page.vault_id,id)} alt={alt} loading="lazy"/>
      <span>{page.featuredImageId===id?<><Icon name="check"/>Featured</>:alt}</span>
    </button>)}</div> : <p className="section-hint">Paste or upload an image into the page to get started.</p>}
    <div className="dialog-actions"><button type="button" className="button" disabled={!page.featuredImageId} onClick={()=>{onChange(null);onClose();}}>Remove featured image</button><button type="button" className="button" onClick={onClose}>Done</button></div>
  </Modal>;
}
