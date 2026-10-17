import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import {positionAnchoredMenu,revealMenuItem} from './menu-placement';

export interface MenuAction {label: string; icon?: string; onSelect: () => void; disabled?: boolean; danger?: boolean}
export function ActionMenu({label, actions, disabled = false, icon = 'more'}: {label: string; actions: MenuAction[]; disabled?: boolean; icon?: string}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const focusLast = useRef(false);
  useLayoutEffect(() => {
    if (!open) return;
    const popup = menu.current!, button = trigger.current!;
    popup.showPopover();
    if (!positionAnchoredMenu(popup, button, {align:'end',minWidth:210})) {popup.hidePopover();setOpen(false);return;}
    const items = popup.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)');
    const item=focusLast.current ? items[items.length - 1] : items[0];
    if(item){item.focus({preventScroll:true});revealMenuItem(popup,item);}
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if(menu.current?.matches(':popover-open') && trigger.current && !positionAnchoredMenu(menu.current,trigger.current,{align:'end',minWidth:210})) {menu.current.hidePopover();setOpen(false);}
    };
    const moved = (event: Event) => {if(!menu.current?.contains(event.target as Node))reposition();};
    document.addEventListener('scroll',moved,true);window.addEventListener('resize',reposition);
    window.visualViewport?.addEventListener('resize',reposition);window.visualViewport?.addEventListener('scroll',reposition);
    return () => {document.removeEventListener('scroll',moved,true);window.removeEventListener('resize',reposition);window.visualViewport?.removeEventListener('resize',reposition);window.visualViewport?.removeEventListener('scroll',reposition);};
  }, [open]);
  function close() { menu.current?.hidePopover(); setOpen(false); }
  return <>
    <button ref={trigger} className="sidebar-menu-trigger" type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => { if (open) close(); else { focusLast.current = false; setOpen(true); } }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusLast.current = event.key === 'ArrowUp'; setOpen(true); }
    }}><Icon name={icon}/></button>
    <div ref={menu} id={id} popover="auto" role="menu" aria-label={label} className="sidebar-action-menu" onToggle={event => { if (!event.currentTarget.matches(':popover-open')) setOpen(false); }} onKeyDown={event => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const focus = (item:HTMLButtonElement|undefined) => {if(item){item.focus({preventScroll:true});revealMenuItem(event.currentTarget,item);}};
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focus(items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); focus(event.key === 'Home' ? items[0] : items.at(-1)); }
      else if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus({preventScroll:true}); }
    }}>{actions.map(action => <button type="button" key={action.label} role="menuitem" className={action.danger ? 'danger' : ''} disabled={action.disabled} onClick={() => { close(); trigger.current?.focus({preventScroll:true}); action.onSelect(); }}>{action.icon && <Icon name={action.icon}/>}<span>{action.label}</span></button>)}</div>
  </>;
}
