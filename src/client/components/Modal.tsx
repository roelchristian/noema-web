import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({children, onClose, titleId, className}: {children: ReactNode; onClose: () => void; titleId: string; className?: string}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={className} aria-labelledby={titleId} onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation(); }} onCancel={e => { e.preventDefault(); onClose(); }}>{children}</dialog>;
}
