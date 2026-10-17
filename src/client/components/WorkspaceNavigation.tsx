import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

const mobileQuery = '(max-width: 750px)';
function subscribe(onChange: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
export function useMobileViewport() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(mobileQuery).matches, () => false);
}

export function WorkspaceNavigation({mobile, open, onClose, children}: {
  mobile: boolean; open: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropDown = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (dialog.open) dialog.close();
    if (open) dialog.showModal();
  }, [mobile, open]);
  useEffect(() => {
    if (!mobile || !open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mobile, open]);
  function isBackdrop(event: {target: EventTarget; clientX: number; clientY: number}) {
    if (event.target !== ref.current) return false;
    const bounds = ref.current!.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  if (!mobile) return <div className="workspace-navigation-desktop">{children}</div>;
  return <dialog ref={ref} id="workspace-navigation" className="workspace-navigation" aria-label="Workspace navigation"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    onPointerDown={event => { backdropDown.current = isBackdrop(event); }}
    onPointerCancel={() => { backdropDown.current = false; }}
    onClick={event => {
      if (backdropDown.current && isBackdrop(event)) onClose();
      backdropDown.current = false;
      if (mobile && (event.target as Element).closest('.nav, .page-link, .sidebar-new-note')) onClose();
    }}>{children}</dialog>;
}
