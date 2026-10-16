import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({children, onClose, titleId, className, dismissOnBackdrop = false}: {children: ReactNode; onClose: () => void; titleId: string; className?: string; dismissOnBackdrop?: boolean}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPointerDown = useRef(false);
  function isBackdrop(event: {target: EventTarget; currentTarget: HTMLDialogElement; clientX: number; clientY: number}) {
    if (event.target !== event.currentTarget) return false;
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={className} aria-labelledby={titleId}
    onPointerDown={event => { backdropPointerDown.current = isBackdrop(event); }}
    onPointerCancel={() => { backdropPointerDown.current = false; }}
    onClick={event => {
      const shouldDismiss = dismissOnBackdrop && backdropPointerDown.current && isBackdrop(event);
      backdropPointerDown.current = false;
      if (shouldDismiss) onClose();
    }}
    onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation(); }} onCancel={e => { e.preventDefault(); onClose(); }}>{children}</dialog>;
}
