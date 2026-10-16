import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({children, onClose, titleId}: {children: ReactNode; onClose: () => void; titleId: string}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); onClose(); }}>{children}</dialog>;
}
