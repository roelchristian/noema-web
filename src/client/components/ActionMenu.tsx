import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface MenuAction {label: string; icon?: string; onSelect: () => void; disabled?: boolean; danger?: boolean}
export function ActionMenu({label, actions, disabled = false, icon = 'more'}: {label: string; actions: MenuAction[]; disabled?: boolean; icon?: string}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const focusLast = useRef(false);
  useLayoutEffect(() => {
    if (!open) return;
    const popup = menu.current!, button = trigger.current!;
    popup.showPopover();
    const box = button.getBoundingClientRect(), bounds = popup.getBoundingClientRect();
    popup.style.left = Math.max(8,Math.min(box.right - bounds.width,innerWidth - bounds.width - 8)) + 'px';
    popup.style.top = Math.max(8,Math.min(box.bottom + 5,innerHeight - bounds.height - 8)) + 'px';
    const items = popup.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)');
    (focusLast.current ? items[items.length - 1] : items[0])?.focus({preventScroll: true});
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const moved = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) { menu.current?.hidePopover(); setOpen(false); }
    };
    const resized = () => { menu.current?.hidePopover(); setOpen(false); };
    document.addEventListener('scroll',moved,true); window.addEventListener('resize',resized);
    return () => { document.removeEventListener('scroll',moved,true); window.removeEventListener('resize',resized); };
  }, [open]);
  function close() { menu.current?.hidePopover(); setOpen(false); }
  return <>
    <button ref={trigger} className="sidebar-menu-trigger" type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => { if (open) close(); else { focusLast.current = false; setOpen(true); } }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusLast.current = event.key === 'ArrowUp'; setOpen(true); }
    }}><Icon name={icon}/></button>
    <div ref={menu} id={id} popover="auto" role="menu" aria-label={label} className="sidebar-action-menu" onToggle={event => { if (!event.currentTarget.matches(':popover-open')) setOpen(false); }} onKeyDown={event => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); (event.key === 'Home' ? items[0] : items.at(-1))?.focus(); }
      else if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus(); }
    }}>{actions.map(action => <button type="button" key={action.label} role="menuitem" className={action.danger ? 'danger' : ''} disabled={action.disabled} onClick={() => { close(); trigger.current?.focus(); action.onSelect(); }}>{action.icon && <Icon name={action.icon}/>}<span>{action.label}</span></button>)}</div>
  </>;
}
