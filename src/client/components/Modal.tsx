import {t as uiText} from '../i18n';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

const ModalClose = createContext<() => void>(() => {});

export function ModalHeader({titleId, children, actions, leading, closeDisabled=false, closeLabel='Close dialog'}: {
  titleId:string; children:ReactNode; actions?:ReactNode; leading?:ReactNode; closeDisabled?:boolean; closeLabel?:string;
}) {
  const onClose=useContext(ModalClose);
  return <header className="modal-header">
    {leading&&<span className="modal-header-leading" aria-hidden="true">{leading}</span>}
    <h2 id={titleId} className="modal-title">{children}</h2>
    <div className="modal-header-actions">{actions}<button type="button" className="modal-close" disabled={closeDisabled} aria-label={uiText(closeLabel)} title={uiText(closeLabel)} onClick={onClose}><Icon name="close"/></button></div>
  </header>;
}
export function Modal({children, onClose, titleId, className, dismissOnBackdrop = false}: {children: ReactNode; onClose: () => void; titleId: string; className?: string; dismissOnBackdrop?: boolean}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPointerDown = useRef(false);
  function isBackdrop(event: {target: EventTarget; currentTarget: HTMLDialogElement; clientX: number; clientY: number}) {
    if (event.target !== event.currentTarget) return false;
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={['noema-modal',className].filter(Boolean).join(' ')} aria-labelledby={titleId}
    onPointerDown={event => { backdropPointerDown.current = isBackdrop(event); }}
    onPointerCancel={() => { backdropPointerDown.current = false; }}
    onClick={event => {
      const shouldDismiss = dismissOnBackdrop && backdropPointerDown.current && isBackdrop(event);
      backdropPointerDown.current = false;
      if (shouldDismiss) onClose();
    }}
    onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation(); }} onCancel={e => { e.preventDefault(); onClose(); }}><ModalClose.Provider value={onClose}>{children}</ModalClose.Provider></dialog>;
}
