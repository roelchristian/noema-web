import {t as uiText} from '../i18n';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Block } from '../../shared/domain';
import { imageURL } from '../api';
import { Icon } from '../components/Icon';

export function ImageBlock({block, featured, onSetFeatured, vaultId, onChange, onDelete, onExit, onSave, register}: {
  block: Block; featured: boolean; onSetFeatured: () => void; vaultId: string; onChange: (alt: string) => void; onDelete: () => void;
  onExit: () => void; onSave: () => void; register: (el: HTMLDivElement | null) => void;
}) {
  const [captionOpen, setCaptionOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), caption = useRef<HTMLInputElement>(null), toggle = useRef<HTMLButtonElement>(null);
  const captionId = `image-caption-${block.id}`;
  useLayoutEffect(() => {if(captionOpen) caption.current?.focus();}, [captionOpen]);
  useLayoutEffect(() => {
    const block = root.current?.closest<HTMLElement>('[data-block-id]');
    const reveal = (event: Event) => {event.preventDefault(); setCaptionOpen(true);};
    block?.addEventListener('noema:restore-input', reveal);
    return () => block?.removeEventListener('noema:restore-input', reveal);
  }, [block.id]);
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if(event.nativeEvent.isComposing) return;
    if((event.metaKey || event.ctrlKey) && event.key === 's') {event.preventDefault(); onSave(); return;}
    if(event.target !== event.currentTarget) return;
    if(event.key === 'Backspace' || event.key === 'Delete') {event.preventDefault(); onDelete();}
    if(event.key === 'Enter') {event.preventDefault(); onExit();}
  }
  return <div className="image-block" ref={el => {root.current=el; register(el);}} tabIndex={0} role="group" aria-label={uiText("Image block")} aria-description={uiText("Press Backspace or Delete to remove this image. Press Enter to add text below.")} onKeyDown={keyDown}>
    <img src={imageURL(vaultId,block.imageId!)} alt={block.alt || ''} onClick={() => root.current?.focus()}/>
    <div className="image-block-actions">
      <button type="button" className="image-caption-toggle" title={featured?uiText("Remove featured image"):uiText("Use as featured image")} aria-label={featured?uiText("Remove featured image"):uiText("Use as featured image")} aria-pressed={featured} onClick={onSetFeatured}><Icon name="star"/></button>
      <button ref={toggle} className="image-caption-toggle" title={captionOpen ? uiText("Hide image caption") : uiText("Show image caption")} aria-label={captionOpen ? uiText("Hide image caption") : uiText("Show image caption")} aria-expanded={captionOpen} aria-controls={captionId} onClick={() => setCaptionOpen(open => !open)}><Icon name="image"/></button>
    </div>
    {captionOpen && <input ref={caption} id={captionId} aria-label={uiText("Image caption")} placeholder={uiText("Add an image caption…")} maxLength={1000} value={block.alt || ''} onChange={event => onChange(event.target.value)} onKeyDown={event => {
      if(event.key === 'Escape') {event.preventDefault(); setCaptionOpen(false); toggle.current?.focus();}
    }}/>}
  </div>;
}
